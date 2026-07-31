import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { syncOnLocalAccountUpdate, syncOnLocalAccountDelete } from "../services/sync";
import { encryptField, decryptRow, decryptRows } from "../lib/vault-crypto";

const router = Router();

// Credential columns encrypted at rest (see lib/vault-crypto.ts).
const LOCAL_SENSITIVE_FIELDS = ["password", "recovery_email_password", "backup_codes", "twofa", "recovery_email_twofa"] as const;

const DEFAULT_CATEGORIES = [
  { id: "facebook",  name: "Facebook",  color: "#1877F2", icon: "facebook" },
  { id: "github",    name: "GitHub",    color: "#24292e", icon: "github" },
  { id: "google",    name: "Google",    color: "#EA4335", icon: "google" },
  { id: "twitter",   name: "Twitter",   color: "#1DA1F2", icon: "twitter" },
  { id: "discord",   name: "Discord",   color: "#5865F2", icon: "discord" },
];

// Safely escape a string for SQL — only used for string values; integers are coerced with Number()
const safe = (v: unknown) => v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const safeNum = (v: unknown) => isNaN(Number(v)) ? 0 : Number(v);
const safeDate = (v: unknown) => v ? `'${String(v).replace(/'/g, "''")}'` : "NULL";
// Rank/badge score — clamped to the 0-10 scale the 5-tier badge system expects.
const safeScore = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : 5;
};

