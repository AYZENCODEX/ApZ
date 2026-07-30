/**
 * routes/api-keys.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this at: artifacts/api-server/src/routes/api-keys.ts
 *
 * Lets an AYZEN user generate their own developer API key and use it to call
 * the AYZEN API from a bot/script, exactly like their session login would:
 *
 *   Authorization: Bearer ayzn_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * That header works on every existing route that already accepts a session
 * token (see lib/auth-utils.ts getUserFromToken, step 0) — no per-route
 * changes were needed elsewhere. Two key types exist:
 *   - "full"   — same access as the user's own account (default).
 *   - "scoped" — restricted to a chosen set of feature scopes (see
 *     lib/api-scopes.ts for the full list). Enforced globally in
 *     middlewares/api-key-scope.ts, before any route handler runs.
 *
 * SECURITY: creating, renaming, rotating, revoking, and deleting keys all
 * require requireSessionAuth (a real login, not another API key) — so a
 * leaked key can never be used to mint itself replacement keys or lock the
 * real owner out. Listing keys (GET) is allowed via either a session or an
 * existing API key, since it only ever returns masked prefixes, never
 * secrets.
 */
import { Router } from "express";
import { db, apiKeysTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, requireSessionAuth, getRequestUser } from "../middlewares/auth";
import { generateApiKey } from "../lib/api-key-crypto";
import { SCOPE_DEFINITIONS, isValidScope } from "../lib/api-scopes";

const router = Router();

const MAX_KEYS_PER_USER = 20;

function serializeKey(key: typeof apiKeysTable.$inferSelect) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    type: key.type,
    scopes: key.type === "scoped" ? (key.scopes as string[]) : undefined,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revoked: key.revokedAt !== null,
    createdAt: key.createdAt,
  };
}

// ── GET /api-keys/scopes — list available scopes (for building a create-key UI) ─
router.get("/api-keys/scopes", (_req, res): void => {
  res.json({ scopes: SCOPE_DEFINITIONS.map(({ id, label }) => ({ id, label })) });
});

// ── GET /api-keys — list the caller's own keys (masked, never the secret) ────
router.get("/api-keys", requireAuth, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const keys = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.userId, user.userId))
      .orderBy(apiKeysTable.createdAt);
    res.json({ keys: keys.map(serializeKey) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api-keys — create a new key (full-access, or scoped to specific features) ─
// Returns the plaintext secret exactly once. It is never stored — only its
// hash is — so if this response is missed/lost, the only fix is to rotate.
router.post("/api-keys", requireSessionAuth, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 100) : "";
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const type = req.body?.type === "scoped" ? "scoped" : "full";
  let scopes: string[] = [];
  if (type === "scoped") {
    const requested = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
    scopes = [...new Set(requested.filter((s: unknown) => typeof s === "string"))] as string[];
    if (scopes.length === 0) {
      res.status(400).json({ error: "scopes must be a non-empty array for a scoped key. See GET /api-keys/scopes for valid ids." });
      return;
    }
    const invalid = scopes.filter((s) => !isValidScope(s));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Unknown scope(s): ${invalid.join(", ")}. See GET /api-keys/scopes for valid ids.` });
      return;
    }
  }

  try {
    const activeKeys = await db
      .select({ id: apiKeysTable.id })
      .from(apiKeysTable)
      .where(and(eq(apiKeysTable.userId, user.userId), isNull(apiKeysTable.revokedAt)));
    if (activeKeys.length >= MAX_KEYS_PER_USER) {
      res.status(400).json({ error: `Limit of ${MAX_KEYS_PER_USER} active API keys reached. Revoke an unused key first.` });
      return;
    }

    const generated = generateApiKey();
    const [row] = await db
      .insert(apiKeysTable)
      .values({
        userId: user.userId,
        name,
        keyPrefix: generated.displayPrefix,
        keyHash: generated.hash,
        type,
        scopes,
      })
      .returning();

    res.status(201).json({
      ...serializeKey(row),
      key: generated.plaintext, // shown once — client must save it now
      warning: "Save this key now — it will not be shown again.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api-keys/:id/scopes — change which scopes a scoped key grants ──────
router.patch("/api-keys/:id/scopes", requireSessionAuth, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const requested = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
  const scopes = [...new Set(requested.filter((s: unknown) => typeof s === "string"))] as string[];
  if (scopes.length === 0) {
    res.status(400).json({ error: "scopes must be a non-empty array. See GET /api-keys/scopes for valid ids. To grant everything, create a full-access key instead." });
    return;
  }
  const invalid = scopes.filter((s) => !isValidScope(s));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown scope(s): ${invalid.join(", ")}. See GET /api-keys/scopes for valid ids.` });
    return;
  }

  try {
    const [row] = await db
      .update(apiKeysTable)
      .set({ type: "scoped", scopes })
      .where(and(eq(apiKeysTable.id, Number(req.params.id)), eq(apiKeysTable.userId, user.userId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Key not found" }); return; }
    res.json(serializeKey(row));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api-keys/:id — rename a key ─────────────────────────────────────────
router.patch("/api-keys/:id", requireSessionAuth, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 100) : "";
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  try {
    const [row] = await db
      .update(apiKeysTable)
      .set({ name })
      .where(and(eq(apiKeysTable.id, Number(req.params.id)), eq(apiKeysTable.userId, user.userId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Key not found" }); return; }
    res.json(serializeKey(row));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api-keys/:id/rotate — invalidate the old secret, issue a new one ────
router.post("/api-keys/:id/rotate", requireSessionAuth, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const generated = generateApiKey();
    const [row] = await db
      .update(apiKeysTable)
      .set({ keyHash: generated.hash, keyPrefix: generated.displayPrefix, lastUsedAt: null })
      .where(and(
        eq(apiKeysTable.id, Number(req.params.id)),
        eq(apiKeysTable.userId, user.userId),
        isNull(apiKeysTable.revokedAt),
      ))
      .returning();
    if (!row) { res.status(404).json({ error: "Key not found or already revoked" }); return; }

    res.json({
      ...serializeKey(row),
      key: generated.plaintext,
      warning: "The old key stopped working immediately. Save this new key now — it will not be shown again.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api-keys/:id/revoke — disable a key without deleting its record ─────
router.post("/api-keys/:id/revoke", requireSessionAuth, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const [row] = await db
      .update(apiKeysTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeysTable.id, Number(req.params.id)), eq(apiKeysTable.userId, user.userId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Key not found" }); return; }
    res.json(serializeKey(row));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api-keys/:id — remove the record entirely ─────────────────────────
router.delete("/api-keys/:id", requireSessionAuth, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const [row] = await db
      .delete(apiKeysTable)
      .where(and(eq(apiKeysTable.id, Number(req.params.id)), eq(apiKeysTable.userId, user.userId)))
      .returning({ id: apiKeysTable.id });
    if (!row) { res.status(404).json({ error: "Key not found" }); return; }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
