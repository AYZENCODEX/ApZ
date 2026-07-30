import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import crypto from "crypto";
let QRCode: any = null;
try { QRCode = (await import("qrcode" as any)).default; } catch { /* qrcode not installed */ }

const router = Router();

// ─── Minimal RFC 6238 TOTP implementation (base32 secret, HMAC-SHA1, 30s step) ─
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function totpGenerate(secret: string, step = 30): string {
  const counter = Math.floor(Date.now() / 1000 / step);
  return hotp(secret, counter);
}

function totpVerify(token: string, secret: string, step = 30, window = 1): boolean {
  const counter = Math.floor(Date.now() / 1000 / step);
  const clean = token.replace(/\s/g, "");
  for (let errWindow = -window; errWindow <= window; errWindow++) {
    if (hotp(secret, counter + errWindow) === clean) return true;
  }
  return false;
}

function totpUri(secret: string, email: string, issuer = "AYZEN"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function generateCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// ─── GET /security/backup-codes ───────────────────────────────────────────────
router.get("/security/backup-codes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const r = await pool.query(
      "SELECT id, code, is_used, used_at, created_at FROM user_backup_codes WHERE user_id=$1 ORDER BY created_at DESC",
      [userId]
    );
    res.json(r.rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── POST /security/backup-codes/generate ─────────────────────────────────────
router.post("/security/backup-codes/generate", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Delete all existing unused backup codes for this user
    await client.query("DELETE FROM user_backup_codes WHERE user_id=$1 AND is_used=FALSE", [userId]);

    // Generate 10 new codes
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push(`${generateCode(4)}-${generateCode(4)}`);
    }

    for (const code of codes) {
      await client.query(
        "INSERT INTO user_backup_codes (user_id, code, is_used) VALUES ($1, $2, FALSE)",
        [userId, code]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, count: 10, message: "10 backup codes generated. Save them securely." });
  } catch (e: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ─── POST /security/backup-codes/use — use a backup code for login ───────────
router.post("/security/backup-codes/use", async (req, res): Promise<void> => {
  const { email, code } = req.body;
  if (!email || !code) { res.status(400).json({ error: "email and code required" }); return; }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Find user
    const userR = await client.query("SELECT id FROM users WHERE email=$1", [email]);
    if (userR.rows.length === 0) { res.status(401).json({ error: "Invalid code or email" }); return; }
    const userId = userR.rows[0].id;

    // Find unused backup code
    const codeR = await client.query(
      "SELECT id FROM user_backup_codes WHERE user_id=$1 AND code=$2 AND is_used=FALSE FOR UPDATE",
      [userId, code.toUpperCase().trim()]
    );
    if (codeR.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(401).json({ error: "Invalid or already used backup code" });
      return;
    }

    // Mark code as used
    await client.query(
      "UPDATE user_backup_codes SET is_used=TRUE, used_at=NOW() WHERE id=$1",
      [codeR.rows[0].id]
    );

    // Get user for token
    const uR = await client.query("SELECT id, email, username, role FROM users WHERE id=$1", [userId]);
    await client.query("COMMIT");

    const u = uR.rows[0];
    const payload = { userId: u.id, email: u.email, username: u.username, role: u.role };
    const token = Buffer.from(JSON.stringify(payload)).toString("base64");

    res.json({ token, user: payload });
  } catch (e: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ─── GET /security/magic-codes ─────────────────────────────────────────────────
router.get("/security/magic-codes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const r = await pool.query(
      "SELECT id, code, label, is_used, used_at, expires_at, created_at FROM user_magic_codes WHERE user_id=$1 ORDER BY created_at DESC",
      [userId]
    );
    res.json(r.rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── POST /security/magic-codes — create a magic code ─────────────────────────
router.post("/security/magic-codes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { label, expires_in_days } = req.body;

  // Max 10 active magic codes per user
  const countR = await pool.query(
    "SELECT COUNT(*) FROM user_magic_codes WHERE user_id=$1 AND is_used=FALSE",
    [userId]
  );
  if (Number(countR.rows[0].count) >= 10) {
    res.status(400).json({ error: "Maximum 10 active magic codes. Delete some first." }); return;
  }

  const code = `MAGIC-${generateCode(4)}-${generateCode(4)}-${generateCode(4)}`;
  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
    : null;

  try {
    const r = await pool.query(
      "INSERT INTO user_magic_codes (user_id, code, label, is_used, expires_at) VALUES ($1,$2,$3,FALSE,$4) RETURNING *",
      [userId, code, label || "Magic Code", expiresAt]
    );
    res.status(201).json(r.rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── DELETE /security/magic-codes/:id ─────────────────────────────────────────
router.delete("/security/magic-codes/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);
  try {
    await pool.query("DELETE FROM user_magic_codes WHERE id=$1 AND user_id=$2", [id, userId]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── POST /security/magic-codes/login — login with magic code ─────────────────
router.post("/security/magic-codes/login", async (req, res): Promise<void> => {
  const { code } = req.body;
  if (!code) { res.status(400).json({ error: "code required" }); return; }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const codeR = await client.query(
      `SELECT mc.*, u.id as uid, u.email, u.username, u.role
       FROM user_magic_codes mc
       JOIN users u ON u.id = mc.user_id
       WHERE mc.code=$1 AND mc.is_used=FALSE
         AND (mc.expires_at IS NULL OR mc.expires_at > NOW())
       FOR UPDATE`,
      [code.trim()]
    );

    if (codeR.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(401).json({ error: "Invalid, expired, or already used magic code" });
      return;
    }

    const row = codeR.rows[0];
    await client.query(
      "UPDATE user_magic_codes SET is_used=TRUE, used_at=NOW() WHERE id=$1",
      [row.id]
    );
    await client.query("COMMIT");

    const payload = { userId: row.uid, email: row.email, username: row.username, role: row.role };
    const token = Buffer.from(JSON.stringify(payload)).toString("base64");
    res.json({ token, user: payload });
  } catch (e: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ─── GET /security/2fa/status — check whether account-level TOTP is enabled ──
router.get("/security/2fa/status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const r = await pool.query("SELECT two_fa_enabled FROM users WHERE id=$1", [userId]);
    res.json({ enabled: !!r.rows[0]?.two_fa_enabled });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── POST /security/2fa/setup — generate a new secret + QR code (not yet enabled) ─
router.post("/security/2fa/setup", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const userR = await pool.query("SELECT email, username FROM users WHERE id=$1", [userId]);
    const user = userR.rows[0];
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const secret = generateBase32Secret();
    await pool.query("UPDATE users SET two_fa_secret=$1, two_fa_enabled=FALSE WHERE id=$2", [secret, userId]);

    const otpauth = totpUri(secret, user.email);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    res.json({ secret, qrDataUrl, otpauth });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── POST /security/2fa/verify — confirm a 6-digit code to enable 2FA ────────
router.post("/security/2fa/verify", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ error: "token is required" }); return; }
  try {
    const r = await pool.query("SELECT two_fa_secret FROM users WHERE id=$1", [userId]);
    const secret = r.rows[0]?.two_fa_secret;
    if (!secret) { res.status(400).json({ error: "Run 2FA setup first" }); return; }
    const valid = totpVerify(token, secret);
    if (!valid) { res.status(400).json({ error: "Invalid or expired code" }); return; }
    await pool.query("UPDATE users SET two_fa_enabled=TRUE WHERE id=$1", [userId]);
    res.json({ enabled: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── POST /security/2fa/disable ───────────────────────────────────────────────
router.post("/security/2fa/disable", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    await pool.query("UPDATE users SET two_fa_enabled=FALSE, two_fa_secret=NULL WHERE id=$1", [userId]);
    res.json({ enabled: false });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── GET /security/recovery-email ─────────────────────────────────────────────
router.get("/security/recovery-email", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const r = await pool.query("SELECT recovery_email FROM users WHERE id=$1", [userId]);
    res.json({ recoveryEmail: r.rows[0]?.recovery_email ?? null });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── POST /security/recovery-email ────────────────────────────────────────────
router.post("/security/recovery-email", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { email } = req.body as { email?: string };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Invalid email address" }); return;
  }
  try {
    const r = await pool.query("SELECT email FROM users WHERE id=$1", [userId]);
    if (email && r.rows[0]?.email === email) {
      res.status(400).json({ error: "Recovery email must differ from your primary email" }); return;
    }
    await pool.query("UPDATE users SET recovery_email=$1 WHERE id=$2", [email?.trim() || null, userId]);
    res.json({ recoveryEmail: email?.trim() || null });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
