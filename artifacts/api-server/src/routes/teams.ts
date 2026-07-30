import { Router } from "express";
import { db, projectsTable, userProjectsTable, projectEnrollmentsTable, vaultEntriesTable, tasksTable, taskSubmissionsTable, emailAccountsTable } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { broadcastToUser, broadcastEvent } from "./events";
import { createNotification } from "./notifications";
import { logActivity } from "../lib/activity";
import { logSubjectActivity } from "../lib/activity-log";
import { syncOnTeamDelete } from "../services/sync";
// Phase 13B — team mailbox reuses the exact same IMAP/SMTP + cache pipeline
// as personal Vault Mail (routes/email-accounts.ts), just scoped by team_id
// instead of user_id. See that file for the underlying testMailConfig/
// syncInbox/fetchMessageByUid implementations.
import { encryptField, decryptField } from "../lib/vault-crypto";
import { syncInbox } from "../lib/mail-sync";
import { fetchMessageByUid } from "../lib/imap-fetch";
import { testMailConfig } from "./email-accounts";
import type { MailConfig } from "./email-accounts";
import * as imaps from "imap-simple";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /teams — list user's teams ────────────────────────────────────────────
router.get("/teams", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const result = await db.execute(sql.raw(
    `SELECT t.*, tm.role as member_role,
       (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ${userId}
     ORDER BY t.created_at DESC`
  ));
  res.json(result.rows);
});

// ── POST /teams — request a team (pending until admin approves) ───────────────
router.post("/teams", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { name, description } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  const teamName = String(name).trim();
  const teamDesc = description ? String(description).trim() : null;
  try {
    const result = await db.execute(sql`
      INSERT INTO teams (name, description, owner_id, status)
      VALUES (${teamName}, ${teamDesc}, ${userId}, 'pending')
      RETURNING *
    `);
    const team = result.rows[0] as any;
    if (!team?.id) { res.status(500).json({ error: "Team creation failed" }); return; }
    await db.execute(sql`
      INSERT INTO team_members (team_id, user_id, role, status)
      VALUES (${team.id}, ${userId}, 'leader', 'active')
      ON CONFLICT (team_id, user_id) DO NOTHING
    `);
    // Notify all admins
    try {
      const admins = await db.execute(sql`SELECT id FROM users WHERE role = 'admin' LIMIT 20`);
      for (const admin of admins.rows as any[]) {
        await db.execute(sql`
          INSERT INTO notifications (user_id, type, title, message, data)
          VALUES (${admin.id}, 'team_request', 'New Team Request',
            ${'User #' + userId + ' requested to create team: ' + teamName},
            ${JSON.stringify({ teamId: team.id, ownerId: userId })})
        `);
      }
      broadcastToUser(-1, "team_request", { teamId: team.id, teamName, ownerId: userId });
    } catch { /* notification errors non-fatal */ }
    res.status(201).json(team);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create team", detail: err?.message });
  }
});

