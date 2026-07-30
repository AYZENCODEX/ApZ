/**
 * lib/wallet-crypto.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared AES-256-GCM encrypt/decrypt for wallet recovery phrases / private
 * keys at rest. Extracted from routes/wallets.ts so other routes (e.g.
 * routes/polymarket.ts) that need to unlock a user's wallet don't duplicate
 * the PHRASE_ENCRYPTION_KEY validation and cipher logic.
 *
 * SECURITY: this key encrypts every user's wallet recovery phrase. There is
 * no fallback — set PHRASE_ENCRYPTION_KEY in your environment (>= 32 chars)
 * before this module is imported, or the server refuses to start.
 */
import crypto from "crypto";

const PHRASE_ENCRYPTION_KEY_RAW = process.env["PHRASE_ENCRYPTION_KEY"];
if (!PHRASE_ENCRYPTION_KEY_RAW || PHRASE_ENCRYPTION_KEY_RAW.length < 32) {
  throw new Error(
    "PHRASE_ENCRYPTION_KEY is missing or shorter than 32 characters. Set it as a strong random " +
    "secret (e.g. `openssl rand -hex 32`) in your environment before starting the API server — " +
    "this key protects every user's wallet recovery phrase."
  );
}
const PHRASE_KEY = PHRASE_ENCRYPTION_KEY_RAW.slice(0, 32).padEnd(32, "0");

// AES-256-GCM (authenticated encryption). Stored format: iv:ciphertext:authTag (hex).
export function encryptPhrase(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(PHRASE_KEY), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + enc.toString("hex") + ":" + authTag.toString("hex");
}

export function decryptPhrase(encrypted: string): string {
  const [ivHex, encHex, tagHex] = encrypted.split(":");
  if (!ivHex || !encHex || !tagHex) throw new Error("Malformed encrypted phrase (expected iv:ciphertext:authTag)");
  const iv = Buffer.from(ivHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(PHRASE_KEY), iv);
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
