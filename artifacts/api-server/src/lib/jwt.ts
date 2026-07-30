/**
 * lib/jwt.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITICAL SECURITY FIX
 *
 * BEFORE this file existed, `generateToken()` in routes/auth.ts built session
 * tokens like this:
 *
 *     Buffer.from(JSON.stringify({ userId, role, exp })).toString("base64")
 *
 * That is NOT a real token — it's base64, not a signature. Anyone could run:
 *
 *     Buffer.from(JSON.stringify({ userId: 1, role: "admin", exp: 9999999999999 })).toString("base64")
 *
 * ...and use the result as `Authorization: Bearer <that>` to become user #1
 * (almost always the first admin account created) with zero credentials.
 * `getUserFromToken()` re-checked the *role* against the DB, which blocked
 * pure privilege-escalation, but it still fully trusted the *userId*, so
 * this was a complete authentication bypass — anyone could impersonate any
 * account just by knowing (or guessing — IDs are sequential integers) its ID.
 *
 * THE FIX
 * All new tokens are real HMAC-SHA256-signed JWTs (via `jsonwebtoken`, which
 * was already a dependency). Forging one now requires knowing AYZEN_JWT_SECRET.
 *
 * MIGRATION
 * Deploying this invalidates all previously-issued unsigned tokens — every
 * logged-in user/device will need to log in again. That's expected and
 * necessary: those old tokens were never real proof of identity to begin
 * with. See auth-utils.ts for the (opt-in, off-by-default) legacy-token
 * grace period if you need a softer rollout.
 */

import jwt, { type SignOptions } from "jsonwebtoken";
import { randomBytes } from "crypto";
import { logger } from "./logger";

const isProd = process.env.NODE_ENV === "production";

function resolveSecret(): string {
  const configured = process.env.AYZEN_JWT_SECRET || process.env.JWT_SECRET;
  if (configured && configured.length >= 16) return configured;

  if (isProd) {
    // Fail fast and loud rather than silently signing tokens with a weak or
    // predictable secret in production.
    throw new Error(
      "AYZEN_JWT_SECRET is not set (or is too short). Set it to a long random " +
        "value before starting the server in production. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
    );
  }

  // Dev/test convenience only: ephemeral secret, regenerated every process
  // start (so tokens don't survive a restart) and never used in production.
  logger.warn(
    "[security] AYZEN_JWT_SECRET is not set — using a random ephemeral secret " +
      "for this dev process only. Set AYZEN_JWT_SECRET in your environment " +
      "before deploying.",
  );
  return randomBytes(48).toString("hex");
}

let cachedSecret: string | null = null;
function getSecret(): string {
  if (!cachedSecret) cachedSecret = resolveSecret();
  return cachedSecret;
}

export interface AuthTokenPayload {
  userId: number;
  role: string;
}

const DEFAULT_EXPIRY = "7d";

/** Issue a signed, tamper-proof session token. */
export function signAuthToken(userId: number, role: string, options?: SignOptions): string {
  return jwt.sign({ userId, role } satisfies AuthTokenPayload, getSecret(), {
    expiresIn: DEFAULT_EXPIRY,
    ...options,
  });
}

/** Verify a signed session token. Returns null on any failure — never throws. */
export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret()) as Record<string, unknown>;
    const userId = decoded.userId;
    const role = decoded.role;
    if (typeof userId === "number" && userId > 0 && typeof role === "string") {
      return { userId, role };
    }
    return null;
  } catch {
    return null;
  }
}