// ── GET /teams/browse — public team listing (MUST be before /:id) ────────────
router.get("/teams/browse", requireAuth, async (req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT t.id, t.name, t.description, t.slug,
           COUNT(tm.id)::int AS member_count,
           u.username AS owner_username
    FROM teams t
    LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'active'
    LEFT JOIN users u ON u.id = t.owner_id
    WHERE t.status = 'active'
    GROUP BY t.id, u.username
    ORDER BY member_count DESC, t.created_at DESC
    LIMIT 50
  `);
  res.json(result.rows);
});

// ── GET /teams/my-invites — pending invites for current user (MUST be before /:id) ──
router.get("/teams/my-invites", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const result = await db.execute(sql.raw(
    `SELECT tm.id, tm.team_id, tm.role, tm.created_at as invited_at,
       t.name as team_name, t.description as team_description,
       u.username as invited_by_username
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE tm.user_id = ${userId} AND tm.status = 'pending'
     ORDER BY tm.created_at DESC`
  ));
  res.json(result.rows);
});

// ── GET /teams/search — search public teams by name (MUST be before /:id) ────
router.get("/teams/search", requireAuth, async (req, res): Promise<void> => {
  const { q } = req.query as Record<string, string>;
  const term = (q ?? "").trim();
  if (!term) { res.json([]); return; }
  const result = await db.execute(sql`
    SELECT t.id, t.name, t.description, t.slug, t.avatar_url, t.visibility,
           COUNT(tm.id)::int AS member_count
    FROM teams t
    LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.status = 'active'
    WHERE t.status = 'active' AND t.visibility = 'public' AND t.name ILIKE ${"%" + term + "%"}
    GROUP BY t.id
    ORDER BY member_count DESC
    LIMIT 25
  `);
  res.json(result.rows);
});

// ── GET /teams/favorites — current user's favorited teams (MUST be before /:id) ──
router.get("/teams/favorites", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const result = await db.execute(sql`
    SELECT t.*, f.created_at AS favorited_at
    FROM team_favorites f
    JOIN teams t ON t.id = f.team_id
    WHERE f.user_id = ${userId}
    ORDER BY f.created_at DESC
  `);
  res.json(result.rows);
});

// ── GET /teams/:id — get team detail ─────────────────────────────────────────
router.get("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const [teamResult, membersResult] = await Promise.all([
    db.execute(sql.raw(`SELECT * FROM teams WHERE id = ${teamId}`)),
    db.execute(sql.raw(
      `SELECT tm.*, u.username, u.avatar_url, u.email, u.total_roi, u.streak FROM team_members tm
       JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ${teamId} ORDER BY tm.joined_at ASC`
    )),
  ]);
  if (!teamResult.rows.length) { res.status(404).json({ error: "Team not found" }); return; }
  const myRole = (memberCheck.rows[0] as any).role;
  // note is a leader-only private annotation — strip it out for non-leaders (tm.* picks up the new column)
  const members = myRole === "leader"
    ? membersResult.rows
    : (membersResult.rows as any[]).map(({ note, ...rest }) => rest);
  res.json({ ...teamResult.rows[0], members, myRole });
});

// ── GET /teams/:id/stats — get team stats ────────────────────────────────────
router.get("/teams/:id/stats", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }

  const [memberCount, msgCount, projectCount, totalRoi, recentActivity] = await Promise.all([
    db.execute(sql.raw(`SELECT COUNT(*) as count FROM team_members WHERE team_id = ${teamId}`)),
    db.execute(sql.raw(`SELECT COUNT(*) as count FROM team_messages WHERE team_id = ${teamId}`)),
    db.execute(sql.raw(`SELECT COUNT(*) as count FROM projects WHERE team_id = ${teamId}`)),
    db.execute(sql.raw(
      `SELECT COALESCE(SUM(u.total_roi), 0) as total FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ${teamId}`
    )),
    db.execute(sql.raw(
      `SELECT tm.id, tm.created_at as joined_at, u.username FROM team_messages tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ${teamId} ORDER BY tm.created_at DESC LIMIT 5`
    )),
  ]);

  res.json({
    memberCount: parseInt((memberCount.rows[0] as any).count, 10),
    messageCount: parseInt((msgCount.rows[0] as any).count, 10),
    projectCount: parseInt((projectCount.rows[0] as any).count, 10),
    totalRoi: parseFloat((totalRoi.rows[0] as any).total) || 0,
    recentActivity: recentActivity.rows,
  });
});

// ── GET /teams/:id/leaderboard — team member leaderboard ─────────────────────
router.get("/teams/:id/leaderboard", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }

  const result = await db.execute(sql.raw(
    `SELECT tm.user_id, tm.role, tm.joined_at,
       u.username, u.avatar_url, u.total_roi, u.streak,
       COALESCE((SELECT SUM(azn_amount) FROM credits WHERE user_id = u.id), 0) as azn_balance,
       COALESCE((SELECT COUNT(*) FROM task_submissions ts WHERE ts.user_id = u.id AND ts.status = 'approved'), 0) as tasks_completed,
       COALESCE((SELECT COUNT(*) FROM team_messages msg WHERE msg.team_id = ${teamId} AND msg.user_id = u.id), 0) as messages_sent
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ${teamId}
     ORDER BY u.total_roi DESC`
  ));

  const ranked = (result.rows as any[]).map((r, i) => ({ ...r, rank: i + 1 }));
  res.json(ranked);
});

// ── GET /teams/:id/member-progress — Phase 15A: per-member progress for the
// Other section's Members sub-view. Three signals, each scoped to this team:
// tasks completed (approved task_submissions on this team's projects),
// mission contribution (SUM of signed current_value deltas the member made,
// read from the shared Phase 4 activity_log — see the PATCH mission-update
// route above for the write side), and vault-activity count (rows in the
// existing vault_activity_log for entities that belong to this team). No
// running totals are stored anywhere — every number here is computed at
// read time from the underlying log/submission tables.
router.get("/teams/:id/member-progress", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }

  const result = await db.execute(sql.raw(
    `SELECT tm.user_id,
       COALESCE((
         SELECT COUNT(*) FROM task_submissions ts
         JOIN tasks t ON t.id = ts.task_id
         JOIN projects p ON p.id = t.project_id
         WHERE p.team_id = ${teamId} AND ts.user_id = tm.user_id AND ts.status = 'approved'
       ), 0) as tasks_completed,
       COALESCE((
         SELECT SUM(al.amount) FROM activity_log al
         WHERE al.subject_type = 'team' AND al.subject_id = ${teamId}
           AND al.action = 'mission_progress' AND al.actor_user_id = tm.user_id
       ), 0) as mission_contribution,
       COALESCE((
         SELECT COUNT(*) FROM vault_activity_log val
         JOIN vault_entries ve ON ve.id = val.vault_entry_id
         WHERE ve.team_id = ${teamId} AND val.user_id = tm.user_id
       ), 0) as vault_activity_count
     FROM team_members tm
     WHERE tm.team_id = ${teamId} AND tm.status = 'active'`
  ));

  res.json((result.rows as any[]).map(r => ({
    userId: Number(r.user_id),
    tasksCompleted: Number(r.tasks_completed),
    missionContribution: Number(r.mission_contribution),
    vaultActivityCount: Number(r.vault_activity_count),
  })));
});

// ── Phase 17 audit fix ───────────────────────────────────────────────────
// Team activity used to be split across two logging systems: the shared
// Phase 4 activity_log table (subject_type="team" — mission_progress,
// vault_used) and a bespoke team_activity_log table (member_removed,
// role_changed, mailbox_added, ownership_transferred, member_left,
// team_join_request_*), with two conflicting route handlers for
// GET /teams/:id/activity (only the first-registered one — the
// activity_log-only version — was ever actually reachable; the second was
// dead code reading team_activity_log that no request could hit).
//
// Fix: every write site for the member_removed/role_changed/mailbox_added/
// ownership_transferred/member_left/team_join_request_* events below now
// calls logSubjectActivity("team", teamId, ...) and lands directly in the
// shared activity_log table, same as mission_progress/vault_used already
// did — per Phase 15's original "no second logging system" requirement.
// team_activity_log is kept only as a read-only historical source (pre-fix
// rows already written to it) via fetchMergedTeamActivity below; nothing
// writes to it anymore.
type TeamActivityEntry = {
  id: number;
  action: string;
  actorUserId: number | null;
  actorUsername: string | null;
  amount: number | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

async function fetchMergedTeamActivity(
  teamId: number,
  opts: { limit?: number; actions?: string[] } = {},
): Promise<TeamActivityEntry[]> {
  const limit = opts.limit ?? 100;
  const quoteList = (actions: string[]) => actions.map(a => `'${a.replace(/'/g, "''")}'`).join(",");
  const sharedActionFilter = opts.actions?.length ? `AND al.action IN (${quoteList(opts.actions)})` : "";
  const legacyActionFilter = opts.actions?.length ? `AND tal.action IN (${quoteList(opts.actions)})` : "";

  const [sharedRes, legacyRes] = await Promise.all([
    db.execute(sql.raw(
      `SELECT al.id, al.action, al.actor_user_id, al.amount, al.meta, al.created_at,
         u.username as actor_username
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.actor_user_id
       WHERE al.subject_type = 'team' AND al.subject_id = ${teamId} ${sharedActionFilter}
       ORDER BY al.created_at DESC
       LIMIT ${limit}`
    )),
    // Historical rows only — nothing writes here anymore (see comment above).
    db.execute(sql.raw(
      `SELECT tal.id, tal.action, tal.user_id as actor_user_id, tal.meta, tal.created_at,
         u.username as actor_username
       FROM team_activity_log tal
       LEFT JOIN users u ON u.id = tal.user_id
       WHERE tal.team_id = ${teamId} ${legacyActionFilter}
       ORDER BY tal.created_at DESC
       LIMIT ${limit}`
    )),
  ]);

  const sharedRows: TeamActivityEntry[] = (sharedRes.rows as any[]).map(r => ({
    id: Number(r.id),
    action: r.action as string,
    actorUserId: r.actor_user_id !== null ? Number(r.actor_user_id) : null,
    actorUsername: r.actor_username ?? null,
    amount: r.amount !== null ? Number(r.amount) : null,
    // activity_log.meta is a TEXT column holding JSON-stringified content.
    meta: r.meta ? JSON.parse(r.meta) : null,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  const legacyRows: TeamActivityEntry[] = (legacyRes.rows as any[]).map(r => ({
    // Negative-namespaced so a legacy id can never collide with a shared
    // activity_log id (both sequences start at 1) once merged client-side.
    id: -Number(r.id),
    action: r.action as string,
    actorUserId: r.actor_user_id !== null ? Number(r.actor_user_id) : null,
    actorUsername: r.actor_username ?? null,
    amount: null,
    // team_activity_log.meta is JSONB — the driver returns it already parsed.
    meta: r.meta ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  return [...sharedRows, ...legacyRows]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

// ── GET /teams/:id/activity — Phase 15B (fixed in Phase 17): Other
// section's Activity Log sub-view. Chronological feed merging the shared
// activity_log rows (subject_type="team" — mission_progress, vault_used,
// and post-fix member/role/mailbox/ownership events) with any pre-fix
// team_activity_log rows still on disk. Entity names for vault_used rows
// are resolved here (one extra query) so the feed doesn't just show raw
// vault entry ids.
router.get("/teams/:id/activity", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }

  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
  const rows = await fetchMergedTeamActivity(teamId, { limit });

  // Resolve entity names for vault_used rows in one batched lookup.
  const vaultEntryIds = [...new Set(
    rows.filter(r => r.action === "vault_used" && r.meta?.vaultEntryId).map(r => Number(r.meta!.vaultEntryId))
  )];
  if (vaultEntryIds.length > 0) {
    const namesRes = await db.execute(sql.raw(
      `SELECT id, project_name FROM vault_entries WHERE id IN (${vaultEntryIds.join(",")})`
    ));
    const nameById = new Map((namesRes.rows as any[]).map(r => [Number(r.id), r.project_name as string]));
    for (const r of rows) {
      if (r.action === "vault_used" && r.meta?.vaultEntryId) {
        (r.meta as any).entityName = nameById.get(Number(r.meta.vaultEntryId)) ?? null;
      }
    }
  }

  res.json(rows);
});

// ── GET /teams/:id/projects — team projects ───────────────────────────────────
router.get("/teams/:id/projects", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }

  const result = await db.execute(sql.raw(
    `SELECT p.*, 
       (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as task_count,
       (SELECT COUNT(*) FROM user_projects WHERE project_id = p.id) as participant_count
     FROM projects p WHERE p.team_id = ${teamId} ORDER BY p.created_at DESC LIMIT 20`
  ));
  res.json(result.rows);
});

// ── PATCH /teams/:id — update team (leader only) ──────────────────────────────
router.patch("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  const role = (memberCheck.rows[0] as any)?.role;
  if (!role || role !== "leader") { res.status(403).json({ error: "Only team leader can update" }); return; }
  const { name } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const result = await db.execute(sql.raw(
    `UPDATE teams SET name = '${name.replace(/'/g, "''")}' WHERE id = ${teamId} RETURNING *`
  ));
  res.json(result.rows[0]);
});

// ── DELETE /teams/:id — disband team (leader only) ────────────────────────────
router.delete("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const teamResult = await db.execute(sql.raw(`SELECT owner_id FROM teams WHERE id = ${teamId}`));
  const team = teamResult.rows[0] as any;
  if (!team || team.owner_id !== userId) { res.status(403).json({ error: "Only team owner can disband" }); return; }
  await db.execute(sql.raw(`DELETE FROM team_messages WHERE team_id = ${teamId}`));
  await db.execute(sql.raw(`DELETE FROM team_members WHERE team_id = ${teamId}`));
  await db.execute(sql.raw(`DELETE FROM teams WHERE id = ${teamId}`));
  syncOnTeamDelete(teamId).catch(() => {});
  res.json({ ok: true });
});