// ─── GET /local-accounts — list user's accounts ───────────────────────────────
// Supports ?category=twitter&linked=false (unlinked only) or ?vaultEntryId=123
router.get("/local-accounts", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const category = (req.query.category as string) || null;
  const linkedParam = req.query.linked as string | undefined;   // "false" = only unlinked
  const vaultEntryId = req.query.vaultEntryId ? parseInt(req.query.vaultEntryId as string) : null;
  try {
    let where = `user_id = ${userId}`;
    if (category) where += ` AND category = ${safe(category)}`;
    if (linkedParam === "false") where += ` AND vault_entry_id IS NULL`;
    if (vaultEntryId && !isNaN(vaultEntryId)) where += ` AND vault_entry_id = ${vaultEntryId}`;
    const result = await db.execute(sql.raw(`SELECT * FROM local_accounts WHERE ${where} ORDER BY created_at DESC`));
    res.json(decryptRows(result.rows as any[], LOCAL_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── POST /local-accounts — create account ────────────────────────────────────
router.post("/local-accounts", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const {
    category = "Other", label = null, username = null,
    email = null, password = null,
    recoveryEmail = null, recoveryEmailPassword = null,
    backupCodes = null, twofa = null, recoveryEmailTwofa = null,
    followers = null, accountWorth = 0, buyPrice = 0,
    accountCreateDate = null, accountBuyDate = null, accountLastLoginDate = null,
    notes = null, score = 5,
  } = req.body;

  if (!category) { res.status(400).json({ error: "Category required" }); return; }

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO local_accounts
        (user_id, category, label, username, email, password, recovery_email, recovery_email_password,
         backup_codes, twofa, recovery_email_twofa, followers, account_worth, buy_price,
         account_create_date, account_buy_date, account_last_login_date, notes, score)
      VALUES
        (${userId}, ${safe(category)}, ${safe(label)}, ${safe(username)}, ${safe(email)}, ${safe(encryptField(password))},
         ${safe(recoveryEmail)}, ${safe(encryptField(recoveryEmailPassword))}, ${safe(encryptField(backupCodes))}, ${safe(encryptField(twofa))},
         ${safe(encryptField(recoveryEmailTwofa))}, ${safe(followers)}, ${safeNum(accountWorth)}, ${safeNum(buyPrice)},
         ${safeDate(accountCreateDate)}, ${safeDate(accountBuyDate)}, ${safeDate(accountLastLoginDate)},
         ${safe(notes)}, ${safeScore(score)})
      RETURNING *
    `));
    res.status(201).json(decryptRow(result.rows[0] as any, LOCAL_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── PUT /local-accounts/:id — update account ────────────────────────────────
router.put("/local-accounts/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const {
    category, label, username, email, password,
    recoveryEmail, recoveryEmailPassword,
    backupCodes, twofa, recoveryEmailTwofa,
    followers, accountWorth, buyPrice,
    accountCreateDate, accountBuyDate, accountLastLoginDate, notes, score,
  } = req.body;

  try {
    const result = await db.execute(sql.raw(`
      UPDATE local_accounts SET
        category = ${safe(category)}, label = ${safe(label)}, username = ${safe(username)},
        email = ${safe(email)}, password = ${safe(encryptField(password))},
        recovery_email = ${safe(recoveryEmail)}, recovery_email_password = ${safe(encryptField(recoveryEmailPassword))},
        backup_codes = ${safe(encryptField(backupCodes))}, twofa = ${safe(encryptField(twofa))},
        recovery_email_twofa = ${safe(encryptField(recoveryEmailTwofa))},
        followers = ${safe(followers)}, account_worth = ${safeNum(accountWorth)},
        buy_price = ${safeNum(buyPrice)},
        account_create_date = ${safeDate(accountCreateDate)},
        account_buy_date = ${safeDate(accountBuyDate)},
        account_last_login_date = ${safeDate(accountLastLoginDate)},
        notes = ${safe(notes)},
        score = ${score !== undefined ? safeScore(score) : "score"}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `));
    if (!result.rows.length) { res.status(404).json({ error: "Not found or forbidden" }); return; }
    syncOnLocalAccountUpdate(id).catch(() => {});
    res.json(decryptRow(result.rows[0] as any, LOCAL_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── PATCH /local-accounts/:id/status — ban / unban account ─────────────────
router.patch("/local-accounts/:id/status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const allowed = ["active", "banned"];
  const status = req.body.status;
  if (!allowed.includes(status)) { res.status(400).json({ error: "status must be one of: active, banned" }); return; }

  try {
    const result = await db.execute(sql.raw(`
      UPDATE local_accounts SET status = ${safe(status)}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `));
    if (!result.rows.length) { res.status(404).json({ error: "Not found or forbidden" }); return; }
    syncOnLocalAccountUpdate(id).catch(() => {});
    res.json(decryptRow(result.rows[0] as any, LOCAL_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── DELETE /local-accounts/:id — delete account ─────────────────────────────
router.delete("/local-accounts/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.execute(sql.raw(`DELETE FROM local_accounts WHERE id = ${id} AND user_id = ${userId}`));
    syncOnLocalAccountDelete(id).catch(() => {});
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── PATCH /local-accounts/:id/link-vault — link to a vault entry ────────────
router.patch("/local-accounts/:id/link-vault", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { vaultEntryId } = req.body as { vaultEntryId: number };
  if (!vaultEntryId || isNaN(Number(vaultEntryId))) { res.status(400).json({ error: "vaultEntryId required" }); return; }
  try {
    const result = await db.execute(sql.raw(
      `UPDATE local_accounts SET vault_entry_id = ${Number(vaultEntryId)}, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId} RETURNING *`
    ));
    if (!result.rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(decryptRow(result.rows[0] as any, LOCAL_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── PATCH /local-accounts/:id/unlink-vault — remove vault link ──────────────
router.patch("/local-accounts/:id/unlink-vault", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const result = await db.execute(sql.raw(
      `UPDATE local_accounts SET vault_entry_id = NULL, updated_at = NOW()
       WHERE id = ${id} AND user_id = ${userId} RETURNING *`
    ));
    if (!result.rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(decryptRow(result.rows[0] as any, LOCAL_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── GET /local-accounts/categories — list categories ────────────────────────
router.get("/local-accounts/categories", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const result = await db.execute(sql.raw(
      `SELECT * FROM local_account_categories WHERE user_id = ${userId} ORDER BY created_at ASC`
    ));
    res.json({ defaults: DEFAULT_CATEGORIES, custom: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── POST /local-accounts/categories — create category ───────────────────────
router.post("/local-accounts/categories", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { name } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "Category name required" }); return; }
  try {
    const result = await db.execute(sql.raw(
      `INSERT INTO local_account_categories (user_id, name) VALUES (${userId}, ${safe(name.trim())}) RETURNING *`
    ));
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── DELETE /local-accounts/categories/:id — delete category ─────────────────
router.delete("/local-accounts/categories/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.execute(sql.raw(`DELETE FROM local_account_categories WHERE id = ${id} AND user_id = ${userId}`));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── GET /local-accounts/:id — fetch single account ──────────────────────────
// Must be registered AFTER all literal sub-paths (/categories, etc.) so Express
// doesn't swallow them as param values.
router.get("/local-accounts/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const result = await db.execute(sql.raw(
      `SELECT * FROM local_accounts WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
    ));
    if (!result.rows.length) { res.status(404).json({ error: "Account not found" }); return; }
    res.json(decryptRow(result.rows[0] as any, LOCAL_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── GET /local-accounts/:id/points ──────────────────────────────────────────
router.get("/local-accounts/:id/points", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const accountId = parseInt(req.params.id as string);
  if (isNaN(accountId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const result = await db.execute(sql.raw(
      `SELECT * FROM local_account_points WHERE account_id = ${accountId} AND user_id = ${userId} ORDER BY created_at DESC`
    ));
    const rows = result.rows as any[];
    const total = rows.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
    res.json({ entries: rows, total });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── POST /local-accounts/:id/points ─────────────────────────────────────────
router.post("/local-accounts/:id/points", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const accountId = parseInt(req.params.id as string);
  if (isNaN(accountId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { amount, notes = null } = req.body;
  if (!amount || isNaN(Number(amount))) { res.status(400).json({ error: "amount required" }); return; }
  try {
    const result = await db.execute(sql.raw(
      `INSERT INTO local_account_points (account_id, user_id, amount, notes) VALUES (${accountId}, ${userId}, ${Number(amount)}, ${safe(notes)}) RETURNING *`
    ));
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── DELETE /local-accounts/points/:pointId ──────────────────────────────────
router.delete("/local-accounts/points/:pointId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const pointId = parseInt(req.params.pointId as string);
  if (isNaN(pointId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.execute(sql.raw(`DELETE FROM local_account_points WHERE id = ${pointId} AND user_id = ${userId}`));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

export default router;
