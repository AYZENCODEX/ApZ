/**
 * routes/vault-security.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 5 — Vault Security: PINs & Session.
 *
 * Two independent 4-digit PINs per user, both hashed with bcrypt (lib/password.ts
 * — the same helper used for account passwords) and never stored or returned
 * in plaintext:
 *
 *   vaultPin  — unlocks Vault itself. Gated on the frontend by every /vault/*
 *               route (see components/vault/vault-unlock-gate.tsx). "Keep me
 *               signed in" is a purely client-side session length choice (see
 *               lib/vault-lock.ts) — the server only ever verifies a PIN, it
 *               never issues or tracks a separate vault session token.
 *   entityPin — required to view any entity's details. One shared PIN across
 *               every entity (not per-entity) — see components/vault/entity-pin-gate.tsx.
 *
 * Changing one PIN never reads or writes the other column — see PUT handlers
 * below, each of which only ever touches its own hash column.
 *
 * A NULL hash means that PIN has never been set. GET /vault/security/status
 * reports this so the frontend gates can skip locking on it (letting a new
 * user reach /vault/security to set their first PIN without being locked out
 * of the very page that sets it).
 *
 * Brute-force protection on the two /verify endpoints is a simple in-memory
 * lockout (5 wrong attempts → 60s cooldown per user+kind), on top of the
 * global API rate limiter already applied at the /api level in app.ts. This
 * is intentionally lightweight — good enough for a 4-digit PIN behind a
 * logged-in session, not a replacement for the account password.
 */
import { Router } from "express";
import { db, vaultSecurityTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, getRequestUserId } from "../middlewares/auth";
import { hashPassword, verifyPassword } from "../lib/password";

const router = Router();

const PIN_REGEX = /^\d{4}$/;

type PinKind = "vault" | "entity";

function hashColumn(kind: PinKind) {
  return kind === "vault" ? vaultSecurityTable.vaultPinHash : vaultSecurityTable.entityPinHash;
}

async function getRow(userId: number) {
  const rows = await db.select().from(vaultSecurityTable).where(eq(vaultSecurityTable.userId, userId)).limit(1);
  return rows[0] ?? null;
}

// ─── Brute-force lockout (in-memory, best-effort — see file header) ──────────
const FAILED_ATTEMPT_LIMIT = 5;
const LOCKOUT_MS = 60_000;
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

function attemptKey(userId: number, kind: PinKind): string {
  return `${userId}:${kind}`;
}

function isLockedOut(userId: number, kind: PinKind): number {
  const entry = failedAttempts.get(attemptKey(userId, kind));
  if (!entry) return 0;
  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function recordFailure(userId: number, kind: PinKind): void {
  const key = attemptKey(userId, kind);
  const entry = failedAttempts.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= FAILED_ATTEMPT_LIMIT) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failedAttempts.set(key, entry);
}

function clearFailures(userId: number, kind: PinKind): void {
  failedAttempts.delete(attemptKey(userId, kind));
}

// ─── GET /vault/security/status ────────────────────────────────────────────
router.get("/vault/security/status", requireAuth, async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const row = await getRow(userId);
  res.json({
    vaultPinSet: !!row?.vaultPinHash,
    entityPinSet: !!row?.entityPinHash,
    updatedAt: row?.updatedAt ?? null,
  });
});

// ─── PUT /vault/security/pin — set or change a PIN ─────────────────────────
// Body: { kind: "vault" | "entity", pin: "1234", currentPin?: "0000" }
// currentPin is required only when that PIN is already set (proves the caller
// knows the existing PIN before overwriting it — the account session alone
// isn't treated as sufficient to silently replace a PIN someone else set).
router.put("/vault/security/pin", requireAuth, async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { kind, pin, currentPin } = req.body ?? {};
  if (kind !== "vault" && kind !== "entity") {
    res.status(400).json({ error: "Invalid kind", solution: "kind must be \"vault\" or \"entity\"." });
    return;
  }
  if (typeof pin !== "string" || !PIN_REGEX.test(pin)) {
    res.status(400).json({ error: "Invalid PIN", solution: "PIN must be exactly 4 digits." });
    return;
  }

  const existing = await getRow(userId);
  const existingHash = kind === "vault" ? existing?.vaultPinHash : existing?.entityPinHash;

  if (existingHash) {
    if (typeof currentPin !== "string" || !PIN_REGEX.test(currentPin)) {
      res.status(400).json({ error: "Current PIN required", solution: "Provide currentPin to change an existing PIN." });
      return;
    }
    const matches = await verifyPassword(currentPin, existingHash);
    if (!matches) {
      res.status(403).json({ error: "Incorrect current PIN", code: "WRONG_CURRENT_PIN" });
      return;
    }
  }

  const newHash = await hashPassword(pin);
  const column = kind === "vault" ? "vaultPinHash" : "entityPinHash";

  if (existing) {
    await db.update(vaultSecurityTable)
      .set({ [column]: newHash, updatedAt: new Date() } as any)
      .where(eq(vaultSecurityTable.userId, userId));
  } else {
    await db.insert(vaultSecurityTable).values({
      userId,
      [column]: newHash,
    } as any);
  }

  clearFailures(userId, kind);
  res.json({ ok: true, kind });
});

// ─── POST /vault/security/verify — check a PIN without changing anything ──
// Body: { kind: "vault" | "entity", pin: "1234" }
router.post("/vault/security/verify", requireAuth, async (req, res) => {
  const userId = getRequestUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { kind, pin } = req.body ?? {};
  if (kind !== "vault" && kind !== "entity") {
    res.status(400).json({ error: "Invalid kind", solution: "kind must be \"vault\" or \"entity\"." });
    return;
  }

  const lockedMs = isLockedOut(userId, kind);
  if (lockedMs > 0) {
    res.status(429).json({
      error: "Too many attempts",
      code: "PIN_LOCKED",
      solution: `Wait ${Math.ceil(lockedMs / 1000)}s before trying again.`,
      retryAfterMs: lockedMs,
    });
    return;
  }

  if (typeof pin !== "string" || !PIN_REGEX.test(pin)) {
    res.status(400).json({ error: "Invalid PIN", solution: "PIN must be exactly 4 digits." });
    return;
  }

  const row = await getRow(userId);
  const hash = kind === "vault" ? row?.vaultPinHash : row?.entityPinHash;

  if (!hash) {
    // Nothing set yet — nothing to verify against. Treat as valid so the
    // frontend gate (which already skips locking when unset) never dead-ends.
    res.json({ valid: true, pinSet: false });
    return;
  }

  const matches = await verifyPassword(pin, hash);
  if (!matches) {
    recordFailure(userId, kind);
    res.status(200).json({ valid: false, pinSet: true });
    return;
  }

  clearFailures(userId, kind);
  res.json({ valid: true, pinSet: true });
});

export default router;