// ── POST /teams/:id/invite-link — generate shareable deep-link (MUST be before /:id/invite) ──
router.post("/teams/:id/invite-link", requireAuth, async (req, res): Promise<void> => {
  const teamId = parseInt(req.params.id as string);
  const userId = req.user!.userId;
  if (isNaN(teamId)) { res.status(400).json({ error: "invalid team id" }); return; }
  // Only leaders/admins can generate invite links
  const memberCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active' LIMIT 1`);
  const role = (memberCheck.rows[0] as any)?.role;
  if (!role) { res.status(403).json({ error: "Not a member of this team" }); return; }
  if (role !== "leader") { res.status(403).json({ error: "Only leaders can generate invite links" }); return; }
  // Generate/refresh invite code
  const code = `tm-${teamId}-${Buffer.from(`${teamId}:${Date.now()}`).toString("base64url").slice(0, 12)}`;
  await db.execute(sql`UPDATE teams SET invite_code = ${code} WHERE id = ${teamId}`);
  const origin = req.headers.origin ?? `https://${req.headers.host}`;
  const invite_link = `${origin}/teams/join?code=${code}`;
  res.json({ invite_link, code });
});

// ── POST /teams/:id/invite — invite member ────────────────────────────────────
router.post("/teams/:id/invite", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  if ((memberCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can invite" }); return; }
  const { username } = req.body;
  if (!username) { res.status(400).json({ error: "username is required" }); return; }
  const userResult = await db.execute(sql.raw(`SELECT id FROM users WHERE username = '${username.replace(/'/g, "''")}' OR email = '${username.replace(/'/g, "''")}' LIMIT 1`));
  if (!userResult.rows.length) { res.status(404).json({ error: "User not found" }); return; }
  const inviteeId = (userResult.rows[0] as any).id;
  try {
    await db.execute(sql.raw(`INSERT INTO team_members (team_id, user_id, role) VALUES (${teamId}, ${inviteeId}, 'member')`));
    broadcastToUser(inviteeId, "team_invite", { teamId });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "User already in team" });
  }
});

// ── DELETE /teams/:id/members/:userId — remove member ────────────────────────
router.delete("/teams/:id/members/:memberId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberId = parseInt(Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  const myRole = (memberCheck.rows[0] as any)?.role;
  if (myRole !== "leader" && userId !== memberId) { res.status(403).json({ error: "Not allowed" }); return; }
  await db.execute(sql.raw(`DELETE FROM team_members WHERE team_id = ${teamId} AND user_id = ${memberId}`));
  await logSubjectActivity("team", teamId, "member_removed", { actorUserId: userId, meta: { memberId } });
  res.json({ ok: true });
});

// ── PATCH /teams/:id/members/:memberId/role — promote/demote ─────────────────
router.patch("/teams/:id/members/:memberId/role", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberId = parseInt(Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId, 10);
  const { role } = req.body;
  if (!["leader", "member"].includes(role)) { res.status(400).json({ error: "role must be leader or member" }); return; }
  const leaderCheck = await db.execute(sql.raw(`SELECT owner_id FROM teams WHERE id = ${teamId}`));
  if ((leaderCheck.rows[0] as any)?.owner_id !== userId) { res.status(403).json({ error: "Only owner can change roles" }); return; }
  await db.execute(sql.raw(`UPDATE team_members SET role = '${role}' WHERE team_id = ${teamId} AND user_id = ${memberId}`));
  await logSubjectActivity("team", teamId, "role_changed", { actorUserId: userId, meta: { memberId, newRole: role } });
  res.json({ ok: true });
});

// ── GET /teams/:id/messages — get chat messages ───────────────────────────────
router.get("/teams/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { limit = "50", before } = req.query as Record<string, string>;
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  let query = `SELECT tm.*, u.username, u.avatar_url FROM team_messages tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ${teamId}`;
  if (before) query += ` AND tm.id < ${parseInt(before, 10)}`;
  query += ` ORDER BY tm.created_at DESC LIMIT ${Math.min(parseInt(limit, 10), 100)}`;
  const result = await db.execute(sql.raw(query));
  res.json((result.rows as any[]).reverse());
});

// ── POST /teams/:id/messages — send message ───────────────────────────────────
router.post("/teams/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { message } = req.body;
  if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const result = await db.execute(sql.raw(
    `INSERT INTO team_messages (team_id, user_id, message) VALUES (${teamId}, ${userId}, '${message.replace(/'/g, "''")}') RETURNING *`
  ));
  res.status(201).json(result.rows[0]);
});

// ── GET /teams/:id/vault — team members' vault entries ────────────────────────
router.get("/teams/:id/vault", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const result = await db.execute(sql.raw(
    `SELECT ve.id, ve.project_name, ve.category, ve.email, ve.twitter_username, ve.discord_username,
       ve.telegram_username, ve.entity_serial, ve.created_at, ve.user_id,
       u.username, u.avatar_url
     FROM vault_entries ve
     JOIN users u ON u.id = ve.user_id
     JOIN team_members tm ON tm.team_id = ${teamId} AND tm.user_id = ve.user_id AND tm.status = 'active'
     ORDER BY ve.created_at DESC LIMIT 100`
  ));
  res.json(result.rows);
});

// ── GET /teams/:id/missions ───────────────────────────────────────────────────
router.get("/teams/:id/missions", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const result = await db.execute(sql.raw(
    `SELECT m.*, u.username as created_by_username FROM team_missions m
     LEFT JOIN users u ON u.id = m.created_by
     WHERE m.team_id = ${teamId} ORDER BY m.created_at DESC`
  ));
  res.json(result.rows);
});

// ── POST /teams/:id/missions — create mission (leader only) ──────────────────
router.post("/teams/:id/missions", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const { title, description, target_value, reward_amount, deadline } = req.body;
  if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }
  const deadlineVal = deadline ? `'${deadline}'` : "NULL";
  const result = await db.execute(sql.raw(
    `INSERT INTO team_missions (team_id, title, description, target_value, reward_amount, deadline, created_by)
     VALUES (${teamId}, '${title.replace(/'/g, "''")}', ${description ? `'${description.replace(/'/g, "''")}'` : "NULL"},
       ${parseInt(target_value ?? "100", 10)}, ${parseFloat(reward_amount ?? "0")}, ${deadlineVal}, ${userId})
     RETURNING *`
  ));
  res.status(201).json(result.rows[0]);
});

// ── PATCH /teams/:id/missions/:missionId — update mission ────────────────────
router.patch("/teams/:id/missions/:missionId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const missionId = parseInt(Array.isArray(req.params.missionId) ? req.params.missionId[0] : req.params.missionId, 10);
  const memberCheck = await db.execute(sql.raw(
    `SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`
  ));
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const { title, description, status, target_value, current_value, reward_amount, deadline } = req.body;

  // Phase 15A — team_missions has no per-member attribution of who moved the
  // needle (updateProgress just PATCHes current_value). Capture the value
  // before the update so a real change can be logged to the shared Phase 4
  // activity_log (subject_type="team") — that's what member-progress reads
  // for "mission contribution" per member, same "derive from the log, never
  // store a running total" rule the rest of activity-log.ts follows.
  let previousValue: number | null = null;
  if (current_value !== undefined) {
    const existing = await db.execute(sql.raw(
      `SELECT current_value FROM team_missions WHERE id = ${missionId} AND team_id = ${teamId}`
    ));
    previousValue = existing.rows.length ? Number((existing.rows[0] as any).current_value) : null;
  }

  const sets: string[] = [];
  if (title !== undefined) sets.push(`title = '${title.replace(/'/g, "''")}'`);
  if (description !== undefined) sets.push(`description = '${description.replace(/'/g, "''")}'`);
  if (status !== undefined) sets.push(`status = '${status}'`);
  if (target_value !== undefined) sets.push(`target_value = ${parseInt(target_value, 10)}`);
  if (current_value !== undefined) sets.push(`current_value = ${parseInt(current_value, 10)}`);
  if (reward_amount !== undefined) sets.push(`reward_amount = ${parseFloat(reward_amount)}`);
  if (deadline !== undefined) sets.push(`deadline = '${deadline}'`);
  if (!sets.length) { res.status(400).json({ error: "Nothing to update" }); return; }
  sets.push("updated_at = CURRENT_TIMESTAMP");
  const result = await db.execute(sql.raw(
    `UPDATE team_missions SET ${sets.join(", ")} WHERE id = ${missionId} AND team_id = ${teamId} RETURNING *`
  ));
  const updated = result.rows[0] as any;
  if (previousValue !== null && updated) {
    const delta = Number(updated.current_value) - previousValue;
    if (delta !== 0) {
      logSubjectActivity("team", teamId, "mission_progress", {
        actorUserId: userId,
        amount: delta,
        meta: { missionId, missionTitle: updated.title },
      });
    }
  }
  res.json(updated);
});

