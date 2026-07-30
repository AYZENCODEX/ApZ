import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { decryptRow } from "../lib/vault-crypto";
import { createNotification } from "./notifications";

const router = Router();

/**
 * Vault entity sharing ("transfer" in the product sense the team uses the
 * word — access moves, ownership never does).
 *
 * Sharing an entity does NOT change which user owns it — the owner_id
 * column here is separate from, and never writes to, the user_id column on
 * the underlying local_accounts / vault_entries / kyc_entries / game_entries
 * row. A share is just a grant of read (or edit) access to another user.
 * Turning is_active off (PATCH) — or deleting the row (DELETE) — instantly
 * removes that access; the entity itself, and who owns it, is untouched.
 */

// entity_type -> underlying table + a short label column used to render a
// human-readable name for the shared item without exposing sensitive fields.
const ENTITY_TABLES: Record<string, { table: string; sensitive: readonly string[]; label: (row: any) => string }> = {
  local: {
    table: "local_accounts",
    sensitive: ["password", "recovery_email_password", "backup_codes", "twofa", "recovery_email_twofa"],
    label: (r) => r.label || r.username || r.email || `Local #${r.id}`,
  },
  entity: {
    table: "vault_entries",
    sensitive: [
      "account_password", "email_password", "email_2fa", "email_backup_code", "email_recovery_password",
      "recovery_2fa", "recovery_backup_code",
      "twitter_password", "twitter_email_password", "twitter_2fa", "twitter_email_recovery_password",
      "discord_password", "discord_email_password", "discord_2fa", "discord_email_recovery_password",
      "telegram_password", "telegram_linked_email_password", "telegram_2fa",
      "backup_codes", "other_accounts",
    ],
    label: (r) => r.project_name || r.username || `Entity #${r.id}`,
  },
  kyc: {
    table: "kyc_entries",
    sensitive: ["account_password", "email_password", "email_2fa", "email_backup_code", "nid_number"],
    label: (r) => r.name || r.username || `KYC #${r.id}`,
  },
  game: {
    table: "game_entries",
    sensitive: ["account_password", "email_password", "email_2fa", "email_backup_code"],
    label: (r) => r.username || `Game #${r.id}`,
  },
};

const VALID_TYPES = Object.keys(ENTITY_TABLES);

const safe = (v: unknown) => v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

function isValidType(t: unknown): t is keyof typeof ENTITY_TABLES {
  return typeof t === "string" && VALID_TYPES.includes(t);
}

