/**
 * auth-utils.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this at: artifacts/api-server/src/lib/auth-utils.ts
 *
 * SECURITY FIXES applied here:
 *  1. getUserIdSync / getUserIdAsync no longer return 1 as a silent fallback.
 *     They now throw AuthError so callers fail loudly instead of running as
 *     the first (admin) account in the database.
 *  2. isAdminSync / isAdminAsync no longer trust the role field from the
 *     unverified base64 payload. Role is only trusted after a DB lookup.
 *  3. getUserIdSync now validates the payload has a numeric userId > 0 before
 *     accepting it, rejecting crafted payloads like { userId: null }.
 *
 * CRITICAL FIX (this pass) — full auth-bypass closed:
 * The "legacy base64-JSON token" format has NO signature at all — it is just
 * `base64(JSON.stringify({ userId, role }))`. Previously getUserFromToken()
 * accepted ANY such token as long as it parsed and contained a positive
 * userId, meaning anyone could forge a token for ANY user (userId 1, 2, 3...
 * are trivial to guess) and be logged in as them — a complete authentication
 * bypass, not just a role-forgery bug. See lib/jwt.ts for the full writeup.
 *
 * Tokens are now real signed JWTs (lib/jwt.ts, HMAC-SHA256 via
 * AYZEN_JWT_SECRET). The unsigned legacy format is only ever accepted if you
 * explicitly opt in with ALLOW_LEGACY_AUTH_TOKENS=true (for a migration grace
 * period), and it is OFF by default — including in this file's fallback path
 * below. Turning it on re-opens the impersonation hole above, so only do it
 * temporarily while rolling out signed tokens, and remove it afterwards.
 */