// ── POST /teams/:id/enroll-project — leader enrolls whole team in a project ──
router.post("/teams/:id/enroll-project", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { projectId, vaultEntryId } = req.body as { projectId?: number; vaultEntryId?: number };
  if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }

  const roleRes = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  const myRole = (roleRes.rows[0] as any)?.role;
  if (!myRole) { res.status(403).json({ error: "Not a team member" }); return; }
  if (myRole !== "leader") { res.status(403).json({ error: "Only team leader can enroll the team" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  if (vaultEntryId) {
    const [entity] = await db.select().from(vaultEntriesTable).where(eq(vaultEntriesTable.id, vaultEntryId));
    if (!entity) { res.status(404).json({ error: "Vault entity not found" }); return; }
  }

  const membersRes = await db.execute(sql`SELECT user_id FROM team_members WHERE team_id = ${teamId} AND status = 'active'`);
  const memberIds = (membersRes.rows as any[]).map(r => r.user_id as number);

  let enrolledCount = 0;
  for (const memberId of memberIds) {
    const alreadyJoined = await db.select().from(userProjectsTable)
      .where(and(eq(userProjectsTable.userId, memberId), eq(userProjectsTable.projectId, projectId)));
    if (alreadyJoined.length === 0) await db.insert(userProjectsTable).values({ userId: memberId, projectId });

    if (vaultEntryId) {
      const existingEnrollment = await db.select().from(projectEnrollmentsTable)
        .where(and(eq(projectEnrollmentsTable.projectId, projectId), eq(projectEnrollmentsTable.userId, memberId), eq(projectEnrollmentsTable.vaultEntryId, vaultEntryId)));
      if (existingEnrollment.length === 0) {
        await db.insert(projectEnrollmentsTable).values({ userId: memberId, projectId, vaultEntryId, status: "active" });
        enrolledCount++;
      }
    }
    if (memberId !== userId) {
      await createNotification(memberId, "team_project_enrolled", "Team Joined a Project",
        `Your team leader enrolled the team in "${project.name}".`, { teamId, projectId });
    }
  }

  broadcastEvent("projects_updated", { action: "team_enrolled", projectId, teamId });
  logActivity(userId, "team_enroll_project", "project", projectId, project.name, { teamId, memberCount: memberIds.length });

  res.status(201).json({ ok: true, projectId, teamId, memberCount: memberIds.length, enrolledCount });
});

// ── POST /teams/:id/vault — create a shared vault entity for the team ────────
router.post("/teams/:id/vault", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }

  const { category, projectName, email, emailPassword, twitterUsername, twitterPassword,
    discordUsername, discordPassword, telegramUsername, telegramPassword, notes } = req.body;
  if (!category || !projectName) { res.status(400).json({ error: "category and projectName are required" }); return; }

  const serial = `AYZN${userId}-${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

  const [entry] = await db.insert(vaultEntriesTable).values({
    userId, entitySerial: serial, category, projectName,
    email: email || null, emailPassword: emailPassword || null,
    twitterUsername: twitterUsername || null, twitterPassword: twitterPassword || null,
    discordUsername: discordUsername || null, discordPassword: discordPassword || null,
    telegramUsername: telegramUsername || null, telegramPassword: telegramPassword || null,
    notes: notes || null,
  }).returning();

  await db.execute(sql`UPDATE vault_entries SET team_id = ${teamId} WHERE id = ${entry.id}`);

  logActivity(userId, "team_vault_create", "vault_entry", entry.id, projectName, { teamId });
  res.status(201).json({ ...entry, teamId });
});

// ── POST /teams/:id/tasks/:taskId/enroll — enroll all active team members in a task ──
router.post("/teams/:id/tasks/:taskId/enroll", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const taskId = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  const { vaultEntryId } = req.body as { vaultEntryId?: number };

  const roleRes = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  const myRole = (roleRes.rows[0] as any)?.role;
  if (!myRole) { res.status(403).json({ error: "Not a team member" }); return; }
  if (myRole !== "leader") { res.status(403).json({ error: "Only team leader can enroll the team in a task" }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const membersRes = await db.execute(sql`SELECT user_id FROM team_members WHERE team_id = ${teamId} AND status = 'active'`);
  const memberIds = (membersRes.rows as any[]).map(r => r.user_id as number);

  const entityIdsJson = vaultEntryId ? JSON.stringify([vaultEntryId]) : null;
  let enrolledCount = 0;
  for (const memberId of memberIds) {
    const existing = await db.select().from(taskSubmissionsTable)
      .where(and(eq(taskSubmissionsTable.taskId, taskId), eq(taskSubmissionsTable.userId, memberId)));
    if (existing.length > 0) continue;

    await db.execute(sql`
      INSERT INTO task_submissions (task_id, user_id, status, notes, entity_ids)
      VALUES (${taskId}, ${memberId}, 'pending', 'Enrolled via team mission — awaiting proof submission', ${entityIdsJson})
    `);
    enrolledCount++;

    if (memberId !== userId) {
      await createNotification(memberId, "team_task_enrolled", "Team Task Assigned",
        `Your team leader enrolled the team in task "${task.name}". Submit your proof to complete it.`,
        { teamId, taskId });
    }
  }

  broadcastEvent("tasks_updated", { action: "team_enrolled", taskId, teamId });
  logActivity(userId, "team_enroll_task", "task", taskId, task.name, { teamId, memberCount: memberIds.length });

  res.status(201).json({ ok: true, taskId, teamId, memberCount: memberIds.length, enrolledCount });
});

// ── PATCH /teams/:id/invites/respond — accept or reject invite ────────────────
router.patch("/teams/:id/invites/respond", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { action } = req.body;
  if (!["accept", "reject"].includes(action)) { res.status(400).json({ error: "action must be accept or reject" }); return; }
  if (action === "reject") {
    await db.execute(sql.raw(`DELETE FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'pending'`));
    res.json({ ok: true, action: "rejected" });
    return;
  }
  await db.execute(sql.raw(
    `UPDATE team_members SET status = 'active' WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'pending'`
  ));
  res.json({ ok: true, action: "accepted" });
});

// ── Admin: GET /admin/teams — all teams with status ───────────────────────────
router.get("/admin/teams", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "admin" && req.user!.role !== "operator" && req.user!.role !== "moderator") { res.status(403).json({ error: "Admin only" }); return; }
  const { status } = req.query as Record<string, string>;
  let q = `SELECT t.*, u.username as owner_username,
    (SELECT COUNT(*) FROM team_members WHERE team_id = t.id AND status = 'active') as member_count,
    (SELECT COUNT(*) FROM team_messages WHERE team_id = t.id) as message_count
   FROM teams t LEFT JOIN users u ON u.id = t.owner_id`;
  if (status) q += ` WHERE t.status = '${status}'`;
  q += " ORDER BY t.created_at DESC";
  const result = await db.execute(sql.raw(q));
  res.json(result.rows);
});

// ── Admin: GET /admin/team-vault — all team vault entries with visible passwords ──
router.get("/admin/team-vault", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "admin" && req.user!.role !== "operator") { res.status(403).json({ error: "Admin only" }); return; }
  const { teamId } = req.query as Record<string, string>;
  let q = `SELECT ve.*, u.username, u.email as owner_email, t.name as team_name
    FROM vault_entries ve
    JOIN users u ON u.id = ve.user_id
    LEFT JOIN teams t ON t.id = ve.team_id
    WHERE ve.team_id IS NOT NULL`;
  if (teamId) q += ` AND ve.team_id = ${parseInt(teamId, 10)}`;
  q += " ORDER BY ve.created_at DESC LIMIT 500";
  const result = await db.execute(sql.raw(q));
  res.json(result.rows);
});

// ── Admin: PATCH /admin/teams/:id — approve/reject/update team ────────────────
router.patch("/admin/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const role = req.user!.role;
  const isModerator = role === "moderator";
  if (role !== "admin" && role !== "operator" && !isModerator) { res.status(403).json({ error: "Admin only" }); return; }
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { status, name, description } = req.body;
  if (isModerator && (name || description)) { res.status(403).json({ error: "Moderators can only approve/reject teams, not edit them" }); return; }
  if (!status && !name && !description) { res.status(400).json({ error: "Nothing to update" }); return; }
  try {
    // Build update dynamically
    const teamBefore = await db.execute(sql`SELECT * FROM teams WHERE id = ${teamId}`);
    const team = teamBefore.rows[0] as any;
    if (!team) { res.status(404).json({ error: "Team not found" }); return; }

    const newStatus = status ?? team.status;
    const newName = name ?? team.name;
    const newDesc = description !== undefined ? description : team.description;

    const result = await db.execute(sql`
      UPDATE teams SET status = ${newStatus}, name = ${newName}, description = ${newDesc}
      WHERE id = ${teamId} RETURNING *
    `);
    const updated = result.rows[0] as any;

    // Notify owner if status changed
    if (status && status !== team.status && team.owner_id) {
      const isApproved = status === "active";
      const isRejected = status === "rejected";
      if (isApproved || isRejected) {
        try {
          const msg = isApproved
            ? `Your team "${team.name}" has been approved! You can now invite members.`
            : `Your team "${team.name}" request was rejected by an admin.`;
          await db.execute(sql`
            INSERT INTO notifications (user_id, type, title, message, data)
            VALUES (${team.owner_id}, 'team_update',
              ${isApproved ? 'Team Approved!' : 'Team Request Rejected'},
              ${msg},
              ${JSON.stringify({ teamId: team.id })})
          `);
          broadcastToUser(team.owner_id, "team_update", { teamId: team.id, status, teamName: team.name });
        } catch { /* non-fatal */ }
      }
    }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update team", detail: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Team module extensions — 30 additional functions
// (favorites, join requests, ownership transfer, member profiles/notes,
//  avatar/visibility, message editing/pinning, announcements, mission
//  lifecycle, analytics, activity/audit log, notification prefs, admin tools)
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /teams/:id/favorite — toggle favorite for current user ──────────────
router.post("/teams/:id/favorite", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const existing = await db.execute(sql`SELECT id FROM team_favorites WHERE user_id = ${userId} AND team_id = ${teamId}`);
  if (existing.rows.length) {
    await db.execute(sql`DELETE FROM team_favorites WHERE user_id = ${userId} AND team_id = ${teamId}`);
    res.json({ ok: true, favorited: false });
    return;
  }
  await db.execute(sql`INSERT INTO team_favorites (user_id, team_id) VALUES (${userId}, ${teamId})`);
  res.json({ ok: true, favorited: true });
});

// ── POST /teams/:id/join-request — request to join a public team ─────────────
router.post("/teams/:id/join-request", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { message } = req.body as { message?: string };
  const already = await db.execute(sql`SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`);
  if (already.rows.length) { res.status(409).json({ error: "Already a member or invited" }); return; }
  try {
    const result = await db.execute(sql`
      INSERT INTO team_join_requests (team_id, user_id, message, status)
      VALUES (${teamId}, ${userId}, ${message ?? null}, 'pending')
      ON CONFLICT (team_id, user_id) DO UPDATE SET status = 'pending', message = ${message ?? null}
      RETURNING *
    `);
    const teamRes = await db.execute(sql`SELECT owner_id, name FROM teams WHERE id = ${teamId}`);
    const team = teamRes.rows[0] as any;
    if (team?.owner_id) {
      await createNotification(team.owner_id, "team_join_request", "New Join Request",
        `A user requested to join your team "${team.name}".`, { teamId });
    }
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create join request", detail: err?.message });
  }
});

// ── GET /teams/:id/join-requests — leader views pending join requests ────────
router.get("/teams/:id/join-requests", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can view join requests" }); return; }
  const result = await db.execute(sql`
    SELECT jr.*, u.username, u.avatar_url
    FROM team_join_requests jr
    JOIN users u ON u.id = jr.user_id
    WHERE jr.team_id = ${teamId} AND jr.status = 'pending'
    ORDER BY jr.created_at DESC
  `);
  res.json(result.rows);
});

// ── PATCH /teams/:id/join-requests/:requestId — approve or reject ────────────
router.patch("/teams/:id/join-requests/:requestId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const requestId = parseInt(Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId, 10);
  const { action } = req.body as { action?: string };
  if (!["approve", "reject"].includes(action ?? "")) { res.status(400).json({ error: "action must be approve or reject" }); return; }
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can respond to join requests" }); return; }
  const reqRes = await db.execute(sql`SELECT * FROM team_join_requests WHERE id = ${requestId} AND team_id = ${teamId}`);
  const jr = reqRes.rows[0] as any;
  if (!jr) { res.status(404).json({ error: "Join request not found" }); return; }
  if (action === "approve") {
    await db.execute(sql`INSERT INTO team_members (team_id, user_id, role, status) VALUES (${teamId}, ${jr.user_id}, 'member', 'active') ON CONFLICT (team_id, user_id) DO NOTHING`);
    await db.execute(sql`UPDATE team_join_requests SET status = 'approved' WHERE id = ${requestId}`);
    await createNotification(jr.user_id, "team_update", "Join Request Approved", "Your request to join the team was approved.", { teamId });
  } else {
    await db.execute(sql`UPDATE team_join_requests SET status = 'rejected' WHERE id = ${requestId}`);
    await createNotification(jr.user_id, "team_update", "Join Request Rejected", "Your request to join the team was rejected.", { teamId });
  }
  await logSubjectActivity("team", teamId, "team_join_request_" + action, { actorUserId: userId, meta: { requestId, targetUser: jr.user_id } });
  res.json({ ok: true, action });
});

// ── POST /teams/:id/transfer-ownership — leader hands ownership to a member ──
router.post("/teams/:id/transfer-ownership", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { newOwnerId } = req.body as { newOwnerId?: number };
  if (!newOwnerId) { res.status(400).json({ error: "newOwnerId is required" }); return; }
  const teamRes = await db.execute(sql`SELECT owner_id FROM teams WHERE id = ${teamId}`);
  const team = teamRes.rows[0] as any;
  if (!team || team.owner_id !== userId) { res.status(403).json({ error: "Only the current owner can transfer ownership" }); return; }
  const targetCheck = await db.execute(sql`SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${newOwnerId} AND status = 'active'`);
  if (!targetCheck.rows.length) { res.status(400).json({ error: "Target user must be an active team member" }); return; }
  await db.execute(sql`UPDATE teams SET owner_id = ${newOwnerId} WHERE id = ${teamId}`);
  await db.execute(sql`UPDATE team_members SET role = 'leader' WHERE team_id = ${teamId} AND user_id = ${newOwnerId}`);
  await db.execute(sql`UPDATE team_members SET role = 'member' WHERE team_id = ${teamId} AND user_id = ${userId}`);
  await logSubjectActivity("team", teamId, "ownership_transferred", { actorUserId: userId, meta: { newOwnerId } });
  await createNotification(newOwnerId, "team_update", "You're now the Team Leader", "Ownership of the team has been transferred to you.", { teamId });
  res.json({ ok: true, newOwnerId });
});

// ── POST /teams/:id/leave — member leaves a team (owner must transfer first) ──
router.post("/teams/:id/leave", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const teamRes = await db.execute(sql`SELECT owner_id FROM teams WHERE id = ${teamId}`);
  const team = teamRes.rows[0] as any;
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.owner_id === userId) { res.status(400).json({ error: "Owner must transfer ownership or disband the team before leaving" }); return; }
  const result = await db.execute(sql`DELETE FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} RETURNING id`);
  if (!result.rows.length) { res.status(404).json({ error: "Not a member of this team" }); return; }
  await logSubjectActivity("team", teamId, "member_left", { actorUserId: userId });
  res.json({ ok: true });
});

// ── GET /teams/:id/members/:memberId — single member profile within team ─────
router.get("/teams/:id/members/:memberId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberId = parseInt(Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId, 10);
  const memberCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`);
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const isLeader = (memberCheck.rows[0] as any).role === "leader";
  const result = await db.execute(sql`
    SELECT tm.id, tm.team_id, tm.user_id, tm.role, tm.status, tm.joined_at, tm.note,
           u.username, u.avatar_url, u.email, u.total_roi, u.streak
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ${teamId} AND tm.user_id = ${memberId}
  `);
  if (!result.rows.length) { res.status(404).json({ error: "Member not found" }); return; }
  const member = result.rows[0] as any;
  if (!isLeader) delete member.note;
  res.json(member);
});

