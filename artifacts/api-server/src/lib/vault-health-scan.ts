/**
 * lib/vault-health-scan.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vault Health Monitor — proactive daily scan (upgrade over the on-demand
 * checker in routes/vault.ts, which only runs when the owner saves/updates
 * an entry). This runs on a cron schedule regardless of whether anyone logs
 * in, so risk (stale login, missing 2FA, no recovery email, banned/suspended
 * status) surfaces via Telegram + email even for accounts nobody has opened
 * in weeks.
 *
 * Reuses formatRow()/toHealthInput() from routes/vault.ts so the decryption
 * and field-mapping logic has exactly one implementation — this file only
 * adds the "walk every entry, not just the one being saved" part plus the
 * digest delivery.
 */

import { db, vaultEntriesTable, usersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { logBus } from "./log-bus";
import { formatRow, toHealthInput, selectAllVaultEntries } from "../routes/vault";
import { evalBackgroundHealthRules, severityEmoji, type HealthRuleHit } from "./vault-health";
import { createNotification } from "../routes/notifications";
import { sendToUser } from "./telegram";
import { sendVaultHealthDigestEmail } from "./email";

interface FlaggedEntry {
  entryId: number;
  label: string;
  hits: HealthRuleHit[];
}

export interface DailyScanResult {
  entriesScanned: number;
  entriesFlagged: number;
  usersAlerted: number;
}

/** Best-effort per-entry DB update — never throws, mirrors runHealthCheck()'s pattern. */
async function persistFlags(entryId: number, userId: number, currentIds: string[]): Promise<void> {
  const dbUpdates: Record<string, unknown> = { lastHealthFlags: JSON.stringify(currentIds) };
  if (currentIds.length > 0) dbUpdates.lastHealthAlertAt = new Date();
  try {
    await db.update(vaultEntriesTable)
      .set(dbUpdates as Partial<typeof vaultEntriesTable.$inferInsert>)
      .where(and(eq(vaultEntriesTable.id, entryId), eq(vaultEntriesTable.userId, userId)));
  } catch (err) {
    logger.warn({ err, entryId }, "vault-health-scan: failed to persist flags");
  }
}

/**
 * Runs the full sweep: every vault entry, every owner, once. Grouped so each
 * user gets a single digest (Telegram + email + in-app notification) instead
 * of one message per at-risk entity — this runs daily and unattended, so a
 * user with 10 stale entries shouldn't get 10 pings.
 */
export async function runDailyHealthScan(): Promise<DailyScanResult> {
  const rows = await selectAllVaultEntries();
  const flaggedByUser = new Map<number, FlaggedEntry[]>();
  let entriesFlagged = 0;

  for (const raw of rows) {
    let userId: number | null = null;
    try {
      const formatted = formatRow(raw);
      userId = Number((formatted as any).userId);
      const input = toHealthInput(formatted);
      const hits = evalBackgroundHealthRules(input);

      // Persist regardless of hit count so a resolved issue clears from
      // last_health_flags (keeps it consistent with the on-demand path).
      await persistFlags(Number((formatted as any).id), userId, hits.map((h) => h.id));

      if (hits.length === 0) continue;
      entriesFlagged++;

      const label = `${(formatted as any).category} — ${(formatted as any).projectName}`;
      const list = flaggedByUser.get(userId) ?? [];
      list.push({ entryId: Number((formatted as any).id), label, hits });
      flaggedByUser.set(userId, list);
    } catch (err) {
      logger.warn({ err, userId }, "vault-health-scan: entry check failed, skipping");
    }
  }

  let usersAlerted = 0;
  if (flaggedByUser.size > 0) {
    const userIds = Array.from(flaggedByUser.keys());
    const users = await db
      .select({ id: usersTable.id, username: usersTable.username, email: usersTable.email, telegramChatId: usersTable.telegramChatId })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));

    for (const user of users) {
      const entries = flaggedByUser.get(user.id);
      if (!entries || entries.length === 0) continue;
      try {
        await deliverDigest(user, entries);
        usersAlerted++;
      } catch (err) {
        logger.warn({ err, userId: user.id }, "vault-health-scan: digest delivery failed");
      }
    }
  }

  const summary = `Vault health scan: ${rows.length} entities scanned, ${entriesFlagged} flagged, ${usersAlerted} user(s) alerted`;
  logBus.system(summary);
  logger.info({ scanned: rows.length, entriesFlagged, usersAlerted }, "vault-health-scan complete");

  return { entriesScanned: rows.length, entriesFlagged, usersAlerted };
}

async function deliverDigest(
  user: { id: number; username: string; email: string; telegramChatId: string | null },
  entries: FlaggedEntry[]
): Promise<void> {
  const lines = entries.map((e) => {
    const worst = e.hits.find((h) => h.severity === "alert") ?? e.hits[0];
    const rest = e.hits.filter((h) => h !== worst).map((h) => `${severityEmoji(h.severity)} ${h.message}`).join(" · ");
    return `${severityEmoji(worst.severity)} *${e.label}*\n${worst.message}${rest ? ` · ${rest}` : ""}`;
  });
  const plainLines = entries.map((e) => `<strong>${e.label}</strong> — ${e.hits.map((h) => h.message).join("; ")}`);

  // In-app notification (bell icon) — non-blocking, best-effort like the rest.
  createNotification(
    user.id,
    "vault_health_digest",
    `Vault Health Digest — ${entries.length} entit${entries.length === 1 ? "y" : "ies"} flagged`,
    entries.map((e) => `${e.label}: ${e.hits.map((h) => h.message).join("; ")}`).join("\n"),
    { entryIds: entries.map((e) => e.entryId) },
  ).catch(() => {});

  // Telegram — only if the user has linked their account.
  if (user.telegramChatId) {
    const text = `🩺 *Daily Vault Health Digest*\n\n${entries.length} entit${entries.length === 1 ? "y" : "ies"} need attention:\n\n${lines.join("\n\n")}`;
    sendToUser(user.telegramChatId, text).catch(() => {});
  }

  // Email — always, since this is precisely for users who haven't logged in.
  if (user.email) {
    sendVaultHealthDigestEmail(user.email, user.username, plainLines, entries.length).catch(() => {});
  }
}
