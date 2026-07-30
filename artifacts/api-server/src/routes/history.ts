import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

function getUserId(req: any): number {
  const auth = req.headers.authorization;
  if (!auth) return 0;
  try {
    const p = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return p.userId ?? 0;
  } catch { return 0; }
}

function isAdmin(req: any): boolean {
  const auth = req.headers.authorization;
  if (!auth) return false;
  try {
    const p = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return p.role === "admin";
  } catch { return false; }
}

const ACTION_LABELS: Record<string, string> = {
  task_submitted: "Task Submitted",
  task_approved: "Task Approved",
  task_rejected: "Task Rejected",
  task_auto_approved: "Task Auto-Approved",
  project_joined: "Joined Project",
  login: "Logged In",
  password_changed: "Password Changed",
  vault_created: "Vault Entity Created",
  vault_deleted: "Vault Entity Deleted",
  credit_purchased: "Credits Purchased",
  subscription_upgraded: "Subscription Upgraded",
};

router.get("/history", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { limit = "50", offset = "0", action } = req.query as Record<string, string>;
  const whereAction = action ? `AND action = '${action.replace(/'/g, "''")}'` : "";

  try {
    const result = await db.execute(sql.raw(
      `SELECT * FROM user_activity
       WHERE user_id = ${userId} ${whereAction}
       ORDER BY created_at DESC
       LIMIT ${Math.min(Number(limit), 200)} OFFSET ${Number(offset)}`
    ));
    const countResult = await db.execute(sql.raw(
      `SELECT COUNT(*) as total FROM user_activity WHERE user_id = ${userId} ${whereAction}`
    ));
    const total = Number((countResult.rows[0] as any)?.total ?? 0);

    res.json({
      items: (result.rows as any[]).map(r => ({
        id: r.id,
        action: r.action,
        label: ACTION_LABELS[r.action] ?? r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityName: r.entity_name,
        meta: r.meta ? (() => { try { return JSON.parse(r.meta); } catch { return {}; } })() : {},
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
      total,
    });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

router.get("/history/chart", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const r = await db.execute(sql.raw(
      `SELECT
         TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') as week,
         COUNT(*) FILTER (WHERE action IN ('task_approved','task_auto_approved')) as approved,
         COUNT(*) FILTER (WHERE action = 'task_submitted') as submitted,
         COUNT(*) as total
       FROM user_activity
       WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '10 weeks'
       GROUP BY DATE_TRUNC('week', created_at)
       ORDER BY DATE_TRUNC('week', created_at) ASC`
    ));
    res.json(r.rows);
  } catch { res.json([]); }
});

router.get("/admin/history", async (req, res): Promise<void> => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  const { limit = "30", page = "1", userId, action: filterAction } = req.query as Record<string, string>;
  const lim = Math.min(Number(limit), 200);
  const offset = (Math.max(Number(page), 1) - 1) * lim;
  const conditions: string[] = [];
  if (userId) conditions.push(`ua.user_id = ${Number(userId)}`);
  if (filterAction) conditions.push(`ua.action ILIKE '%${filterAction.replace(/'/g, "''")}%'`);
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  try {
    const result = await db.execute(sql.raw(
      `SELECT ua.*, u.username, u.email FROM user_activity ua
       LEFT JOIN users u ON u.id = ua.user_id
       ${whereClause}
       ORDER BY ua.created_at DESC
       LIMIT ${lim} OFFSET ${offset}`
    ));
    const countResult = await db.execute(sql.raw(
      `SELECT COUNT(*) as total FROM user_activity ua ${whereClause}`
    ));
    const total = Number((countResult.rows[0] as any)?.total ?? 0);
    res.json({
      entries: (result.rows as any[]).map(r => ({
        id: r.id, user_id: r.user_id, username: r.username, email: r.email,
        action: r.action, label: ACTION_LABELS[r.action] ?? r.action,
        entity_type: r.entity_type, entity_id: r.entity_id, entity_name: r.entity_name,
        meta: r.meta ? (() => { try { return JSON.parse(r.meta); } catch { return r.meta; } })() : null,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
      total, page: Number(page), limit: lim,
    });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

export default router;