// ── PATCH /teams/:id/members/:memberId/note — leader sets an internal note ───
router.patch("/teams/:id/members/:memberId/note", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberId = parseInt(Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId, 10);
  const { note } = req.body as { note?: string };
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can set member notes" }); return; }
  const result = await db.execute(sql`UPDATE team_members SET note = ${note ?? null} WHERE team_id = ${teamId} AND user_id = ${memberId} RETURNING id, note`);
  if (!result.rows.length) { res.status(404).json({ error: "Member not found" }); return; }
  res.json(result.rows[0]);
});

// ── PATCH /teams/:id/avatar — update team avatar (leader only) ───────────────
router.patch("/teams/:id/avatar", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { avatarUrl } = req.body as { avatarUrl?: string };
  if (!avatarUrl?.trim()) { res.status(400).json({ error: "avatarUrl is required" }); return; }
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can update team avatar" }); return; }
  const result = await db.execute(sql`UPDATE teams SET avatar_url = ${avatarUrl.trim()} WHERE id = ${teamId} RETURNING id, avatar_url`);
  res.json(result.rows[0]);
});

// ── PATCH /teams/:id/visibility — set team public/private (leader only) ──────
router.patch("/teams/:id/visibility", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { visibility } = req.body as { visibility?: string };
  if (!["public", "private"].includes(visibility ?? "")) { res.status(400).json({ error: "visibility must be public or private" }); return; }
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can change visibility" }); return; }
  const result = await db.execute(sql`UPDATE teams SET visibility = ${visibility} WHERE id = ${teamId} RETURNING id, visibility`);
  res.json(result.rows[0]);
});

