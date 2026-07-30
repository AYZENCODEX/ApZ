import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUserIdAsync } from "../lib/auth-utils";

const router = Router();

const CF_API = "https://api.cloudflare.com/client/v4";
const DOMAIN = "ayzen.tech";

function getCfKey(): string | null {
  return process.env.CLOUDFLARE_API_KEY || process.env.cloudflare_api_key || null;
}

async function cfFetch(path: string, opts: RequestInit = {}) {
  const key = getCfKey();
  if (!key) throw new Error("CLOUDFLARE_API_KEY not configured");
  const res = await fetch(`${CF_API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  return res.json();
}

async function getZoneId(): Promise<string | null> {
  try {
    const data = await cfFetch(`/zones?name=${DOMAIN}&status=active`) as { result?: Array<{ id: string }> };
    return data.result?.[0]?.id ?? null;
  } catch { return null; }
}

// Check if Cloudflare email routing is enabled for the zone
router.get("/ayzen-email/status", async (req, res): Promise<void> => {
  const userId = await getUserIdAsync(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const cfConfigured = !!getCfKey();
  const zoneId = cfConfigured ? await getZoneId() : null;
  res.json({
    ayzenEmail: user.ayzenEmail ?? null,
    domain: DOMAIN,
    cfConfigured,
    zoneFound: !!zoneId,
  });
});

// Check if a username is available
router.get("/ayzen-email/check/:username", async (req, res): Promise<void> => {
  const { username } = req.params;
  const clean = (Array.isArray(username) ? username[0] : username).toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!clean || clean.length < 3 || clean.length > 30) {
    res.json({ available: false, reason: "Username must be 3-30 chars, letters/numbers/dots/dashes only" });
    return;
  }
  const existing = await db.select().from(usersTable).where(eq(usersTable.ayzenEmail, `${clean}@${DOMAIN}`));
  res.json({ available: existing.length === 0, username: clean, email: `${clean}@${DOMAIN}` });
});

// Claim a username@ayzen.tech address
router.post("/ayzen-email/claim", async (req, res): Promise<void> => {
  const userId = await getUserIdAsync(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.ayzenEmail) { res.status(409).json({ error: "You already have an AYZEN email address", ayzenEmail: user.ayzenEmail }); return; }

  const { username, forwardTo } = req.body;
  if (!username || !forwardTo) { res.status(400).json({ error: "username and forwardTo are required" }); return; }

  const clean = username.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!clean || clean.length < 3 || clean.length > 30) {
    res.status(400).json({ error: "Invalid username format" }); return;
  }

  const ayzenEmail = `${clean}@${DOMAIN}`;

  // Check availability
  const existing = await db.select().from(usersTable).where(eq(usersTable.ayzenEmail, ayzenEmail));
  if (existing.length > 0) { res.status(409).json({ error: "Username already taken" }); return; }

  let cfWarning: string | null = null;

  // Try Cloudflare email routing — soft failure so email is always claimed
  if (getCfKey()) {
    try {
      const zoneId = await getZoneId();
      if (zoneId) {
        const cfRes = await cfFetch(`/zones/${zoneId}/email/routing/rules`, {
          method: "POST",
          body: JSON.stringify({
            name: `AYZEN: ${ayzenEmail}`,
            enabled: true,
            matchers: [{ type: "literal", field: "to", value: ayzenEmail }],
            actions: [{ type: "forward", value: [forwardTo] }],
          }),
        }) as { success: boolean; errors?: unknown[] };
        if (!cfRes.success) {
          cfWarning = `Cloudflare routing could not be configured: ${JSON.stringify(cfRes.errors)}`;
        }
      } else {
        cfWarning = "Cloudflare zone not found — address reserved but routing not active yet";
      }
    } catch (err: any) {
      cfWarning = `Cloudflare unavailable: ${err?.message ?? "unknown error"}`;
    }
  } else {
    cfWarning = "Cloudflare not configured — address reserved in system only";
  }

  // Always save to DB regardless of CF outcome
  await db.update(usersTable).set({ ayzenEmail }).where(eq(usersTable.id, userId));
  res.status(201).json({
    ayzenEmail,
    forwardTo,
    message: `${ayzenEmail} has been claimed`,
    ...(cfWarning ? { warning: cfWarning } : {}),
  });
});

// Release/unclaim AYZEN email
router.delete("/ayzen-email", async (req, res): Promise<void> => {
  const userId = await getUserIdAsync(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.ayzenEmail) { res.status(404).json({ error: "No AYZEN email to release" }); return; }
  await db.update(usersTable).set({ ayzenEmail: null }).where(eq(usersTable.id, userId));
  res.json({ message: "AYZEN email released" });
});

export default router;