import jwt from "jsonwebtoken";
import { db, usersTable, apiKeysTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import type { Request } from "express";
import { verifyAuthToken } from "./jwt";
import { logger } from "./logger";
import { hashApiKey, looksLikeApiKey } from "./api-key-crypto";

const ALLOW_LEGACY_AUTH_TOKENS = process.env.ALLOW_LEGACY_AUTH_TOKENS === "true";

// ─── Shared error type ────────────────────────────────────────────────────────

export class AuthError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// ─── Token extraction ─────────────────────────────────────────────────────────

export function getTokenFromReq(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  return authHeader.replace("Bearer ", "").trim() || null;
}

// ─── Base64-JSON payload parser (legacy format, no signature) ─────────────────
// ONLY used for userId — never trust the role field from this path.

function parseBase64Payload(token: string): Record<string, unknown> | null {
  try {
    const raw = Buffer.from(token, "base64").toString("utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {}
  return null;
}

// ─── getUserIdSync ────────────────────────────────────────────────────────────
// Synchronous — only supports our own SIGNED token format (lib/jwt.ts).
// Throws AuthError instead of returning a fallback user ID.
// Use for quick userId extraction inside already-authenticated routes.
//
// FIX: this used to trust the unsigned legacy base64 payload directly, which
// meant any route calling getUserIdSync() without a prior requireAuth
// middleware could be handed an attacker-chosen userId. It now verifies a
// real signature and never falls back to the unsigned format.

export function getUserIdSync(req: Request): number {
  const token = getTokenFromReq(req);
  if (!token) throw new AuthError("No authorization token provided");

  const verified = verifyAuthToken(token);
  if (verified) return verified.userId;

  throw new AuthError("Invalid or unrecognized token format");
}

// ─── isAdminSync ──────────────────────────────────────────────────────────────
// DO NOT USE for access control — base64 role is unverified and forgeable.
// Kept only for non-security-critical UI hints (e.g. feature flags).
// For real access control use the requireAdmin middleware.

/** @deprecated Use requireAdmin middleware instead of isAdminSync() */
export function isAdminSync(req: Request): boolean {
  const token = getTokenFromReq(req);
  if (!token) return false;
  // Intentionally NOT trusting role from base64 payload — always return false.
  // The only safe way to check admin is via DB lookup (isAdminAsync / middleware).
  void token; // suppress unused-var lint
  return false;
}

// ─── getUserFromToken ─────────────────────────────────────────────────────────
// Async — verifies real JWTs and falls back to legacy base64 tokens.
// Returns null if the token is invalid / user not found — never throws.

export async function getUserFromToken(
  token: string
): Promise<{ userId: number; role: string; authType: "session" | "apikey" | "legacy"; keyType?: "full" | "scoped"; scopes?: string[] } | null> {
  // ── 0. AYZEN developer API key (ayzn_live_...) ────────────────────────────
  // Lets users call the AYZEN API from their own bots/scripts with
  // `Authorization: Bearer ayzn_live_...` instead of a login session. Same
  // choke point as every other auth path, so a valid API key works on every
  // route that already accepts a session token — no per-route wiring needed.
  // See lib/api-key-crypto.ts and routes/api-keys.ts.
  if (looksLikeApiKey(token)) {
    const hash = hashApiKey(token);
    const [key] = await db
      .select()
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.keyHash, hash), isNull(apiKeysTable.revokedAt)));
    if (!key) return null; // unknown or revoked key — don't fall through to other auth paths
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;

    const [user] = await db
      .select({ id: usersTable.id, role: usersTable.role, status: usersTable.status })
      .from(usersTable)
      .where(eq(usersTable.id, key.userId));
    if (!user || user.status === "banned" || user.status === "suspended") return null;

    // Fire-and-forget usage tracking — never block/fail the request on this.
    db.update(apiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeysTable.id, key.id))
      .catch(() => {});

    return {
      userId: user.id,
      role: user.role,
      authType: "apikey",
      keyType: key.type as "full" | "scoped",
      scopes: Array.isArray(key.scopes) ? (key.scopes as string[]) : [],
    };
  }

  // ── 1. Try our own signed AYZEN token first (lib/jwt.ts) ─────────────────
  const ownToken = verifyAuthToken(token);
  if (ownToken) {
    // Re-read role from DB so a role change / ban takes effect immediately
    // instead of waiting for the token to expire.
    const [user] = await db
      .select({ id: usersTable.id, role: usersTable.role, status: usersTable.status })
      .from(usersTable)
      .where(eq(usersTable.id, ownToken.userId));
    if (user && user.status !== "banned" && user.status !== "suspended") {
      return { userId: user.id, role: user.role, authType: "session" };
    }
    if (user) return null; // valid signature, but account is banned/suspended
  }

  // ── 2. Try Supabase / externally-issued JWT ───────────────────────────────
  const jwtSecret = process.env.SUPABASE_JWT_SECRET ?? process.env.JWT_SECRET;
  if (jwtSecret) {
    try {
      const payload = jwt.verify(token, jwtSecret) as Record<string, unknown>;
      const email = payload.email as string | undefined;
      if (email) {
        const [existing] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.email, email));
        if (existing) return { userId: existing.id, role: existing.role, authType: "session" };

        // Auto-provision Supabase user
        const meta = (
          payload.user_metadata ?? payload.raw_user_meta_data ?? {}
        ) as Record<string, string>;
        const base = (
          meta.preferred_username ??
          meta.user_name ??
          email.split("@")[0]
        ).replace(/[^a-zA-Z0-9]/g, "_");
        const username = `${base}_${Date.now()}`;
        const [newUser] = await db
          .insert(usersTable)
          .values({
            email,
            username,
            passwordHash: "",
            role: "user",
            status: "active",
            emailVerified: true,
            twoFaEnabled: false,
            avatarUrl:
              meta.avatar_url ?? meta.picture ?? null,
          })
          .returning();
        return { userId: newUser.id, role: "user", authType: "session" };
      }
    } catch {
      // JWT verification failed — fall through to legacy path
    }
  }

  // ── 3. Fallback: legacy UNSIGNED base64-JSON token — off by default ──────
  // This path has no cryptographic proof of identity: it accepts whatever
  // userId a client sends. It exists only to bridge already-issued legacy
  // tokens during a rollout, and must be enabled explicitly. Leave this off
  // once real logins have replaced old sessions (they expire within 7 days).
  if (ALLOW_LEGACY_AUTH_TOKENS) {
    const payload = parseBase64Payload(token);
    if (payload && typeof payload.userId === "number" && payload.userId > 0) {
      logger.warn(
        { userId: payload.userId },
        "[security] accepted unsigned legacy auth token — set ALLOW_LEGACY_AUTH_TOKENS=false once rollout is complete",
      );
      // Role from this path is NOT trusted — always re-read from DB.
      const [user] = await db
        .select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, payload.userId));
      if (user) return { userId: user.id, role: user.role, authType: "legacy" };
    }
  }

  return null;
}

// ─── getUserIdAsync ───────────────────────────────────────────────────────────

export async function getUserIdAsync(req: Request): Promise<number> {
  const token = getTokenFromReq(req);

  // FIX: throw instead of returning 1
  if (!token) throw new AuthError("No authorization token provided");

  const result = await getUserFromToken(token);

  if (!result) throw new AuthError("Token is invalid or expired");
  return result.userId;
}

// ─── isAdminAsync ─────────────────────────────────────────────────────────────

export async function isAdminAsync(req: Request): Promise<boolean> {
  const token = getTokenFromReq(req);
  if (!token) return false;
  const result = await getUserFromToken(token);
  return result?.role === "admin";
}
