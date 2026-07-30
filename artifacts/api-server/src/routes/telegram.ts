import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { broadcastToAll, verifyTelegramCode, getBot } from "../lib/telegram";

const router = Router();

function getUserFromAuth(req: { headers: { authorization?: string } }): { id: number; role: string } | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try {
    const payload = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return { id: payload.userId, role: payload.role ?? "user" };
  } catch {
    return null;
  }
}

// POST /telegram/connect/verify — user submits the 6-digit code from the bot (chatId not needed)
router.post("/telegram/connect/verify", async (req, res): Promise<void> => {
  const authUser = getUserFromAuth(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ error: "code is required" }); return; }

  const ok = await verifyTelegramCode(code, authUser.id);
  if (!ok) { res.status(400).json({ error: "Invalid or expired code — open the bot and send /connect for a new code" }); return; }

  res.json({ success: true, message: "Telegram account linked successfully" });
});

// GET /telegram/me — current user's link status
router.get("/telegram/me", async (req, res): Promise<void> => {
  const authUser = getUserFromAuth(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db
    .select({ telegramChatId: usersTable.telegramChatId, telegramUsername: usersTable.telegramUsername })
    .from(usersTable)
    .where(eq(usersTable.id, authUser.id))
    .limit(1);
  const row = rows[0];
  res.json({
    linked: !!row?.telegramChatId,
    chatId: row?.telegramChatId ?? null,
    username: row?.telegramUsername ?? null,
  });
});

// DELETE /telegram/disconnect — unlink Telegram
router.delete("/telegram/disconnect", async (req, res): Promise<void> => {
  const authUser = getUserFromAuth(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  await db
    .update(usersTable)
    .set({ telegramChatId: null, telegramUsername: null })
    .where(eq(usersTable.id, authUser.id));
  res.json({ success: true });
});

// POST /telegram/broadcast — admin: push message to all connected users
router.post("/telegram/broadcast", async (req, res): Promise<void> => {
  const authUser = getUserFromAuth(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (authUser.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const { message } = req.body as { message?: string };
  if (!message) { res.status(400).json({ error: "message is required" }); return; }

  const sent = await broadcastToAll(`📣 *AYZEN Broadcast*\n\n${message}`);
  res.json({ success: true, sent });
});

// POST /telegram/test — admin: send "AYZEN is working" test blast
router.post("/telegram/test", async (req, res): Promise<void> => {
  const authUser = getUserFromAuth(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (authUser.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const bot = getBot();
  if (!bot) {
    res.status(503).json({ error: "Telegram bot not configured — check TELEGRAM_BOT_TOKEN" });
    return;
  }

  const sent = await broadcastToAll(
    "✅ *AYZEN is working!*\n\nThe Airdrop Command Center is fully operational.\nAll systems are online. Ready to dominate every airdrop. 🚀"
  );
  res.json({ success: true, sent, message: "AYZEN is working" });
});

// GET /telegram/status — bot health check
router.get("/telegram/status", async (_req, res): Promise<void> => {
  const bot = getBot();
  if (!bot) {
    res.json({ online: false, reason: "TELEGRAM_BOT_TOKEN not configured" });
    return;
  }
  try {
    const info = await bot.getMe();
    res.json({ online: true, username: info.username, name: info.first_name, id: info.id });
  } catch (err: any) {
    res.json({ online: false, reason: err?.message });
  }
});

export default router;
