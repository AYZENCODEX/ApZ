import { Router } from "express";
import { db, emailAccountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getUserIdAsync } from "../lib/auth-utils";

const router = Router();

async function getAccount(userId: number, id: number) {
  const [row] = await db.select().from(emailAccountsTable)
    .where(and(eq(emailAccountsTable.id, id), eq(emailAccountsTable.userId, userId)));
  return row ?? null;
}

// Send email via SMTP
router.post("/email-accounts/:id/send", async (req, res): Promise<void> => {
  const userId = await getUserIdAsync(req);
  const id = parseInt(req.params.id as string, 10);
  const acc = await getAccount(userId, id);
  if (!acc) { res.status(404).json({ error: "Account not found" }); return; }
  if (!acc.smtpHost || !acc.password) {
    res.status(400).json({ error: "SMTP host and password are required to send email" }); return;
  }

  const { to, subject, body, html } = req.body;
  if (!to || !subject || (!body && !html)) {
    res.status(400).json({ error: "to, subject, and body are required" }); return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: acc.smtpHost,
      port: acc.smtpPort ?? 587,
      secure: (acc.smtpPort ?? 587) === 465,
      auth: { user: acc.username ?? acc.emailAddress, pass: acc.password },
      tls: { rejectUnauthorized: false },
    });

    const info = await transporter.sendMail({
      from: `${acc.label} <${acc.emailAddress}>`,
      to,
      subject,
      text: body,
      html: html ?? body,
    });

    res.json({ success: true, messageId: info.messageId, accepted: info.accepted });
  } catch (err: any) {
    res.status(500).json({ error: `SMTP error: ${err?.message ?? "Send failed"}` });
  }
});

// Fetch inbox via IMAP
router.get("/email-accounts/:id/inbox", async (req, res): Promise<void> => {
  const userId = await getUserIdAsync(req);
  const id = parseInt(req.params.id as string, 10);
  const acc = await getAccount(userId, id);
  if (!acc) { res.status(404).json({ error: "Account not found" }); return; }
  if (!acc.imapHost || !acc.password) {
    res.status(400).json({ error: "IMAP host and password are required" }); return;
  }

  try {
    // Dynamic import to avoid startup errors
    const imapSimple = await import("imap-simple");
    const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 50);
    const folder = (req.query.folder as string) ?? "INBOX";

    const config = {
      imap: {
        user: acc.username ?? acc.emailAddress,
        password: acc.password,
        host: acc.imapHost,
        port: acc.imapPort ?? 993,
        tls: acc.useSSL !== false,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
        connTimeout: 15000,
      },
    };

    const connection = await imapSimple.connect(config);
    await connection.openBox(folder);

    // Get latest N messages
    const searchCriteria = ["ALL"];
    const fetchOptions = {
      bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)", "TEXT"],
      markSeen: false,
      struct: false,
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    connection.end();

    // Parse and return latest N
    const parsed = messages
      .slice(-limit)
      .reverse()
      .map((msg: any) => {
        const headerPart = msg.parts.find((p: any) => p.which === "HEADER.FIELDS (FROM TO SUBJECT DATE)");
        const textPart = msg.parts.find((p: any) => p.which === "TEXT");
        const header = headerPart?.body ?? {};
        return {
          uid: msg.attributes.uid,
          seqno: msg.seqno,
          flags: msg.attributes.flags ?? [],
          date: (header.date?.[0] ?? "").trim(),
          from: (header.from?.[0] ?? "").trim(),
          to: (header.to?.[0] ?? "").trim(),
          subject: (header.subject?.[0] ?? "(no subject)").trim(),
          preview: (textPart?.body ?? "").substring(0, 200).replace(/\s+/g, " ").trim(),
        };
      });

    res.json({ folder, count: parsed.length, messages: parsed });
  } catch (err: any) {
    const msg = err?.message ?? "IMAP connection failed";
    const hint = msg.includes("Invalid credentials") ? " — Check username/password (Gmail needs App Password)" : "";
    res.status(500).json({ error: `IMAP error: ${msg}${hint}` });
  }
});

// Test SMTP connection
router.post("/email-accounts/:id/test", async (req, res): Promise<void> => {
  const userId = await getUserIdAsync(req);
  const id = parseInt(req.params.id as string, 10);
  const acc = await getAccount(userId, id);
  if (!acc) { res.status(404).json({ error: "Account not found" }); return; }
  if (!acc.smtpHost || !acc.password) {
    res.status(400).json({ error: "SMTP host and password required" }); return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: acc.smtpHost,
      port: acc.smtpPort ?? 587,
      secure: (acc.smtpPort ?? 587) === 465,
      auth: { user: acc.username ?? acc.emailAddress, pass: acc.password },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
    res.json({ success: true, message: "SMTP connection verified" });
  } catch (err: any) {
    res.status(500).json({ error: `SMTP verify failed: ${err?.message}` });
  }
});

export default router;