// ── DELETE /teams/:id/messages/:messageId — delete a message ─────────────────
router.delete("/teams/:id/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  const role = (roleCheck.rows[0] as any)?.role;
  if (!role) { res.status(403).json({ error: "Not a team member" }); return; }
  const msgRes = await db.execute(sql`SELECT user_id FROM team_messages WHERE id = ${messageId} AND team_id = ${teamId}`);
  const message = msgRes.rows[0] as any;
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  if (message.user_id !== userId && role !== "leader") { res.status(403).json({ error: "Not allowed to delete this message" }); return; }
  await db.execute(sql`DELETE FROM team_messages WHERE id = ${messageId}`);
  res.json({ ok: true });
});

// ── PATCH /teams/:id/messages/:messageId — edit own message ──────────────────
router.patch("/teams/:id/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);
  const { message } = req.body as { message?: string };
  if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }
  const msgRes = await db.execute(sql`SELECT user_id FROM team_messages WHERE id = ${messageId} AND team_id = ${teamId}`);
  const existing = msgRes.rows[0] as any;
  if (!existing) { res.status(404).json({ error: "Message not found" }); return; }
  if (existing.user_id !== userId) { res.status(403).json({ error: "You can only edit your own messages" }); return; }
  const result = await db.execute(sql`UPDATE team_messages SET message = ${message.trim()}, edited_at = NOW() WHERE id = ${messageId} RETURNING *`);
  res.json(result.rows[0]);
});

// ── POST /teams/:id/messages/:messageId/pin — toggle pin (leader only) ───────
router.post("/teams/:id/messages/:messageId/pin", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can pin messages" }); return; }
  const msgRes = await db.execute(sql`SELECT pinned FROM team_messages WHERE id = ${messageId} AND team_id = ${teamId}`);
  const existing = msgRes.rows[0] as any;
  if (!existing) { res.status(404).json({ error: "Message not found" }); return; }
  const newPinned = !existing.pinned;
  await db.execute(sql`UPDATE team_messages SET pinned = ${newPinned} WHERE id = ${messageId}`);
  res.json({ ok: true, pinned: newPinned });
});

// ── GET /teams/:id/messages/pinned — list pinned messages ────────────────────
router.get("/teams/:id/messages/pinned", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql`SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`);
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const result = await db.execute(sql`
    SELECT tm.*, u.username, u.avatar_url FROM team_messages tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ${teamId} AND tm.pinned = TRUE
    ORDER BY tm.created_at DESC
  `);
  res.json(result.rows);
});

// ── POST /teams/:id/announcements — leader posts an announcement ─────────────
router.post("/teams/:id/announcements", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { title, content } = req.body as { title?: string; content?: string };
  if (!title?.trim() || !content?.trim()) { res.status(400).json({ error: "title and content are required" }); return; }
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can post announcements" }); return; }
  const result = await db.execute(sql`
    INSERT INTO team_announcements (team_id, title, content, created_by)
    VALUES (${teamId}, ${title.trim()}, ${content.trim()}, ${userId})
    RETURNING *
  `);
  const members = await db.execute(sql`SELECT user_id FROM team_members WHERE team_id = ${teamId} AND status = 'active' AND user_id != ${userId}`);
  for (const m of members.rows as any[]) {
    await createNotification(m.user_id, "team_announcement", title.trim(), content.trim().slice(0, 200), { teamId });
  }
  broadcastEvent("team_announcement", { teamId, title: title.trim() });
  res.status(201).json(result.rows[0]);
});

// ── GET /teams/:id/announcements — list announcements ────────────────────────
router.get("/teams/:id/announcements", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql`SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`);
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const result = await db.execute(sql`
    SELECT a.*, u.username AS created_by_username FROM team_announcements a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.team_id = ${teamId}
    ORDER BY a.created_at DESC
  `);
  res.json(result.rows);
});

// ── DELETE /teams/:id/missions/:missionId — delete a mission (leader only) ───
router.delete("/teams/:id/missions/:missionId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const missionId = parseInt(Array.isArray(req.params.missionId) ? req.params.missionId[0] : req.params.missionId, 10);
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can delete missions" }); return; }
  const result = await db.execute(sql`DELETE FROM team_missions WHERE id = ${missionId} AND team_id = ${teamId} RETURNING id`);
  if (!result.rows.length) { res.status(404).json({ error: "Mission not found" }); return; }
  res.json({ ok: true });
});

