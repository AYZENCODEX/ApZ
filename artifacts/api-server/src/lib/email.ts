import { logger } from "./logger";

const FROM_DEFAULT = "AYZEN <noreply@ayzen.tech>";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendResult {
  success: boolean;
  id?: string;
  error?: string;
}

async function getSmtpConfig(): Promise<{ host: string; port: number; user: string; pass: string; from: string } | null> {
  try {
    const { pool } = await import("@workspace/db");
    const r = await pool.query("SELECT smtp_host, smtp_port, smtp_user, smtp_password, smtp_from FROM settings LIMIT 1");
    const row = r.rows[0];
    if (!row?.smtp_host || !row?.smtp_user || !row?.smtp_password) return null;
    return { host: row.smtp_host, port: row.smtp_port ?? 587, user: row.smtp_user, pass: row.smtp_password, from: row.smtp_from ?? row.smtp_user };
  } catch { return null; }
}

async function sendViaSmtp(cfg: NonNullable<Awaited<ReturnType<typeof getSmtpConfig>>>, opts: EmailOptions): Promise<SendResult> {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.default.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
  await transport.sendMail({ from: cfg.from || FROM_DEFAULT, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
  logger.info({ to: opts.to }, "Email sent via SMTP");
  return { success: true };
}

async function sendViaResend(opts: EmailOptions): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { success: false, error: "No email transport configured (no SMTP settings, no RESEND_API_KEY)" };
  const { Resend } = await import("resend");
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({ from: FROM_DEFAULT, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
  if (error) { logger.warn({ error }, "Resend error"); return { success: false, error: error.message }; }
  logger.info({ id: data?.id, to: opts.to }, "Email sent via Resend");
  return { success: true, id: data?.id };
}

export async function sendEmail(opts: EmailOptions): Promise<SendResult> {
  try {
    const smtpCfg = await getSmtpConfig();
    if (smtpCfg) return await sendViaSmtp(smtpCfg, opts);
    return await sendViaResend(opts);
  } catch (err: any) {
    logger.error({ err: err?.message }, "sendEmail failed");
    return { success: false, error: err?.message ?? "Unknown error" };
  }
}

function baseTemplate(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;padding:0;background:#0a0d12;font-family:'Courier New',monospace;color:#e0f7f7;}
  .wrap{max-width:560px;margin:40px auto;background:#0d1117;border:1px solid #1a3a3a;border-radius:8px;overflow:hidden;}
  .header{padding:28px 32px;border-bottom:1px solid #1a3a3a;background:#070a0f;}
  .logo{font-size:22px;font-weight:bold;letter-spacing:4px;color:#00d4cc;}
  .sub{font-size:10px;letter-spacing:3px;color:#4a8080;margin-top:4px;text-transform:uppercase;}
  .body{padding:32px;}
  h2{color:#00d4cc;font-size:16px;letter-spacing:2px;text-transform:uppercase;margin:0 0 16px;}
  p{color:#a0c8c8;font-size:13px;line-height:1.7;margin:0 0 12px;}
  .btn{display:inline-block;background:#00d4cc;color:#070a0f;padding:12px 28px;border-radius:4px;text-decoration:none;font-weight:bold;font-size:13px;letter-spacing:2px;text-transform:uppercase;margin:16px 0;}
  .footer{padding:20px 32px;border-top:1px solid #1a3a3a;font-size:10px;color:#2a5050;letter-spacing:1px;}
  .divider{height:1px;background:linear-gradient(to right,transparent,#00d4cc40,transparent);margin:24px 0;}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">&gt;_ AYZEN</div>
    <div class="sub">Airdrop Command Center</div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    &copy; 2026 AYZEN &mdash; Encrypted. Autonomous. Profitable.<br/>
    If you didn't request this, ignore this message.
  </div>
</div>
</body>
</html>`;
}

export async function sendWelcomeEmail(to: string, username: string): Promise<void> {
  const html = baseTemplate(`
    <h2>Access Granted, ${username}</h2>
    <p>Welcome to <strong>AYZEN</strong> — your encrypted airdrop command center.</p>
    <p>You now have access to real-time airdrop tracking, task automation, ROI tracking, and the Telegram bot integration.</p>
    <div class="divider"></div>
    <p style="font-size:11px;color:#4a8080;">Connect Telegram for live task notifications: go to Settings → Telegram Bot → /connect</p>
  `);
  await sendEmail({ to, subject: "Access Granted — Welcome to AYZEN", html });
}

export async function sendPasswordChangedEmail(to: string, username: string): Promise<void> {
  const html = baseTemplate(`
    <h2>Password Changed</h2>
    <p>Hi <strong>${username}</strong>, your AYZEN passphrase was successfully updated.</p>
    <p>If you did not make this change, contact support immediately at <a href="mailto:support@ayzen.tech" style="color:#00d4cc;">support@ayzen.tech</a>.</p>
    <div class="divider"></div>
    <p style="font-size:11px;color:#4a8080;">Security event logged at ${new Date().toUTCString()}</p>
  `);
  await sendEmail({ to, subject: "AYZEN — Passphrase Updated", html });
}

export async function sendTaskApprovedEmail(to: string, username: string, taskName: string, reward?: number | null): Promise<void> {
  const rewardStr = reward ? `<br/>💰 Reward: <strong style="color:#00d4cc;">$${reward}</strong>` : "";
  const html = baseTemplate(`
    <h2>Task Approved ✓</h2>
    <p>Hi <strong>${username}</strong>, your task submission has been verified!</p>
    <p>📋 Task: <strong>${taskName}</strong>${rewardStr}</p>
    <p>Your account has been credited. Keep executing tasks to climb the leaderboard.</p>
  `);
  await sendEmail({ to, subject: `AYZEN — Task Approved: ${taskName}`, html });
}

export async function sendSubscriptionApprovedEmail(to: string, username: string, planName: string): Promise<void> {
  const html = baseTemplate(`
    <h2>Subscription Activated ✓</h2>
    <p>Hi <strong>${username}</strong>, your subscription has been approved by our team!</p>
    <p>🚀 Plan: <strong style="color:#00d4cc;">${planName}</strong> — now active on your account.</p>
    <p>All premium features are unlocked. Start maximizing your airdrop campaigns.</p>
    <div class="divider"></div>
    <a href="https://ayzen.replit.app/subscription" class="btn">View My Plan</a>
  `);
  await sendEmail({ to, subject: `AYZEN — ${planName} Plan Activated ✓`, html });
}

export async function sendSubscriptionRejectedEmail(to: string, username: string, planName: string, reason?: string): Promise<void> {
  const reasonStr = reason ? `<p>📋 Reason: <em>${reason}</em></p>` : "";
  const html = baseTemplate(`
    <h2>Payment Not Verified</h2>
    <p>Hi <strong>${username}</strong>, we could not verify your payment for the <strong>${planName}</strong> plan.</p>
    ${reasonStr}
    <p>Please double-check your transaction ID and contact support if you believe this is an error.</p>
    <div class="divider"></div>
    <a href="https://ayzen.replit.app/subscription" class="btn">Try Again</a>
  `);
  await sendEmail({ to, subject: `AYZEN — Payment Verification Failed`, html });
}

export async function sendTaskSubmittedEmail(to: string, username: string, taskName: string): Promise<void> {
  const html = baseTemplate(`
    <h2>Task Submitted ✓</h2>
    <p>Hi <strong>${username}</strong>, your submission is under review.</p>
    <p>📋 Task: <strong>${taskName}</strong></p>
    <p>Our team will verify your submission shortly. You'll receive another notification when it's approved.</p>
  `);
  await sendEmail({ to, subject: `AYZEN — Task Submitted: ${taskName}`, html });
}

export async function sendTaskRejectedEmail(to: string, username: string, taskName: string, reason?: string): Promise<void> {
  const reasonStr = reason ? `<p>📋 Reason: <em>${reason}</em></p>` : "";
  const html = baseTemplate(`
    <h2>Task Submission Rejected</h2>
    <p>Hi <strong>${username}</strong>, your submission for <strong>${taskName}</strong> was not approved.</p>
    ${reasonStr}
    <p>Please review the task requirements and resubmit with proper proof.</p>
  `);
  await sendEmail({ to, subject: `AYZEN — Task Rejected: ${taskName}`, html });
}

export async function sendVaultHealthDigestEmail(
  to: string,
  username: string,
  lines: string[],
  entryCount: number
): Promise<SendResult> {
  const rows = lines.map((l) => `<p style="margin:0 0 8px;">${l}</p>`).join("");
  const html = baseTemplate(`
    <h2>Vault Risk Digest</h2>
    <p>Hi <strong>${username}</strong>, the daily health scan found ${entryCount} entit${entryCount === 1 ? "y" : "ies"} needing attention. You don't need to be logged in to get this — check it whenever you're ready.</p>
    <div class="divider"></div>
    ${rows}
    <div class="divider"></div>
    <a href="https://ayzen.replit.app/vault" class="btn">Review Vault</a>
  `);
  return sendEmail({ to, subject: `AYZEN — Vault Risk Digest (${entryCount} flagged)`, html });
}

export async function sendTestEmail(to: string): Promise<SendResult> {
  const html = baseTemplate(`
    <h2>Test Transmission</h2>
    <p>This is a test email from your AYZEN platform.</p>
    <p>If you can read this, email delivery is working correctly.</p>
    <div class="divider"></div>
    <p style="font-size:11px;color:#4a8080;">Sent at ${new Date().toUTCString()}</p>
  `);
  return sendEmail({ to, subject: "AYZEN — Test Email ✓", html });
}
