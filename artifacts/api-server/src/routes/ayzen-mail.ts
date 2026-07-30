import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// GET /ayzen-mail — inbox for current user
router.get("/ayzen-mail", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const result = await db.execute(sql`
      SELECT m.*, u.username as from_username, u.email as from_email
      FROM ayzen_mail m
      LEFT JOIN users u ON u.id = m.from_user_id
      WHERE m.to_user_id = ${userId} AND m.deleted_by_receiver = false
      ORDER BY m.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch { res.json([]); }
});

// GET /ayzen-mail/sent — sent items for current user
router.get("/ayzen-mail/sent", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const result = await db.execute(sql`
      SELECT m.*, u.username as to_username, u.email as to_email
      FROM ayzen_mail m
      LEFT JOIN users u ON u.id = m.to_user_id
      WHERE m.from_user_id = ${userId} AND m.deleted_by_sender = false
      ORDER BY m.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch { res.json([]); }
});

// GET /ayzen-mail/unread-count
router.get("/ayzen-mail/unread-count", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM ayzen_mail WHERE to_user_id = ${userId} AND is_read = false AND deleted_by_receiver = false`);
    res.json({ count: parseInt(String((result.rows[0] as any)?.count ?? 0), 10) });
  } catch { res.json({ count: 0 }); }
});

// POST /ayzen-mail — compose and send
router.post("/ayzen-mail", requireAuth, async (req, res): Promise<void> => {
  const fromUserId = req.user!.userId;
  const { to, subject, body } = req.body;
  if (!to || !body) { res.status(400).json({ error: "to and body are required" }); return; }
  const target = await db.execute(sql`SELECT id, username, email FROM users WHERE username = ${to} OR email = ${to} LIMIT 1`);
  if (target.rows.length === 0) { res.status(404).json({ error: "Recipient not found" }); return; }
  const toUser = target.rows[0] as any;
  const result = await db.execute(sql`
    INSERT INTO ayzen_mail (from_user_id, to_user_id, subject, body)
    VALUES (${fromUserId}, ${toUser.id}, ${subject || "(no subject)"}, ${body})
    RETURNING *
  `);
  res.status(201).json(result.rows[0]);
});

// PATCH /ayzen-mail/:id/read — mark as read
router.patch("/ayzen-mail/:id/read", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.execute(sql`UPDATE ayzen_mail SET is_read = true WHERE id = ${id} AND to_user_id = ${userId}`);
  res.json({ success: true });
});

// DELETE /ayzen-mail/:id — soft delete
router.delete("/ayzen-mail/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const mail = await db.execute(sql`SELECT from_user_id, to_user_id FROM ayzen_mail WHERE id = ${id}`);
  if (mail.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const m = mail.rows[0] as any;
  if (m.to_user_id === userId) {
    await db.execute(sql`UPDATE ayzen_mail SET deleted_by_receiver = true WHERE id = ${id}`);
  } else if (m.from_user_id === userId) {
    await db.execute(sql`UPDATE ayzen_mail SET deleted_by_sender = true WHERE id = ${id}`);
  } else {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json({ success: true });
});

export default router;