// ── GET /teams/:id/missions/:missionId — single mission detail ───────────────
router.get("/teams/:id/missions/:missionId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const missionId = parseInt(Array.isArray(req.params.missionId) ? req.params.missionId[0] : req.params.missionId, 10);
  const memberCheck = await db.execute(sql`SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const result = await db.execute(sql`
    SELECT m.*, u.username AS created_by_username, c.username AS claimed_by_username
    FROM team_missions m
    LEFT JOIN users u ON u.id = m.created_by
    LEFT JOIN users c ON c.id = m.claimed_by
    WHERE m.id = ${missionId} AND m.team_id = ${teamId}
  `);
  if (!result.rows.length) { res.status(404).json({ error: "Mission not found" }); return; }
  res.json(result.rows[0]);
});

// ── POST /teams/:id/missions/:missionId/claim — claim a completed mission's reward ──
router.post("/teams/:id/missions/:missionId/claim", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const missionId = parseInt(Array.isArray(req.params.missionId) ? req.params.missionId[0] : req.params.missionId, 10);
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can claim mission rewards" }); return; }
  const missionRes = await db.execute(sql`SELECT * FROM team_missions WHERE id = ${missionId} AND team_id = ${teamId}`);
  const mission = missionRes.rows[0] as any;
  if (!mission) { res.status(404).json({ error: "Mission not found" }); return; }
  if (mission.claimed) { res.status(409).json({ error: "Reward already claimed" }); return; }
  if (mission.current_value < mission.target_value && mission.status !== "completed") {
    res.status(400).json({ error: "Mission is not yet complete" }); return;
  }
  const result = await db.execute(sql`
    UPDATE team_missions SET claimed = TRUE, claimed_by = ${userId}, claimed_at = NOW(), status = 'completed'
    WHERE id = ${missionId} RETURNING *
  `);
  logActivity(userId, "team_mission_claim", "team_mission", missionId, mission.title, { teamId, rewardAmount: mission.reward_amount });
  res.json(result.rows[0]);
});

// ── GET /teams/:id/analytics/growth — weekly member growth ───────────────────
router.get("/teams/:id/analytics/growth", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const memberCheck = await db.execute(sql`SELECT 1 FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`);
  if (!memberCheck.rows.length) { res.status(403).json({ error: "Not a team member" }); return; }
  const result = await db.execute(sql`
    SELECT date_trunc('week', joined_at) AS week, COUNT(*)::int AS new_members
    FROM team_members
    WHERE team_id = ${teamId}
    GROUP BY week ORDER BY week ASC
  `);
  res.json(result.rows);
});

// ── GET /teams/:id/export — leader-only JSON export of team data ─────────────
router.get("/teams/:id/export", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can export team data" }); return; }
  const [team, members, missions, announcements] = await Promise.all([
    db.execute(sql`SELECT * FROM teams WHERE id = ${teamId}`),
    db.execute(sql`SELECT tm.role, tm.status, tm.joined_at, u.username, u.email FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ${teamId}`),
    db.execute(sql`SELECT * FROM team_missions WHERE team_id = ${teamId}`),
    db.execute(sql`SELECT * FROM team_announcements WHERE team_id = ${teamId}`),
  ]);
  res.json({
    team: team.rows[0],
    members: members.rows,
    missions: missions.rows,
    announcements: announcements.rows,
    exportedAt: new Date().toISOString(),
  });
});

// ── GET /teams/:id/audit-log — leader-only sensitive action history ──────────
// Fixed in Phase 17 alongside the Activity Log merge: this used to read
// team_activity_log exclusively, so once the write sites above moved to
// logSubjectActivity (shared activity_log), any new sensitive-action rows
// would have silently stopped showing up here. Uses the same
// fetchMergedTeamActivity helper, filtered to the sensitive action set, so
// pre-fix rows (team_activity_log) and post-fix rows (activity_log) both
// appear in one ordered list.
router.get("/teams/:id/audit-log", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const roleCheck = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  if ((roleCheck.rows[0] as any)?.role !== "leader") { res.status(403).json({ error: "Only leader can view the audit log" }); return; }
  const rows = await fetchMergedTeamActivity(teamId, {
    limit: 100,
    actions: ["ownership_transferred", "member_removed", "member_left", "role_changed", "team_join_request_approve", "team_join_request_reject"],
  });
  res.json(rows);
});

// ── PATCH /teams/:id/notifications — mute/unmute team notifications for self ──
router.patch("/teams/:id/notifications", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { muted } = req.body as { muted?: boolean };
  if (typeof muted !== "boolean") { res.status(400).json({ error: "muted must be a boolean" }); return; }
  const result = await db.execute(sql`UPDATE team_members SET muted = ${muted} WHERE team_id = ${teamId} AND user_id = ${userId} RETURNING id, muted`);
  if (!result.rows.length) { res.status(404).json({ error: "Not a team member" }); return; }
  res.json(result.rows[0]);
});

// ── GET /teams/:id/notifications — get current user's notification pref ──────
router.get("/teams/:id/notifications", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const result = await db.execute(sql`SELECT muted FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId}`);
  if (!result.rows.length) { res.status(404).json({ error: "Not a team member" }); return; }
  res.json({ teamId, muted: (result.rows[0] as any).muted ?? false });
});

// ── Admin: DELETE /admin/teams/:id — permanently delete a team + all its data ──
router.delete("/admin/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const role = req.user!.role;
  if (role !== "admin" && role !== "operator") { res.status(403).json({ error: "Admin only" }); return; }
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const teamRes = await db.execute(sql`SELECT * FROM teams WHERE id = ${teamId}`);
  if (!teamRes.rows.length) { res.status(404).json({ error: "Team not found" }); return; }
  await db.execute(sql`DELETE FROM team_messages WHERE team_id = ${teamId}`);
  await db.execute(sql`DELETE FROM team_missions WHERE team_id = ${teamId}`);
  await db.execute(sql`DELETE FROM team_announcements WHERE team_id = ${teamId}`);
  await db.execute(sql`DELETE FROM team_join_requests WHERE team_id = ${teamId}`);
  await db.execute(sql`DELETE FROM team_favorites WHERE team_id = ${teamId}`);
  await db.execute(sql`DELETE FROM team_activity_log WHERE team_id = ${teamId}`);
  await db.execute(sql`DELETE FROM team_members WHERE team_id = ${teamId}`);
  await db.execute(sql`DELETE FROM teams WHERE id = ${teamId}`);
  syncOnTeamDelete(teamId).catch(() => {});
  logActivity(req.user!.userId, "admin_team_delete", "team", teamId, (teamRes.rows[0] as any).name);
  res.json({ ok: true });
});

// ── Admin: GET /admin/teams/:id/members — view all members of any team ───────
router.get("/admin/teams/:id/members", requireAuth, async (req, res): Promise<void> => {
  const role = req.user!.role;
  if (role !== "admin" && role !== "operator" && role !== "moderator") { res.status(403).json({ error: "Admin only" }); return; }
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const result = await db.execute(sql`
    SELECT tm.*, u.username, u.email, u.avatar_url, u.role AS user_role
    FROM team_members tm JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ${teamId} ORDER BY tm.joined_at ASC
  `);
  res.json(result.rows);
});

// ── Admin: POST /admin/teams/:id/broadcast — send a system message to a team ──
router.post("/admin/teams/:id/broadcast", requireAuth, async (req, res): Promise<void> => {
  const role = req.user!.role;
  if (role !== "admin" && role !== "operator") { res.status(403).json({ error: "Admin only" }); return; }
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { message } = req.body as { message?: string };
  if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }
  const members = await db.execute(sql`SELECT user_id FROM team_members WHERE team_id = ${teamId} AND status = 'active'`);
  const adminId = req.user!.userId;
  await db.execute(sql`INSERT INTO team_messages (team_id, user_id, message) VALUES (${teamId}, ${adminId}, ${"[Admin] " + message.trim()})`);
  for (const m of members.rows as any[]) {
    await createNotification(m.user_id, "team_announcement", "Message from AYZEN Admin", message.trim(), { teamId });
  }
  broadcastEvent("team_admin_broadcast", { teamId });
  res.json({ ok: true, notifiedCount: members.rows.length });
});

// ─── Phase 13B — Team App section: AYZEN-provided team mailbox ────────────────
// Reuses the exact same IMAP/SMTP config + mail_messages cache pipeline as
// personal Vault Mail (routes/email-accounts.ts), scoped by team_id instead
// of user_id. Leader manages the config; any active member can read the
// inbox once it's configured. Kept in this file (not email-accounts.ts) so
// team access control (team_members role checks) stays next to the rest of
// the team routes.

function fmtTeamMailAccount(e: typeof emailAccountsTable.$inferSelect) {
  return {
    ...e,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    password: e.password ? "••••••••" : null,
    authKey: e.authKey ? "••••••••" : null,
  };
}

async function getTeamRole(teamId: number, userId: number): Promise<string | undefined> {
  const check = await db.execute(sql`SELECT role FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} AND status = 'active'`);
  return (check.rows[0] as any)?.role;
}

// ── GET /teams/:id/email-accounts — list the team's mailbox configs ───────────
router.get("/teams/:id/email-accounts", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const role = await getTeamRole(teamId, userId);
  if (!role) { res.status(403).json({ error: "Not a team member" }); return; }
  const rows = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.teamId, teamId));
  res.json(rows.map(fmtTeamMailAccount));
});

// ── POST /teams/:id/email-accounts/test-config — verify IMAP/SMTP (leader only) ──
router.post("/teams/:id/email-accounts/test-config", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const role = await getTeamRole(teamId, userId);
  if (role !== "leader") { res.status(403).json({ error: "Only the team leader can manage the mailbox" }); return; }
  try {
    const body = req.body as MailConfig & { accountId?: number };
    let config = body;
    if (body.accountId) {
      const [existing] = await db.select().from(emailAccountsTable).where(and(
        eq(emailAccountsTable.id, Number(body.accountId)),
        eq(emailAccountsTable.teamId, teamId),
      ));
      if (!existing) { res.status(404).json({ error: "Account not found" }); return; }
      config = {
        ...existing, ...body,
        emailAddress: body.emailAddress || existing.emailAddress,
        password: body.password || decryptField(existing.password) || undefined,
        authKey: body.authKey || decryptField(existing.authKey) || undefined,
      } as MailConfig & { accountId?: number };
    }
    await testMailConfig(config);
    res.json({ success: true, message: "IMAP and SMTP connections verified" });
  } catch (err: any) {
    res.status(422).json({ success: false, error: "Connection failed", detail: err?.message ?? "Unable to connect" });
  }
});

// ── POST /teams/:id/email-accounts — add a mailbox config (leader only) ───────
router.post("/teams/:id/email-accounts", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const role = await getTeamRole(teamId, userId);
  if (role !== "leader") { res.status(403).json({ error: "Only the team leader can manage the mailbox" }); return; }
  const { label, emailAddress, protocol, provider, imapHost, imapPort, smtpHost, smtpPort, username, password, authKey, sessionPooler, useSSL, notes, tags } = req.body;
  if (!label || !emailAddress) { res.status(400).json({ error: "label and emailAddress required" }); return; }
  const [row] = await db.insert(emailAccountsTable).values({
    userId, teamId, label, emailAddress, protocol: protocol ?? "IMAP", provider: provider ?? "custom",
    imapHost, imapPort: imapPort ? parseInt(imapPort, 10) : 993,
    smtpHost, smtpPort: smtpPort ? parseInt(smtpPort, 10) : 587,
    username, password: encryptField(password), authKey: encryptField(authKey), sessionPooler,
    useSSL: useSSL !== false, isDefault: false, notes, tags,
  }).returning();
  await logSubjectActivity("team", teamId, "mailbox_added", { actorUserId: userId, meta: { emailAddress } });
  res.status(201).json(fmtTeamMailAccount(row));
});

// ── PUT /teams/:id/email-accounts/:accountId — update config (leader only) ────
router.put("/teams/:id/email-accounts/:accountId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const accountId = parseInt(Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId, 10);
  const role = await getTeamRole(teamId, userId);
  if (role !== "leader") { res.status(403).json({ error: "Only the team leader can manage the mailbox" }); return; }
  const { label, emailAddress, protocol, provider, imapHost, imapPort, smtpHost, smtpPort, username, password, authKey, sessionPooler, useSSL, notes, tags } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (label !== undefined) updates.label = label;
  if (emailAddress !== undefined) updates.emailAddress = emailAddress;
  if (protocol !== undefined) updates.protocol = protocol;
  if (provider !== undefined) updates.provider = provider;
  if (imapHost !== undefined) updates.imapHost = imapHost;
  if (imapPort !== undefined) updates.imapPort = parseInt(imapPort, 10);
  if (smtpHost !== undefined) updates.smtpHost = smtpHost;
  if (smtpPort !== undefined) updates.smtpPort = parseInt(smtpPort, 10);
  if (username !== undefined) updates.username = username;
  if (password !== undefined && password !== "••••••••") updates.password = encryptField(password);
  if (authKey !== undefined && authKey !== "••••••••") updates.authKey = encryptField(authKey);
  if (sessionPooler !== undefined) updates.sessionPooler = sessionPooler;
  if (useSSL !== undefined) updates.useSSL = useSSL;
  if (notes !== undefined) updates.notes = notes;
  if (tags !== undefined) updates.tags = tags;
  const [row] = await db.update(emailAccountsTable).set(updates)
    .where(and(eq(emailAccountsTable.id, accountId), eq(emailAccountsTable.teamId, teamId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmtTeamMailAccount(row));
});

// ── DELETE /teams/:id/email-accounts/:accountId — remove config (leader only) ─
router.delete("/teams/:id/email-accounts/:accountId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const accountId = parseInt(Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId, 10);
  const role = await getTeamRole(teamId, userId);
  if (role !== "leader") { res.status(403).json({ error: "Only the team leader can manage the mailbox" }); return; }
  await db.delete(emailAccountsTable).where(and(eq(emailAccountsTable.id, accountId), eq(emailAccountsTable.teamId, teamId)));
  res.json({ ok: true });
});

// ── POST /teams/:id/email-accounts/:accountId/fetch-inbox — sync via IMAP (any active member) ──
router.post("/teams/:id/email-accounts/:accountId/fetch-inbox", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const accountId = parseInt(Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId, 10);
  const role = await getTeamRole(teamId, userId);
  if (!role) { res.status(403).json({ error: "Not a team member" }); return; }
  const limit = Math.min(parseInt(req.body?.limit ?? "50", 10), 100);
  const mailbox = (req.body?.mailbox as string) || "INBOX";
  const [account] = await db.select().from(emailAccountsTable)
    .where(and(eq(emailAccountsTable.id, accountId), eq(emailAccountsTable.teamId, teamId)));
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  if (!account.imapHost || !(account.password || account.authKey)) {
    res.status(400).json({ error: "IMAP not fully configured — host and password/auth key required" }); return;
  }
  try {
    const { messages, total } = await syncInbox(account, { limit, mailbox, sourceCategory: "team", sourceId: teamId });
    res.json({ messages, total });
  } catch (err: any) {
    res.status(500).json({ error: "IMAP connection failed", detail: err?.message ?? "Unknown error" });
  }
});

// ── POST /teams/:id/email-accounts/:accountId/fetch-body — full body of one email ──
router.post("/teams/:id/email-accounts/:accountId/fetch-body", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const accountId = parseInt(Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId, 10);
  const role = await getTeamRole(teamId, userId);
  if (!role) { res.status(403).json({ error: "Not a team member" }); return; }
  const { seqno, mailbox = "INBOX" } = req.body;
  if (!seqno) { res.status(400).json({ error: "seqno required" }); return; }
  const [account] = await db.select().from(emailAccountsTable)
    .where(and(eq(emailAccountsTable.id, accountId), eq(emailAccountsTable.teamId, teamId)));
  if (!account || !account.imapHost || !(account.password || account.authKey)) {
    res.status(404).json({ error: "Account not found or not configured" }); return;
  }
  const imapConfig = {
    imap: {
      user: account.username ?? account.emailAddress,
      password: decryptField(account.authKey) || decryptField(account.password),
      host: account.imapHost, port: account.imapPort ?? 993,
      tls: account.useSSL !== false, tlsOptions: { rejectUnauthorized: false },
      authTimeout: 15000, connTimeout: 15000,
    },
  };
  let connection: any = null;
  try {
    // seqno shifts as mail moves/deletes server-side; look up the stable uid
    // we cached from the last sync instead (mirrors email-accounts.ts).
    const cached = await db.execute(sql`
      SELECT uid FROM mail_messages WHERE email_account_id = ${accountId} AND seqno = ${seqno} LIMIT 1
    `);
    const cachedUid = (cached.rows[0] as any)?.uid;
    if (cachedUid == null) {
      res.status(404).json({ error: "Message not found in synced cache — try syncing the inbox again" });
      return;
    }
    connection = await (imaps as any).connect(imapConfig);
    await connection.openBox(mailbox);
    const msg = await fetchMessageByUid(connection, cachedUid, { bodies: ["TEXT", "HEADER"], markSeen: false, struct: false });
    const textPart = msg?.parts?.find((p: any) => p.which === "TEXT");
    const headerPart = msg?.parts?.find((p: any) => p.which === "HEADER");
    const hdr = headerPart?.body ?? {};
    let body = (textPart?.body as string) ?? "";
    body = body.replace(/Content-Transfer-Encoding: base64[\s\S]*?(?=--|\z)/gm, "[attachment]");
    body = body.substring(0, 8000);
    connection.end();
    const uid = msg?.attributes?.uid ?? cachedUid ?? null;
    if (uid != null) {
      try {
        await db.execute(sql`
          UPDATE mail_messages SET body_text = ${encryptField(body)}, fetched_at = NOW()
          WHERE email_account_id = ${accountId} AND uid = ${uid}
        `);
      } catch (cacheErr) {
        console.error("[team mail_messages] body cache write failed:", cacheErr);
      }
    }
    res.json({
      seqno,
      subject: (Array.isArray(hdr.subject) ? hdr.subject[0] : hdr.subject) || "(no subject)",
      from: (Array.isArray(hdr.from) ? hdr.from[0] : hdr.from) || "",
      date: (Array.isArray(hdr.date) ? hdr.date[0] : hdr.date) || "",
      body,
    });
  } catch (err: any) {
    try { connection?.end(); } catch {}
    logger.error({ accountId, teamId, seqno, err: err?.message ?? err }, "[team fetch-body] failed");
    res.status(500).json({ error: "Failed to fetch email body", detail: err?.message });
  }
});

// ── GET /teams/:id/email-accounts/:accountId/stored-messages — cached inbox ───
router.get("/teams/:id/email-accounts/:accountId/stored-messages", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const teamId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const accountId = parseInt(Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId, 10);
  const role = await getTeamRole(teamId, userId);
  if (!role) { res.status(403).json({ error: "Not a team member" }); return; }
  const [account] = await db.select().from(emailAccountsTable)
    .where(and(eq(emailAccountsTable.id, accountId), eq(emailAccountsTable.teamId, teamId)));
  if (!account) { res.status(404).json({ error: "Account not found" }); return; }
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const result = await db.execute(sql`
    SELECT id, uid, seqno, from_addr AS "from", to_addr AS "to", subject, message_date AS date,
           (body_text IS NOT NULL) AS "hasBody"
    FROM mail_messages
    WHERE email_account_id = ${accountId}
    ORDER BY message_date DESC NULLS LAST, id DESC
    LIMIT ${limit}
  `);
  res.json({ messages: result.rows, total: result.rows.length });
});

export default router;
