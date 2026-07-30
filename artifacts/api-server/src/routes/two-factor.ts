import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { encryptField, decryptField } from "../lib/vault-crypto";

const router = Router();

// ── GET /two-factor/all — aggregate from all sources ─────────────────────────
router.get("/two-factor/all", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;

  const [localResult, entityResult, otherResult] = await Promise.all([
    db.execute(sql.raw(
      `SELECT id, label, username, email, twofa as secret, 'local' as source_type, category as label_extra
       FROM local_accounts WHERE user_id = ${userId} AND twofa IS NOT NULL AND twofa != ''`
    )),
    db.execute(sql.raw(
      `SELECT id, entity_serial as label,
         twitter_2fa, discord_2fa, telegram_2fa
       FROM vault_entries WHERE user_id = ${userId}
       AND (twitter_2fa IS NOT NULL OR discord_2fa IS NOT NULL OR telegram_2fa IS NOT NULL)`
    )).catch(() => ({ rows: [] })),
    db.execute(sql.raw(
      `SELECT id, label, secret, notes, created_at FROM other_two_factor_codes WHERE user_id = ${userId} ORDER BY created_at DESC`
    )).catch(() => ({ rows: [] })),
  ]);

  const entityFlattened: any[] = [];
  for (const e of (entityResult as any).rows as any[]) {
    if (e.twitter_2fa) entityFlattened.push({ id: `e-${e.id}-tw`, label: `${e.label} / Twitter`, secret: e.twitter_2fa, source_type: "entity", source_id: e.id });
    if (e.discord_2fa) entityFlattened.push({ id: `e-${e.id}-dc`, label: `${e.label} / Discord`, secret: e.discord_2fa, source_type: "entity", source_id: e.id });
    if (e.telegram_2fa) entityFlattened.push({ id: `e-${e.id}-tg`, label: `${e.label} / Telegram`, secret: e.telegram_2fa, source_type: "entity", source_id: e.id });
  }

  res.json({
    local: (localResult.rows as any[]).map(r => ({ ...r, secret: decryptField(r.secret) })),
    entity: entityFlattened.map(r => ({ ...r, secret: decryptField(r.secret) })),
    other: ((otherResult as any).rows as any[]).map(r => ({ ...r, secret: decryptField(r.secret) })),
  });
});

// ── GET /two-factor/other — list manual 2FA entries ──────────────────────────
router.get("/two-factor/other", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const result = await db.execute(sql.raw(
    `SELECT * FROM other_two_factor_codes WHERE user_id = ${userId} ORDER BY created_at DESC`
  ));
  res.json((result.rows as any[]).map(r => ({ ...r, secret: decryptField(r.secret) })));
});

// ── POST /two-factor/other — create manual 2FA entry ─────────────────────────
router.post("/two-factor/other", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { label, secret, notes } = req.body;
  if (!label || !secret) { res.status(400).json({ error: "label and secret are required" }); return; }
  const encSecret = (encryptField(secret) as string).replace(/'/g, "''");
  const result = await db.execute(sql.raw(
    `INSERT INTO other_two_factor_codes (user_id, label, secret, notes)
     VALUES (${userId}, '${label.replace(/'/g, "''")}', '${encSecret}', ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"})
     RETURNING *`
  ));
  res.status(201).json({ ...result.rows[0], secret: decryptField((result.rows[0] as any).secret) });
});

// ── PATCH /two-factor/other/:id — update manual 2FA entry ────────────────────
router.patch("/two-factor/other/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { label, secret, notes } = req.body;
  const sets: string[] = [];
  if (label) sets.push(`label = '${label.replace(/'/g, "''")}'`);
  if (secret) sets.push(`secret = '${(encryptField(secret) as string).replace(/'/g, "''")}'`);
  if (notes !== undefined) sets.push(`notes = ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"}`);
  if (!sets.length) { res.status(400).json({ error: "Nothing to update" }); return; }
  const result = await db.execute(sql.raw(
    `UPDATE other_two_factor_codes SET ${sets.join(", ")} WHERE id = ${id} AND user_id = ${userId} RETURNING *`
  ));
  if (!result.rows.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...result.rows[0], secret: decryptField((result.rows[0] as any).secret) });
});

// ── DELETE /two-factor/other/:id — delete manual 2FA entry ───────────────────
router.delete("/two-factor/other/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.execute(sql.raw(`DELETE FROM other_two_factor_codes WHERE id = ${id} AND user_id = ${userId}`));
  res.json({ ok: true });
});

export default router;