// ─── POST /vault-shares — share an owned entity with another user ─────────
// body: { entityType, entityId, username, permission? ('view'|'edit') }
router.post("/vault-shares", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { entityType, entityId, username, permission = "view" } = req.body;

  if (!isValidType(entityType)) { res.status(400).json({ error: `entityType must be one of: ${VALID_TYPES.join(", ")}` }); return; }
  const id = parseInt(entityId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid entityId" }); return; }
  if (!username || typeof username !== "string" || !username.trim()) { res.status(400).json({ error: "username is required" }); return; }
  if (!["view", "edit"].includes(permission)) { res.status(400).json({ error: "permission must be 'view' or 'edit'" }); return; }

  const cfg = ENTITY_TABLES[entityType];

  try {
    // Must own the entity to share it — ownership itself is never touched below.
    const ownedCheck = await db.execute(sql.raw(
      `SELECT id FROM ${cfg.table} WHERE id = ${id} AND user_id = ${userId}`
    ));
    if (!ownedCheck.rows.length) { res.status(404).json({ error: "Entity not found or not owned by you" }); return; }

    const targetResult = await db.execute(sql.raw(
      `SELECT id, username FROM users WHERE username = ${safe(username.trim())} OR email = ${safe(username.trim())}`
    ));
    const target = targetResult.rows[0] as any;
    if (!target) { res.status(404).json({ error: "User not found" }); return; }
    if (Number(target.id) === userId) { res.status(400).json({ error: "You already own this — can't share with yourself" }); return; }

    const result = await db.execute(sql.raw(`
      INSERT INTO vault_shares (entity_type, entity_id, owner_id, shared_with_user_id, permission, is_active, revoked_at)
      VALUES (${safe(entityType)}, ${id}, ${userId}, ${Number(target.id)}, ${safe(permission)}, TRUE, NULL)
      ON CONFLICT (entity_type, entity_id, shared_with_user_id)
      DO UPDATE SET permission = ${safe(permission)}, is_active = TRUE, revoked_at = NULL, updated_at = NOW()
      RETURNING *
    `));

    const share = result.rows[0] as any;

    createNotification(
      Number(target.id),
      "vault_share",
      "New vault item shared with you",
      `Someone shared a ${entityType} vault item with you (${permission} access).`,
      { entityType, entityId: id, shareId: share.id }
    ).catch(() => {});

    res.status(201).json({
      id: share.id,
      entityType: share.entity_type,
      entityId: share.entity_id,
      ownerId: share.owner_id,
      sharedWithUserId: share.shared_with_user_id,
      sharedWithUsername: target.username,
      permission: share.permission,
      isActive: share.is_active,
      createdAt: share.created_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── POST /vault-shares/bulk — share multiple entities (same or mixed
// types) with one user in a single call. Each item is checked for
// ownership independently — one bad item doesn't fail the whole batch.
// body: { items: [{ entityType, entityId }, ...], username, permission? }
router.post("/vault-shares/bulk", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { items, username, permission = "view" } = req.body;

  if (!Array.isArray(items) || !items.length) { res.status(400).json({ error: "items must be a non-empty array of { entityType, entityId }" }); return; }
  if (items.length > 200) { res.status(400).json({ error: "Too many items in one batch (max 200)" }); return; }
  if (!username || typeof username !== "string" || !username.trim()) { res.status(400).json({ error: "username is required" }); return; }
  if (!["view", "edit"].includes(permission)) { res.status(400).json({ error: "permission must be 'view' or 'edit'" }); return; }

  try {
    const targetResult = await db.execute(sql.raw(
      `SELECT id, username FROM users WHERE username = ${safe(username.trim())} OR email = ${safe(username.trim())}`
    ));
    const target = targetResult.rows[0] as any;
    if (!target) { res.status(404).json({ error: "User not found" }); return; }
    if (Number(target.id) === userId) { res.status(400).json({ error: "You already own this — can't share with yourself" }); return; }

    const shared: any[] = [];
    const failed: { entityType: string; entityId: number; reason: string }[] = [];

    for (const item of items) {
      const entityType = item?.entityType;
      const entityId = parseInt(item?.entityId, 10);
      if (!isValidType(entityType) || isNaN(entityId)) {
        failed.push({ entityType: String(entityType), entityId: Number(item?.entityId), reason: "Invalid entityType/entityId" });
        continue;
      }
      const cfg = ENTITY_TABLES[entityType];
      try {
        const ownedCheck = await db.execute(sql.raw(`SELECT id FROM ${cfg.table} WHERE id = ${entityId} AND user_id = ${userId}`));
        if (!ownedCheck.rows.length) {
          failed.push({ entityType, entityId, reason: "Not found or not owned by you" });
          continue;
        }
        const result = await db.execute(sql.raw(`
          INSERT INTO vault_shares (entity_type, entity_id, owner_id, shared_with_user_id, permission, is_active, revoked_at)
          VALUES (${safe(entityType)}, ${entityId}, ${userId}, ${Number(target.id)}, ${safe(permission)}, TRUE, NULL)
          ON CONFLICT (entity_type, entity_id, shared_with_user_id)
          DO UPDATE SET permission = ${safe(permission)}, is_active = TRUE, revoked_at = NULL, updated_at = NOW()
          RETURNING *
        `));
        shared.push(result.rows[0]);
      } catch (err: any) {
        failed.push({ entityType, entityId, reason: err?.message ?? "DB error" });
      }
    }

    if (shared.length) {
      const byType: Record<string, number> = {};
      for (const s of shared as any[]) byType[s.entity_type] = (byType[s.entity_type] ?? 0) + 1;
      const summary = Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(", ");
      createNotification(
        Number(target.id),
        "vault_share",
        "New vault items shared with you",
        `Someone shared ${shared.length} vault item(s) with you (${summary}).`,
        { count: shared.length }
      ).catch(() => {});
    }

    res.status(shared.length ? 201 : 400).json({
      sharedCount: shared.length,
      failedCount: failed.length,
      shared: shared.map((s: any) => ({
        id: s.id, entityType: s.entity_type, entityId: s.entity_id, permission: s.permission, isActive: s.is_active,
      })),
      failed,
    });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});


// ─── GET /vault-shares/sent — entities I own that I've shared out ─────────
router.get("/vault-shares/sent", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const entityType = req.query.entityType as string | undefined;
  try {
    const q = entityType && isValidType(entityType)
      ? sql.raw(`SELECT vs.*, u.username as recipient_username FROM vault_shares vs
                 JOIN users u ON u.id = vs.shared_with_user_id
                 WHERE vs.owner_id = ${userId} AND vs.entity_type = ${safe(entityType)}
                 ORDER BY vs.created_at DESC`)
      : sql.raw(`SELECT vs.*, u.username as recipient_username FROM vault_shares vs
                 JOIN users u ON u.id = vs.shared_with_user_id
                 WHERE vs.owner_id = ${userId}
                 ORDER BY vs.created_at DESC`);
    const result = await db.execute(q);
    const rows = result.rows as any[];

    // Attach a display label per entity without leaking sensitive fields.
    const byType: Record<string, number[]> = {};
    for (const r of rows) (byType[r.entity_type] ??= []).push(r.entity_id);

    const labels: Record<string, Record<number, string>> = {};
    for (const [type, ids] of Object.entries(byType)) {
      const cfg = ENTITY_TABLES[type];
      if (!cfg || !ids.length) continue;
      const entRes = await db.execute(sql.raw(`SELECT * FROM ${cfg.table} WHERE id IN (${ids.join(",")})`));
      labels[type] = {};
      for (const row of entRes.rows as any[]) labels[type][row.id] = cfg.label(row);
    }

    res.json(rows.map(r => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityLabel: labels[r.entity_type]?.[r.entity_id] ?? `#${r.entity_id}`,
      sharedWithUserId: r.shared_with_user_id,
      sharedWithUsername: r.recipient_username,
      permission: r.permission,
      isActive: r.is_active,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
    })));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── GET /vault-shares/received — entities shared with me ─────────────────
router.get("/vault-shares/received", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const entityType = req.query.entityType as string | undefined;
  const activeOnly = req.query.activeOnly !== "false"; // default true
  try {
    const conditions = [`vs.shared_with_user_id = ${userId}`];
    if (activeOnly) conditions.push(`vs.is_active = TRUE`);
    if (entityType && isValidType(entityType)) conditions.push(`vs.entity_type = ${safe(entityType)}`);

    const result = await db.execute(sql.raw(
      `SELECT vs.*, u.username as owner_username FROM vault_shares vs
       JOIN users u ON u.id = vs.owner_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY vs.created_at DESC`
    ));
    const rows = result.rows as any[];

    const byType: Record<string, number[]> = {};
    for (const r of rows) (byType[r.entity_type] ??= []).push(r.entity_id);

    const labels: Record<string, Record<number, string>> = {};
    for (const [type, ids] of Object.entries(byType)) {
      const cfg = ENTITY_TABLES[type];
      if (!cfg || !ids.length) continue;
      const entRes = await db.execute(sql.raw(`SELECT * FROM ${cfg.table} WHERE id IN (${ids.join(",")})`));
      labels[type] = {};
      for (const row of entRes.rows as any[]) labels[type][row.id] = cfg.label(row);
    }

    res.json(rows.map(r => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityLabel: labels[r.entity_type]?.[r.entity_id] ?? `#${r.entity_id}`,
      ownerId: r.owner_id,
      ownerUsername: r.owner_username,
      permission: r.permission,
      isActive: r.is_active,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
    })));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── GET /vault-shares/entity/:entityType/:entityId — fetch the actual data
// for a shared entity. Allowed if the requester owns it, OR has an active
// share on it. This is the read path a recipient uses; it never changes
// user_id on the underlying row.
router.get("/vault-shares/entity/:entityType/:entityId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const entityType = req.params.entityType;
  const entityId = parseInt(req.params.entityId as string, 10);
  if (!isValidType(entityType)) { res.status(400).json({ error: `entityType must be one of: ${VALID_TYPES.join(", ")}` }); return; }
  if (isNaN(entityId)) { res.status(400).json({ error: "Invalid entityId" }); return; }

  const cfg = ENTITY_TABLES[entityType];

  try {
    const ownRes = await db.execute(sql.raw(`SELECT * FROM ${cfg.table} WHERE id = ${entityId} AND user_id = ${userId}`));
    if (ownRes.rows.length) {
      res.json({ access: "owner", permission: "edit", entity: decryptRow(ownRes.rows[0] as any, cfg.sensitive as any) });
      return;
    }

    const shareRes = await db.execute(sql.raw(
      `SELECT * FROM vault_shares WHERE entity_type = ${safe(entityType)} AND entity_id = ${entityId}
       AND shared_with_user_id = ${userId} AND is_active = TRUE`
    ));
    const share = shareRes.rows[0] as any;
    if (!share) { res.status(403).json({ error: "Not shared with you" }); return; }

    const entRes = await db.execute(sql.raw(`SELECT * FROM ${cfg.table} WHERE id = ${entityId}`));
    if (!entRes.rows.length) { res.status(404).json({ error: "Entity no longer exists" }); return; }

    res.json({ access: "shared", permission: share.permission, entity: decryptRow(entRes.rows[0] as any, cfg.sensitive as any) });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── PATCH /vault-shares/bulk — toggle isActive/permission on many shares
// at once. Must be registered before "/vault-shares/:id" so "bulk" isn't
// matched as an :id.
// body: { ids: number[], isActive?: boolean, permission?: 'view'|'edit' }
router.patch("/vault-shares/bulk", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { ids, isActive, permission } = req.body;
  if (!Array.isArray(ids) || !ids.length) { res.status(400).json({ error: "ids must be a non-empty array" }); return; }
  const cleanIds = ids.map((i: unknown) => parseInt(i as string, 10)).filter((n: number) => !isNaN(n));
  if (!cleanIds.length) { res.status(400).json({ error: "No valid ids provided" }); return; }
  if (permission !== undefined && !["view", "edit"].includes(permission)) { res.status(400).json({ error: "permission must be 'view' or 'edit'" }); return; }

  const sets: string[] = ["updated_at = NOW()"];
  if (typeof isActive === "boolean") {
    sets.push(`is_active = ${isActive ? "TRUE" : "FALSE"}`);
    sets.push(`revoked_at = ${isActive ? "NULL" : "NOW()"}`);
  }
  if (permission !== undefined) sets.push(`permission = ${safe(permission)}`);

  try {
    const result = await db.execute(sql.raw(
      `UPDATE vault_shares SET ${sets.join(", ")} WHERE id IN (${cleanIds.join(",")}) AND owner_id = ${userId} RETURNING *`
    ));
    const rows = result.rows as any[];

    if (typeof isActive === "boolean" && !isActive) {
      for (const share of rows) {
        createNotification(
          Number(share.shared_with_user_id),
          "vault_share",
          "Shared access removed",
          `Access to a shared ${share.entity_type} vault item was turned off.`,
          { entityType: share.entity_type, entityId: share.entity_id }
        ).catch(() => {});
      }
    }

    res.json({ updatedCount: rows.length, updated: rows.map(s => ({ id: s.id, isActive: s.is_active, permission: s.permission })) });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── DELETE /vault-shares/bulk — remove many share records at once ────────
// Registered before "/vault-shares/:id" for the same reason as above.
// body: { ids: number[] }
router.delete("/vault-shares/bulk", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) { res.status(400).json({ error: "ids must be a non-empty array" }); return; }
  const cleanIds = ids.map((i: unknown) => parseInt(i as string, 10)).filter((n: number) => !isNaN(n));
  if (!cleanIds.length) { res.status(400).json({ error: "No valid ids provided" }); return; }
  try {
    const result = await db.execute(sql.raw(
      `DELETE FROM vault_shares WHERE id IN (${cleanIds.join(",")}) AND owner_id = ${userId} RETURNING id`
    ));
    res.json({ deletedCount: result.rows.length });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── PATCH /vault-shares/:id — owner toggles access on/off, or changes permission
// Setting isActive to false is the "turn permission off" action — the item
// immediately stops showing up under the recipient's "shared with me" list.
router.patch("/vault-shares/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { isActive, permission } = req.body;

  const sets: string[] = ["updated_at = NOW()"];
  if (typeof isActive === "boolean") {
    sets.push(`is_active = ${isActive ? "TRUE" : "FALSE"}`);
    sets.push(`revoked_at = ${isActive ? "NULL" : "NOW()"}`);
  }
  if (permission !== undefined) {
    if (!["view", "edit"].includes(permission)) { res.status(400).json({ error: "permission must be 'view' or 'edit'" }); return; }
    sets.push(`permission = ${safe(permission)}`);
  }

  try {
    const result = await db.execute(sql.raw(
      `UPDATE vault_shares SET ${sets.join(", ")} WHERE id = ${id} AND owner_id = ${userId} RETURNING *`
    ));
    if (!result.rows.length) { res.status(404).json({ error: "Not found or not yours to manage" }); return; }
    const share = result.rows[0] as any;

    if (typeof isActive === "boolean" && !isActive) {
      createNotification(
        Number(share.shared_with_user_id),
        "vault_share",
        "Shared access removed",
        `Access to a shared ${share.entity_type} vault item was turned off.`,
        { entityType: share.entity_type, entityId: share.entity_id }
      ).catch(() => {});
    }

    res.json({
      id: share.id,
      entityType: share.entity_type,
      entityId: share.entity_id,
      isActive: share.is_active,
      permission: share.permission,
      revokedAt: share.revoked_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── DELETE /vault-shares/:id — owner removes the share record entirely ───
router.delete("/vault-shares/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const result = await db.execute(sql.raw(
      `DELETE FROM vault_shares WHERE id = ${id} AND owner_id = ${userId} RETURNING id`
    ));
    if (!result.rows.length) { res.status(404).json({ error: "Not found or not yours to manage" }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

export default router;
