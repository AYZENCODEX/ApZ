import { Router } from "express";
import { sendTestEmail, sendEmail } from "../lib/email";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function getAuthUserId(req: any): { id: number; role: string } | null {
  const auth = req.headers.authorization as string | undefined;
  if (!auth) return null;
  try {
    const payload = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return { id: payload.userId, role: payload.role ?? "user" };
  } catch { return null; }
}

// POST /email/test — admin sends a test email to themselves
router.post("/email/test", async (req, res): Promise<void> => {
  const authUser = getAuthUserId(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (authUser.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const { to } = req.body as { to?: string };
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, authUser.id));
  const target = to || user?.email;
  if (!target) { res.status(400).json({ error: "No email address" }); return; }

  const result = await sendTestEmail(target);
  if (result.success) {
    res.json({ success: true, message: `Test email sent to ${target}`, id: result.id });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// POST /email/broadcast — admin sends email to all users
router.post("/email/broadcast", async (req, res): Promise<void> => {
  const authUser = getAuthUserId(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (authUser.role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }

  const { subject, html, text } = req.body as { subject?: string; html?: string; text?: string };
  if (!subject || !html) { res.status(400).json({ error: "subject and html are required" }); return; }

  const users = await db.select({ email: usersTable.email, username: usersTable.username })
    .from(usersTable);

  let sent = 0;
  let failed = 0;
  for (const u of users) {
    const result = await sendEmail({ to: u.email, subject, html, text });
    if (result.success) sent++; else failed++;
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  res.json({ success: true, sent, failed });
});

export default router;
