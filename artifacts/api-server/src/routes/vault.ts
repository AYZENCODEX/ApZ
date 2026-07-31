import { Router } from "express";
import { db, vaultEntriesTable, usersTable, vaultActivityLogTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import * as crypto from "crypto";
import { broadcastEvent } from "./events";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { syncOnVaultUpdate, syncOnVaultStatusChange, syncOnVaultDelete } from "../services/sync";
import { encryptField, decryptField, decryptRows } from "../lib/vault-crypto";
import { computeAutoScore, evalHealthRules, severityEmoji, type VaultHealthInput } from "../lib/vault-health";
import { createNotification } from "./notifications";
import { sendToUser } from "../lib/telegram";
// Phase 15B — team Activity Log sub-view sources everything from the shared
// Phase 4 activity_log table (subject_type="team"), including vault-usage
// events, instead of a second logging system. logVaultActivity below mirrors
// into it whenever the entry belongs to a team.
import { logSubjectActivity } from "../lib/activity-log";

const router = Router();

// Credential/2FA columns encrypted at rest (see lib/vault-crypto.ts). backupCodes
// and otherAccounts are JSON-serialized text columns — encrypted as one blob.
const SENSITIVE_VAULT_FIELDS = new Set([
  "accountPassword", "emailPassword", "email2fa", "emailBackupCode", "emailRecoveryPassword",
  "recovery2fa", "recoveryBackupCode",
  "account2fa", "accountBackupCode",
  "twitterPassword", "twitterEmailPassword", "twitter2fa", "twitterEmailRecoveryPassword",
  "twitterAccountBackupCode", "twitterEmail2fa", "twitterEmailBackupCode",
  "twitterRecovery2fa", "twitterRecoveryBackupCode",
  "discordPassword", "discordEmailPassword", "discord2fa", "discordEmailRecoveryPassword",
  "discordAccountBackupCode", "discordEmail2fa", "discordEmailBackupCode",
  "discordRecovery2fa", "discordRecoveryBackupCode",
  "telegramPassword", "telegramLinkedEmailPassword", "telegram2fa",
  "telegramAccountBackupCode", "telegramEmail2fa", "telegramEmailBackupCode",
  "telegramRecovery2fa", "telegramRecoveryBackupCode",
  "backupCodes", "otherAccounts",
]);

// Best-effort audit log — never blocks or fails the calling request.
async function logVaultActivity(vaultEntryId: number, userId: number, action: string, detail?: string): Promise<void> {
  try {
    await db.insert(vaultActivityLogTable).values({ vaultEntryId, userId, action, detail: detail ?? null });
  } catch (err) {
    console.error("vault activity log failed:", err);
  }
  // Phase 15B — if this entry belongs to a team, mirror the same event into
  // the shared activity_log (subject_type="team") so the team's Other →
  // Activity Log sub-view sees vault-usage entries without reading a second
  // logging system. Best-effort and non-blocking, same as the write above.
  try {
    const teamRow = await db.execute(sql.raw(`SELECT team_id FROM vault_entries WHERE id = ${vaultEntryId}`));
    const teamId = (teamRow.rows[0] as any)?.team_id;
    if (teamId) {
      await logSubjectActivity("team", Number(teamId), "vault_used", {
        actorUserId: userId,
        meta: { vaultEntryId, vaultAction: action, detail: detail ?? null },
      });
    }
  } catch {
    // best-effort — never block the caller
  }
}

// ─── Health Monitor runner ────────────────────────────────────────────────────
// Best-effort, fire-and-forget (same pattern as logVaultActivity/syncOnVaultUpdate
// below) — never blocks or fails the calling request.
export function toHealthInput(formatted: ReturnType<typeof formatRow>): VaultHealthInput {
  return {
    score: Number((formatted as any).score ?? 5),
    lastLoginAt: (formatted as any).lastLoginAt ?? null,
    hasTwitter2fa: (formatted as any).twitterUsername ? !!(formatted as any).twitter2fa : undefined,
    hasDiscord2fa: (formatted as any).discordUsername ? !!(formatted as any).discord2fa : undefined,
    hasTelegram2fa: (formatted as any).telegramUsername ? !!(formatted as any).telegram2fa : undefined,
    hasEmail2fa: (formatted as any).email ? !!(formatted as any).email2fa : undefined,
    hasAccountPassword: !!(formatted as any).accountPassword,
    email: (formatted as any).email ?? null,
    status: (formatted as any).status ?? "active",
    hasRecoveryEmail: !!(formatted as any).emailRecovery,
  };
}

async function runHealthCheck(id: number, userId: number, recalcScore: boolean): Promise<void> {
  const raw = await selectVaultOne(id, userId);
  if (!raw) return;
  const formatted = formatRow(raw);
  const input = toHealthInput(formatted);

  const dbUpdates: Record<string, unknown> = {};

  if (recalcScore) {
    const auto = computeAutoScore(input);
    if (auto !== input.score) {
      dbUpdates.score = auto;
      input.score = auto;
    }
  }

  const hits = evalHealthRules(input);
  const prevFlags: string[] = Array.isArray((formatted as any).lastHealthFlags) ? (formatted as any).lastHealthFlags : [];
  const currentIds = hits.map(h => h.id);
  const newHits = hits.filter(h => !prevFlags.includes(h.id));

  if (currentIds.join(",") !== prevFlags.join(",")) {
    dbUpdates.lastHealthFlags = JSON.stringify(currentIds);
  }
  if (newHits.length > 0) {
    dbUpdates.lastHealthAlertAt = new Date();
  }

  if (Object.keys(dbUpdates).length > 0) {
    try {
      await db.update(vaultEntriesTable).set(dbUpdates as Partial<typeof vaultEntriesTable.$inferInsert>)
        .where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)));
    } catch (err) {
      console.error("vault health-check update failed:", err);
    }
  }

  if (newHits.length === 0) return;

  const label = `${formatted.category} — ${formatted.projectName}`;
  const worst = newHits.find(h => h.severity === "alert") ?? newHits[0];
  const summary = newHits.map(h => `${severityEmoji(h.severity)} ${h.message}`).join("\n");

  createNotification(
    userId,
    "vault_health",
    `Vault Health: ${worst.severity === "alert" ? "Alert" : worst.severity === "warn" ? "Warning" : "Flag"} — ${label}`,
    summary,
    { vaultEntryId: id, ruleIds: currentIds },
  ).catch(() => {});

  db.select({ telegramChatId: usersTable.telegramChatId }).from(usersTable)
    .where(eq(usersTable.id, userId)).limit(1)
    .then(rows => {
      const chatId = rows[0]?.telegramChatId;
      if (!chatId) return;
      return sendToUser(chatId, `${severityEmoji(worst.severity)} *Vault Health*\n\n${label}\n\n${summary}`);
    })
    .catch(() => {});
}

function generateSerial(userId: number): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `AYZN${userId}-${ts}${rand}`;
}

// ─── Seed-phrase encryption (AES-256-GCM, server-side key) ───────────────────
const SEED_KEY = process.env.SESSION_SECRET ?? "ayzen_default_seed_key_32bytes!!";
const KEY_BUF = crypto.scryptSync(SEED_KEY, "ayzen_seed_salt", 32);

function encryptSeedPhrase(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY_BUF, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function decryptSeedPhrase(stored: string): string | null {
  try {
    const [ivHex, tagHex, encHex] = stored.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const enc = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY_BUF, iv);
    decipher.setAuthTag(tag);
    return decipher.update(enc).toString("utf8") + decipher.final("utf8");
  } catch { return null; }
}

// ─── SAFE_COLS — raw SQL fallback ────────────────────────────────────────────
const SAFE_COLS = `id, user_id, entity_serial, category, project_name,
  email, email_password,
  twitter_username, twitter_password,
  discord_username, discord_password,
  telegram_username, telegram_password,
  wallet_addresses, backup_codes, notes,
  created_at, updated_at,
  null::text as email_recovery, null::text as email_recovery_password,
  null::text as twitter_email, null::text as twitter_email_password,
  null::text as twitter_followers, null::text as twitter_2fa,
  null::text as twitter_email_recovery, null::text as twitter_email_recovery_password,
   null::text as twitter_age, null::text as twitter_worth,
  null::text as discord_email, null::text as discord_email_password,
  null::text as discord_2fa, null::text as discord_email_recovery,
  null::text as discord_email_recovery_password,
  null::text as discord_followers, null::text as discord_age, null::text as discord_worth,
  null::text as telegram_phone, null::text as telegram_2fa,
  null::text as telegram_linked_email, null::text as telegram_linked_email_password,
  null::text as telegram_age, null::text as telegram_worth,
   null::text as twitter_buy_value, null::text as discord_buy_value, null::text as telegram_buy_value,
   0::real as current_value, 0::real as current_buy_value,
  null::text as encrypted_seed_phrase, null::text as status, null::timestamp as last_activity_at,
  null::text as username, null::text as account_password, null::text as email_2fa, null::text as email_backup_code,
  null::text as recovery_2fa, null::text as recovery_backup_code,
  null::timestamp as last_login_at, null::timestamp as buy_date, null::timestamp as create_date,
  0::integer as followers,
  null::text as drive_wallet_label, null::text as drive_wallet_address, null::text as drive_wallet_note, null::timestamp as drive_wallet_set_at,
  null::text as telegram_followers,
  null::timestamp as twitter_last_login_at, null::timestamp as twitter_buy_date, null::timestamp as twitter_create_date, null::text as twitter_notes,
  null::timestamp as discord_last_login_at, null::timestamp as discord_buy_date, null::timestamp as discord_create_date, null::text as discord_notes,
  null::timestamp as telegram_last_login_at, null::timestamp as telegram_buy_date, null::timestamp as telegram_create_date, null::text as telegram_notes,
  null::text as account_2fa, null::text as account_backup_code,
  null::text as twitter_account_backup_code, null::text as twitter_email_2fa, null::text as twitter_email_backup_code,
  null::text as twitter_recovery_2fa, null::text as twitter_recovery_backup_code,
  null::text as discord_account_backup_code, null::text as discord_email_2fa, null::text as discord_email_backup_code,
  null::text as discord_recovery_2fa, null::text as discord_recovery_backup_code,
  null::text as telegram_account_backup_code, null::text as telegram_email_2fa, null::text as telegram_email_backup_code,
  null::text as telegram_recovery_2fa, null::text as telegram_recovery_backup_code`;

async function selectVault(userId: number): Promise<Record<string, unknown>[]> {
  try {
    return (await db.select().from(vaultEntriesTable).where(eq(vaultEntriesTable.userId, userId))) as unknown as Record<string, unknown>[];
  } catch {
    const res = await db.execute(sql.raw(`SELECT ${SAFE_COLS} FROM vault_entries WHERE user_id = ${userId}`));
    return res.rows as Record<string, unknown>[];
  }
}

async function selectVaultOne(id: number, userId: number): Promise<Record<string, unknown> | null> {
  try {
    const rows = await db.select().from(vaultEntriesTable).where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)));
    return (rows[0] as unknown as Record<string, unknown>) ?? null;
  } catch {
    const res = await db.execute(sql.raw(`SELECT ${SAFE_COLS} FROM vault_entries WHERE id = ${id} AND user_id = ${userId}`));
    return (res.rows[0] as Record<string, unknown>) ?? null;
  }
}

// Cross-user bulk read for lib/vault-health-scan.ts's daily background scan —
// the per-user helpers above (selectVault/selectVaultOne) are scoped to a
// single userId because every request-driven route is. The scan has no
// request/user context, so it needs every entry across every owner.
export async function selectAllVaultEntries(): Promise<Record<string, unknown>[]> {
  try {
    return (await db.select().from(vaultEntriesTable)) as unknown as Record<string, unknown>[];
  } catch {
    const res = await db.execute(sql.raw(`SELECT ${SAFE_COLS} FROM vault_entries`));
    return res.rows as Record<string, unknown>[];
  }
}

export function formatRow(e: Record<string, unknown>, revealSeed = false) {
  const walStr = e.wallet_addresses ?? e.walletAddresses;
  const bkStrRaw = e.backup_codes ?? e.backupCodes;
  const bkStr = bkStrRaw ? decryptField(bkStrRaw as string) : bkStrRaw;
  const otherAccountsRaw = e.other_accounts ?? e.otherAccounts;
  const encSeed = e.encrypted_seed_phrase ?? e.encryptedSeedPhrase ?? null;
  return {
    id: e.id,
    userId: e.user_id ?? e.userId,
    entitySerial: e.entity_serial ?? e.entitySerial,
    category: e.category,
    projectName: e.project_name ?? e.projectName,
    username: e.username ?? null,
    accountPassword: decryptField((e.account_password ?? e.accountPassword ?? null) as string | null),
    email: e.email,
    emailPassword: decryptField((e.email_password ?? e.emailPassword) as string | null),
    email2fa: decryptField((e.email_2fa ?? e.email2fa ?? null) as string | null),
    emailBackupCode: decryptField((e.email_backup_code ?? e.emailBackupCode ?? null) as string | null),
    emailRecovery: e.email_recovery ?? e.emailRecovery ?? null,
    emailRecoveryPassword: decryptField((e.email_recovery_password ?? e.emailRecoveryPassword ?? null) as string | null),
    recovery2fa: decryptField((e.recovery_2fa ?? e.recovery2fa ?? null) as string | null),
    recoveryBackupCode: decryptField((e.recovery_backup_code ?? e.recoveryBackupCode ?? null) as string | null),
    lastLoginAt: e.last_login_at ?? e.lastLoginAt ?? null,
    buyDate: e.buy_date ?? e.buyDate ?? null,
    createDate: e.create_date ?? e.createDate ?? null,
    followers: Number(e.followers ?? 0),
    driveWalletLabel: e.drive_wallet_label ?? e.driveWalletLabel ?? null,
    driveWalletAddress: e.drive_wallet_address ?? e.driveWalletAddress ?? null,
    driveWalletNote: e.drive_wallet_note ?? e.driveWalletNote ?? null,
    driveWalletSetAt: e.drive_wallet_set_at ?? e.driveWalletSetAt ?? null,
    twitterUsername: e.twitter_username ?? e.twitterUsername,
    twitterPassword: decryptField((e.twitter_password ?? e.twitterPassword) as string | null),
    twitterEmail: e.twitter_email ?? e.twitterEmail ?? null,
    twitterEmailPassword: decryptField((e.twitter_email_password ?? e.twitterEmailPassword ?? null) as string | null),
    twitterFollowers: e.twitter_followers ?? e.twitterFollowers ?? null,
    twitter2fa: decryptField((e.twitter_2fa ?? e.twitter2fa ?? null) as string | null),
    twitterEmailRecovery: e.twitter_email_recovery ?? e.twitterEmailRecovery ?? null,
    twitterEmailRecoveryPassword: decryptField((e.twitter_email_recovery_password ?? e.twitterEmailRecoveryPassword ?? null) as string | null),
    twitterAge: e.twitter_age ?? e.twitterAge ?? null,
    twitterWorth: e.twitter_worth ?? e.twitterWorth ?? null,
    twitterBuyValue: e.twitter_buy_value ?? e.twitterBuyValue ?? null,
    twitterLastLoginAt: e.twitter_last_login_at ?? e.twitterLastLoginAt ?? null,
    twitterBuyDate: e.twitter_buy_date ?? e.twitterBuyDate ?? null,
    twitterCreateDate: e.twitter_create_date ?? e.twitterCreateDate ?? null,
    twitterNotes: e.twitter_notes ?? e.twitterNotes ?? null,
    discordUsername: e.discord_username ?? e.discordUsername,
    discordPassword: decryptField((e.discord_password ?? e.discordPassword) as string | null),
    discordEmail: e.discord_email ?? e.discordEmail ?? null,
    discordEmailPassword: decryptField((e.discord_email_password ?? e.discordEmailPassword ?? null) as string | null),
    discord2fa: decryptField((e.discord_2fa ?? e.discord2fa ?? null) as string | null),
    discordEmailRecovery: e.discord_email_recovery ?? e.discordEmailRecovery ?? null,
    discordEmailRecoveryPassword: decryptField((e.discord_email_recovery_password ?? e.discordEmailRecoveryPassword ?? null) as string | null),
    discordFollowers: e.discord_followers ?? e.discordFollowers ?? null,
    discordAge: e.discord_age ?? e.discordAge ?? null,
    discordWorth: e.discord_worth ?? e.discordWorth ?? null,
    discordBuyValue: e.discord_buy_value ?? e.discordBuyValue ?? null,
    discordLastLoginAt: e.discord_last_login_at ?? e.discordLastLoginAt ?? null,
    discordBuyDate: e.discord_buy_date ?? e.discordBuyDate ?? null,
    discordCreateDate: e.discord_create_date ?? e.discordCreateDate ?? null,
    discordNotes: e.discord_notes ?? e.discordNotes ?? null,
    telegramUsername: e.telegram_username ?? e.telegramUsername,
    telegramPassword: decryptField((e.telegram_password ?? e.telegramPassword) as string | null),
    telegramPhone: e.telegram_phone ?? e.telegramPhone ?? null,
    telegram2fa: decryptField((e.telegram_2fa ?? e.telegram2fa ?? null) as string | null),
    telegramLinkedEmail: e.telegram_linked_email ?? e.telegramLinkedEmail ?? null,
    telegramLinkedEmailPassword: decryptField((e.telegram_linked_email_password ?? e.telegramLinkedEmailPassword ?? null) as string | null),
    telegramAge: e.telegram_age ?? e.telegramAge ?? null,
    telegramWorth: e.telegram_worth ?? e.telegramWorth ?? null,
    telegramBuyValue: e.telegram_buy_value ?? e.telegramBuyValue ?? null,
    telegramFollowers: e.telegram_followers ?? e.telegramFollowers ?? null,
    telegramLastLoginAt: e.telegram_last_login_at ?? e.telegramLastLoginAt ?? null,
    telegramBuyDate: e.telegram_buy_date ?? e.telegramBuyDate ?? null,
    telegramCreateDate: e.telegram_create_date ?? e.telegramCreateDate ?? null,
    telegramNotes: e.telegram_notes ?? e.telegramNotes ?? null,
    // New per-platform credential fields
    account2fa: decryptField((e.account_2fa ?? (e as any).account2fa ?? null) as string | null),
    accountBackupCode: decryptField((e.account_backup_code ?? (e as any).accountBackupCode ?? null) as string | null),
    twitterAccountBackupCode: decryptField((e.twitter_account_backup_code ?? (e as any).twitterAccountBackupCode ?? null) as string | null),
    twitterEmail2fa: decryptField((e.twitter_email_2fa ?? (e as any).twitterEmail2fa ?? null) as string | null),
    twitterEmailBackupCode: decryptField((e.twitter_email_backup_code ?? (e as any).twitterEmailBackupCode ?? null) as string | null),
    twitterRecovery2fa: decryptField((e.twitter_recovery_2fa ?? (e as any).twitterRecovery2fa ?? null) as string | null),
    twitterRecoveryBackupCode: decryptField((e.twitter_recovery_backup_code ?? (e as any).twitterRecoveryBackupCode ?? null) as string | null),
    discordAccountBackupCode: decryptField((e.discord_account_backup_code ?? (e as any).discordAccountBackupCode ?? null) as string | null),
    discordEmail2fa: decryptField((e.discord_email_2fa ?? (e as any).discordEmail2fa ?? null) as string | null),
    discordEmailBackupCode: decryptField((e.discord_email_backup_code ?? (e as any).discordEmailBackupCode ?? null) as string | null),
    discordRecovery2fa: decryptField((e.discord_recovery_2fa ?? (e as any).discordRecovery2fa ?? null) as string | null),
    discordRecoveryBackupCode: decryptField((e.discord_recovery_backup_code ?? (e as any).discordRecoveryBackupCode ?? null) as string | null),
    telegramAccountBackupCode: decryptField((e.telegram_account_backup_code ?? (e as any).telegramAccountBackupCode ?? null) as string | null),
    telegramEmail2fa: decryptField((e.telegram_email_2fa ?? (e as any).telegramEmail2fa ?? null) as string | null),
    telegramEmailBackupCode: decryptField((e.telegram_email_backup_code ?? (e as any).telegramEmailBackupCode ?? null) as string | null),
    telegramRecovery2fa: decryptField((e.telegram_recovery_2fa ?? (e as any).telegramRecovery2fa ?? null) as string | null),
    telegramRecoveryBackupCode: decryptField((e.telegram_recovery_backup_code ?? (e as any).telegramRecoveryBackupCode ?? null) as string | null),
    walletAddresses: walStr ? (() => { try { return JSON.parse(walStr as string); } catch { return []; } })() : [],
    backupCodes: bkStr ? (() => { try { return JSON.parse(bkStr as string); } catch { return []; } })() : [],
    tags: (() => {
      const t = e.tags ?? (e as any).tags;
      if (!t) return [];
      try { return JSON.parse(t as string); } catch { return []; }
    })(),
    notes: e.notes,
    otherAccounts: otherAccountsRaw ? decryptField(otherAccountsRaw as string) : null,
    currentValue: Number(e.current_value ?? e.currentValue ?? 0),
    currentBuyValue: Number(e.current_buy_value ?? e.currentBuyValue ?? 0),
    status: e.status ?? "active",
    twitterBanned: !!(e.twitter_banned ?? e.twitterBanned ?? false),
    discordBanned: !!(e.discord_banned ?? e.discordBanned ?? false),
    telegramBanned: !!(e.telegram_banned ?? e.telegramBanned ?? false),
    lastActivityAt: e.last_activity_at ?? e.lastActivityAt ?? null,
    lastHealthAlertAt: e.last_health_alert_at ?? (e as any).lastHealthAlertAt ?? null,
    lastHealthFlags: (() => {
      const f = e.last_health_flags ?? (e as any).lastHealthFlags;
      if (!f) return [];
      try { return JSON.parse(f as string); } catch { return []; }
    })(),
    // Seed phrase: only returned if explicitly revealed; always masked in lists
    hasSeedPhrase: !!encSeed,
    seedPhrase: revealSeed && encSeed ? decryptSeedPhrase(encSeed as string) : undefined,
    createdAt: e.created_at ? new Date(e.created_at as string).toISOString() : e.createdAt,
    updatedAt: e.updated_at ? new Date(e.updated_at as string).toISOString() : e.updatedAt,
  };
}

const NEW_VAULT_FIELDS: (keyof typeof vaultEntriesTable.$inferInsert)[] = [
  "username", "accountPassword", "email2fa", "emailBackupCode",
  "recovery2fa", "recoveryBackupCode",
  "lastLoginAt", "buyDate", "createDate",
  "emailRecovery", "emailRecoveryPassword",
  "twitterEmail", "twitterEmailPassword", "twitterFollowers", "twitter2fa",
  "twitterEmailRecovery", "twitterEmailRecoveryPassword", "twitterAge", "twitterWorth", "twitterBuyValue",
  "twitterLastLoginAt", "twitterBuyDate", "twitterCreateDate", "twitterNotes",
  "discordEmail", "discordEmailPassword", "discord2fa",
  "discordEmailRecovery", "discordEmailRecoveryPassword", "discordFollowers", "discordAge", "discordWorth", "discordBuyValue",
  "discordLastLoginAt", "discordBuyDate", "discordCreateDate", "discordNotes",
  "telegramPhone", "telegram2fa", "telegramLinkedEmail", "telegramLinkedEmailPassword", "telegramAge", "telegramWorth", "telegramBuyValue",
  "telegramFollowers", "telegramLastLoginAt", "telegramBuyDate", "telegramCreateDate", "telegramNotes",
  "twitterBanned", "discordBanned", "telegramBanned",
  "account2fa", "accountBackupCode",
  "twitterAccountBackupCode", "twitterEmail2fa", "twitterEmailBackupCode", "twitterRecovery2fa", "twitterRecoveryBackupCode",
  "discordAccountBackupCode", "discordEmail2fa", "discordEmailBackupCode", "discordRecovery2fa", "discordRecoveryBackupCode",
  "telegramAccountBackupCode", "telegramEmail2fa", "telegramEmailBackupCode", "telegramRecovery2fa", "telegramRecoveryBackupCode",
];

// ─── GET /vault — list user's vault entries ──────────────────────────────────
router.get("/vault", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const entries = await selectVault(userId);
  res.json(entries.map(e => formatRow(e)));
});

// ─── POST /vault — create vault entry ────────────────────────────────────────
router.post("/vault", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const {
    category, projectName,
    username, accountPassword,
    email, emailPassword, email2fa, emailBackupCode,
    recovery2fa, recoveryBackupCode,
    lastLoginAt, buyDate, createDate,
    twitterUsername, twitterPassword,
    discordUsername, discordPassword,
    telegramUsername, telegramPassword,
    walletAddresses, backupCodes, notes, otherAccounts, tags,
    seedPhrase, // plaintext — will be encrypted before storage
    emailRecovery, emailRecoveryPassword,
    twitterEmail, twitterEmailPassword, twitterFollowers, twitter2fa,
    twitterEmailRecovery, twitterEmailRecoveryPassword, twitterAge, twitterWorth, twitterBuyValue,
    twitterLastLoginAt, twitterBuyDate, twitterCreateDate, twitterNotes,
    discordEmail, discordEmailPassword, discord2fa,
    discordEmailRecovery, discordEmailRecoveryPassword, discordFollowers, discordAge, discordWorth, discordBuyValue,
    discordLastLoginAt, discordBuyDate, discordCreateDate, discordNotes,
    telegramPhone, telegram2fa, telegramLinkedEmail, telegramLinkedEmailPassword, telegramAge, telegramWorth, telegramBuyValue,
    telegramFollowers, telegramLastLoginAt, telegramBuyDate, telegramCreateDate, telegramNotes,
    account2fa, accountBackupCode,
    twitterAccountBackupCode, twitterEmail2fa, twitterEmailBackupCode, twitterRecovery2fa, twitterRecoveryBackupCode,
    discordAccountBackupCode, discordEmail2fa, discordEmailBackupCode, discordRecovery2fa, discordRecoveryBackupCode,
    telegramAccountBackupCode, telegramEmail2fa, telegramEmailBackupCode, telegramRecovery2fa, telegramRecoveryBackupCode,
    score,
  } = req.body;

  if (!category || !projectName) {
    res.status(400).json({ error: "category and projectName are required" });
    return;
  }

  const serial = generateSerial(userId);
  const encryptedSeedPhrase = seedPhrase ? encryptSeedPhrase(seedPhrase) : null;

  const baseValues: Record<string, unknown> = {
    userId, entitySerial: serial, category, projectName,
    email: email || null, emailPassword: encryptField(emailPassword || null),
    twitterUsername: twitterUsername || null, twitterPassword: encryptField(twitterPassword || null),
    discordUsername: discordUsername || null, discordPassword: encryptField(discordPassword || null),
    telegramUsername: telegramUsername || null, telegramPassword: encryptField(telegramPassword || null),
    walletAddresses: walletAddresses ? JSON.stringify(walletAddresses) : null,
    backupCodes: encryptField(backupCodes ? JSON.stringify(backupCodes) : null),
    tags: Array.isArray(tags) ? JSON.stringify(tags) : null,
    notes: notes || null,
    otherAccounts: encryptField(otherAccounts || null),
    score: Math.max(0, Math.min(10, Number.isFinite(Number(score)) ? Number(score) : 5)),
  };

  let entry: Record<string, unknown>;
  try {
    const [row] = await db.insert(vaultEntriesTable).values({
      ...baseValues,
      encryptedSeedPhrase,
      username: username || null,
      accountPassword: encryptField(accountPassword || null),
      email2fa: encryptField(email2fa || null),
      emailBackupCode: encryptField(emailBackupCode || null),
      recovery2fa: encryptField(recovery2fa || null),
      recoveryBackupCode: encryptField(recoveryBackupCode || null),
      lastLoginAt: lastLoginAt ? new Date(lastLoginAt) : null,
      buyDate: buyDate ? new Date(buyDate) : null,
      createDate: createDate ? new Date(createDate) : null,
      emailRecovery: emailRecovery || null,
      emailRecoveryPassword: encryptField(emailRecoveryPassword || null),
      twitterEmail: twitterEmail || null,
      twitterEmailPassword: encryptField(twitterEmailPassword || null),
      twitterFollowers: twitterFollowers || null,
      twitter2fa: encryptField(twitter2fa || null),
      twitterEmailRecovery: twitterEmailRecovery || null,
      twitterEmailRecoveryPassword: encryptField(twitterEmailRecoveryPassword || null),
      twitterAge: twitterAge || null,
      twitterWorth: twitterWorth || null,
      twitterBuyValue: twitterBuyValue || null,
      twitterLastLoginAt: twitterLastLoginAt ? new Date(twitterLastLoginAt) : null,
      twitterBuyDate: twitterBuyDate ? new Date(twitterBuyDate) : null,
      twitterCreateDate: twitterCreateDate ? new Date(twitterCreateDate) : null,
      twitterNotes: twitterNotes || null,
      discordEmail: discordEmail || null,
      discordEmailPassword: encryptField(discordEmailPassword || null),
      discord2fa: encryptField(discord2fa || null),
      discordEmailRecovery: discordEmailRecovery || null,
      discordEmailRecoveryPassword: encryptField(discordEmailRecoveryPassword || null),
      discordFollowers: discordFollowers || null,
      discordAge: discordAge || null,
      discordWorth: discordWorth || null,
      discordBuyValue: discordBuyValue || null,
      discordLastLoginAt: discordLastLoginAt ? new Date(discordLastLoginAt) : null,
      discordBuyDate: discordBuyDate ? new Date(discordBuyDate) : null,
      discordCreateDate: discordCreateDate ? new Date(discordCreateDate) : null,
      discordNotes: discordNotes || null,
      telegramPhone: telegramPhone || null,
      telegram2fa: encryptField(telegram2fa || null),
      telegramLinkedEmail: telegramLinkedEmail || null,
      telegramLinkedEmailPassword: encryptField(telegramLinkedEmailPassword || null),
      telegramAge: telegramAge || null,
      telegramWorth: telegramWorth || null,
      telegramBuyValue: telegramBuyValue || null,
      telegramFollowers: telegramFollowers || null,
      telegramLastLoginAt: telegramLastLoginAt ? new Date(telegramLastLoginAt) : null,
      telegramBuyDate: telegramBuyDate ? new Date(telegramBuyDate) : null,
      telegramCreateDate: telegramCreateDate ? new Date(telegramCreateDate) : null,
      telegramNotes: telegramNotes || null,
      account2fa: encryptField(account2fa || null),
      accountBackupCode: encryptField(accountBackupCode || null),
      twitterAccountBackupCode: encryptField(twitterAccountBackupCode || null),
      twitterEmail2fa: encryptField(twitterEmail2fa || null),
      twitterEmailBackupCode: encryptField(twitterEmailBackupCode || null),
      twitterRecovery2fa: encryptField(twitterRecovery2fa || null),
      twitterRecoveryBackupCode: encryptField(twitterRecoveryBackupCode || null),
      discordAccountBackupCode: encryptField(discordAccountBackupCode || null),
      discordEmail2fa: encryptField(discordEmail2fa || null),
      discordEmailBackupCode: encryptField(discordEmailBackupCode || null),
      discordRecovery2fa: encryptField(discordRecovery2fa || null),
      discordRecoveryBackupCode: encryptField(discordRecoveryBackupCode || null),
      telegramAccountBackupCode: encryptField(telegramAccountBackupCode || null),
      telegramEmail2fa: encryptField(telegramEmail2fa || null),
      telegramEmailBackupCode: encryptField(telegramEmailBackupCode || null),
      telegramRecovery2fa: encryptField(telegramRecovery2fa || null),
      telegramRecoveryBackupCode: encryptField(telegramRecoveryBackupCode || null),
    } as typeof vaultEntriesTable.$inferInsert).returning();
    entry = row as unknown as Record<string, unknown>;
  } catch {
    // New columns not in Drizzle schema yet — insert without them
    const [row] = await db.insert(vaultEntriesTable).values(baseValues as typeof vaultEntriesTable.$inferInsert).returning();
    entry = row as unknown as Record<string, unknown>;
  }

  broadcastEvent("vault_updated", { action: "created", entryId: entry.id });
  logVaultActivity(Number(entry.id), userId, "created", `${category} — ${projectName}`);
  res.status(201).json(formatRow(entry));
});

// ─── GET /vault/tags — distinct tags used by this user, for filter UI ────────
router.get("/vault/tags", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const entries = await selectVault(userId);
    const set = new Set<string>();
    for (const e of entries) {
      const raw = (e as any).tags ?? (e as any).tags;
      if (!raw) continue;
      try {
        const arr = JSON.parse(raw as string);
        if (Array.isArray(arr)) for (const t of arr) if (typeof t === "string" && t.trim()) set.add(t.trim());
      } catch { /* skip malformed */ }
    }
    res.json({ tags: Array.from(set).sort((a, b) => a.localeCompare(b)) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch tags", detail: err?.message });
  }
});

// ─── PATCH /vault/bulk-tag — add or remove a tag across multiple entries ─────
router.patch("/vault/bulk-tag", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { ids, tag, action } = req.body as { ids?: number[]; tag?: string; action?: "add" | "remove" };

  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids (non-empty array) is required" }); return; }
  if (!tag || !String(tag).trim()) { res.status(400).json({ error: "tag is required" }); return; }
  const op = action === "remove" ? "remove" : "add";
  const cleanTag = String(tag).trim();

  const results: { id: number; ok: boolean }[] = [];
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!Number.isFinite(id)) { results.push({ id: rawId as number, ok: false }); continue; }
    try {
      const raw = await selectVaultOne(id, userId);
      if (!raw) { results.push({ id, ok: false }); continue; }
      const formatted = formatRow(raw);
      const current: string[] = Array.isArray((formatted as any).tags) ? (formatted as any).tags : [];
      const next = op === "add"
        ? Array.from(new Set([...current, cleanTag]))
        : current.filter(t => t !== cleanTag);
      await db.update(vaultEntriesTable)
        .set({ tags: JSON.stringify(next), updatedAt: new Date() } as Partial<typeof vaultEntriesTable.$inferInsert>)
        .where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)));
      results.push({ id, ok: true });
    } catch {
      results.push({ id, ok: false });
    }
  }

  broadcastEvent("vault_updated", { action: "bulk_tagged", entryIds: ids });
  res.json({ tag: cleanTag, action: op, results });
});

// ─── PATCH /vault/bulk-action — generic multi-select action (tag/status/delete) ─
// Single entry point for the vault.tsx selection action-bar. `action: "tag"`
// mirrors /vault/bulk-tag above (kept separately for backward compat — nothing
// else calls it, so this just avoids duplicating that logic inline). Every
// path is per-id + best-effort, same pattern as bulk-tag: one bad/missing id
// doesn't abort the rest of the batch, and the response reports per-id results
// so the client can tell the user "8 of 10 succeeded" instead of a flat pass/fail.
const BULK_ALLOWED_STATUSES = new Set(["active", "warning", "banned", "suspended"]);

router.patch("/vault/bulk-action", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const { ids, action } = req.body as { ids?: number[]; action?: "tag" | "status" | "delete" };

  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids (non-empty array) is required" }); return; }
  if (ids.length > 200) { res.status(400).json({ error: "Max 200 ids per bulk action" }); return; }
  const cleanIds = ids.map(Number).filter(Number.isFinite);
  if (cleanIds.length === 0) { res.status(400).json({ error: "No valid ids" }); return; }

  if (action === "tag") {
    const { tag, tagAction } = req.body as { tag?: string; tagAction?: "add" | "remove" };
    if (!tag || !String(tag).trim()) { res.status(400).json({ error: "tag is required" }); return; }
    const op = tagAction === "remove" ? "remove" : "add";
    const cleanTag = String(tag).trim();

    const results: { id: number; ok: boolean }[] = [];
    for (const id of cleanIds) {
      try {
        const raw = await selectVaultOne(id, userId);
        if (!raw) { results.push({ id, ok: false }); continue; }
        const formatted = formatRow(raw);
        const current: string[] = Array.isArray((formatted as any).tags) ? (formatted as any).tags : [];
        const next = op === "add" ? Array.from(new Set([...current, cleanTag])) : current.filter(t => t !== cleanTag);
        await db.update(vaultEntriesTable)
          .set({ tags: JSON.stringify(next), updatedAt: new Date() } as Partial<typeof vaultEntriesTable.$inferInsert>)
          .where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)));
        results.push({ id, ok: true });
      } catch {
        results.push({ id, ok: false });
      }
    }
    broadcastEvent("vault_updated", { action: "bulk_tagged", entryIds: cleanIds });
    res.json({ action: "tag", results });
    return;
  }

  if (action === "status") {
    const { status } = req.body as { status?: string };
    if (!status || !BULK_ALLOWED_STATUSES.has(status)) {
      res.status(400).json({ error: `status must be one of: ${Array.from(BULK_ALLOWED_STATUSES).join(", ")}` });
      return;
    }
    const results: { id: number; ok: boolean }[] = [];
    for (const id of cleanIds) {
      try {
        const [row] = await db.update(vaultEntriesTable)
          .set({ status, lastActivityAt: new Date(), updatedAt: new Date() } as Partial<typeof vaultEntriesTable.$inferInsert>)
          .where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)))
          .returning();
        if (!row) { results.push({ id, ok: false }); continue; }
        logVaultActivity(id, userId, "status_changed", `→ ${status}`);
        syncOnVaultStatusChange(id, status).catch(() => {});
        results.push({ id, ok: true });
      } catch {
        results.push({ id, ok: false });
      }
    }
    broadcastEvent("vault_updated", { action: "bulk_status", entryIds: cleanIds, status });
    res.json({ action: "status", status, results });
    return;
  }

  if (action === "delete") {
    const results: { id: number; ok: boolean }[] = [];
    for (const id of cleanIds) {
      try {
        const [row] = await db.delete(vaultEntriesTable)
          .where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)))
          .returning();
        if (!row) { results.push({ id, ok: false }); continue; }
        logVaultActivity(id, userId, "deleted");
        syncOnVaultDelete(id).catch(() => {});
        results.push({ id, ok: true });
      } catch {
        results.push({ id, ok: false });
      }
    }
    broadcastEvent("vault_updated", { action: "bulk_deleted", entryIds: cleanIds });
    res.json({ action: "delete", results });
    return;
  }

  res.status(400).json({ error: "action must be one of: tag, status, delete" });
});

// ─── GET /vault/health-report — dashboard panel: counts by health issue ─────
router.get("/vault/health-report", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const entries = await selectVault(userId);
    const formatted = entries.map(e => formatRow(e));

    let lowScore = 0, missing2fa = 0, inactive30d = 0, bannedOrSuspended = 0;
    const flagged: Record<string, unknown>[] = [];

    for (const f of formatted) {
      const input = toHealthInput(f);
      const hits = evalHealthRules(input);
      if (hits.length > 0) {
        flagged.push({
          id: (f as any).id,
          entitySerial: (f as any).entitySerial,
          category: (f as any).category,
          projectName: (f as any).projectName,
          score: input.score,
          hits,
        });
      }
      if (hits.some(h => h.id === "low_score")) lowScore++;
      if (hits.some(h => h.id === "missing_2fa")) missing2fa++;
      if (hits.some(h => h.id === "inactive_30d")) inactive30d++;
      if (hits.some(h => h.id.startsWith("status_"))) bannedOrSuspended++;
    }

    res.json({
      totalEntries: formatted.length,
      counts: { lowScore, missing2fa, inactive30d, bannedOrSuspended },
      flaggedEntries: flagged,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate health report", detail: err?.message });
  }
});

// ─── POST /vault/health-check — run the rules engine across all of the ──────
// user's entries now (in addition to the automatic check on every PATCH),
// auto-recalculating scores and firing notifications for newly-flagged issues.
router.post("/vault/health-check", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const entries = await selectVault(userId);
    await Promise.all(entries.map(e => runHealthCheck(Number((e as any).id), userId, true).catch(() => {})));
    res.json({ checked: entries.length });
  } catch (err: any) {
    res.status(500).json({ error: "Health check failed", detail: err?.message });
  }
});

// ─── GET /vault/analytics — portfolio overview, per-platform breakdown, ─────
// value trend, and best/worst performers by ROI.
router.get("/vault/analytics", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const entries = (await selectVault(userId)).map(e => formatRow(e));

    const totalValue = entries.reduce((s, e: any) => s + (Number(e.currentValue) || 0), 0);
    const totalBuyValue = entries.reduce((s, e: any) => s + (Number(e.currentBuyValue) || 0), 0);
    const avgScore = entries.length ? entries.reduce((s, e: any) => s + (Number(e.score) || 0), 0) / entries.length : 0;

    const byCategory: Record<string, { count: number; totalValue: number; totalBuyValue: number; avgScore: number }> = {};
    for (const e of entries as any[]) {
      const cat = e.category || "Uncategorized";
      if (!byCategory[cat]) byCategory[cat] = { count: 0, totalValue: 0, totalBuyValue: 0, avgScore: 0 };
      byCategory[cat].count++;
      byCategory[cat].totalValue += Number(e.currentValue) || 0;
      byCategory[cat].totalBuyValue += Number(e.currentBuyValue) || 0;
      byCategory[cat].avgScore += Number(e.score) || 0;
    }
    for (const cat of Object.keys(byCategory)) {
      byCategory[cat].avgScore = byCategory[cat].count ? byCategory[cat].avgScore / byCategory[cat].count : 0;
    }

    const platformWorth = (field: "twitterWorth" | "discordWorth" | "telegramWorth", buyField: "twitterBuyValue" | "discordBuyValue" | "telegramBuyValue") => {
      let worth = 0, buy = 0, count = 0;
      for (const e of entries as any[]) {
        const w = Number(e[field]);
        const b = Number(e[buyField]);
        if (Number.isFinite(w) && w !== 0) { worth += w; count++; }
        if (Number.isFinite(b)) buy += b;
      }
      return { totalWorth: worth, totalBuyValue: buy, count };
    };
    const perPlatform = {
      twitter: platformWorth("twitterWorth", "twitterBuyValue"),
      discord: platformWorth("discordWorth", "discordBuyValue"),
      telegram: platformWorth("telegramWorth", "telegramBuyValue"),
    };

    const with2fa = entries.filter((e: any) => e.twitter2fa || e.discord2fa || e.telegram2fa || e.email2fa).length;
    const twofaCoveragePct = entries.length ? Math.round((with2fa / entries.length) * 100) : 0;

    const withRoi = (entries as any[])
      .filter(e => Number(e.currentBuyValue) > 0)
      .map(e => ({
        id: e.id,
        entitySerial: e.entitySerial,
        projectName: e.projectName,
        category: e.category,
        currentValue: Number(e.currentValue) || 0,
        currentBuyValue: Number(e.currentBuyValue) || 0,
        roiPct: ((Number(e.currentValue) - Number(e.currentBuyValue)) / Number(e.currentBuyValue)) * 100,
      }))
      .sort((a, b) => b.roiPct - a.roiPct);

    res.json({
      overview: {
        totalEntries: entries.length,
        totalVaultWorth: totalValue,
        totalBuyValue,
        netPnl: totalValue - totalBuyValue,
        avgScore: Math.round(avgScore * 10) / 10,
        twofaCoveragePct,
      },
      byCategory,
      perPlatform,
      bestPerforming: withRoi.slice(0, 5),
      worstPerforming: withRoi.slice(-5).reverse(),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch analytics", detail: err?.message });
  }
});

// ─── GET /vault/analytics/value-history — value_history rows for charting ───
router.get("/vault/analytics/value-history", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const { valueHistoryTable } = await import("@workspace/db");
    const rows = await db.select().from(valueHistoryTable)
      .where(and(eq(valueHistoryTable.userId, userId), eq(valueHistoryTable.sourceType, "vault")))
      .orderBy(valueHistoryTable.createdAt);
    res.json(rows.map((r: any) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch value history", detail: err?.message });
  }
});

// ─── GET /vault/:id — get single entry ───────────────────────────────────────
router.get("/vault/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.user!.userId;
  const entry = await selectVaultOne(id, userId);
  if (!entry) { res.status(404).json({ error: "Vault entry not found" }); return; }
  res.json(formatRow(entry));
});

// ─── GET /vault/:id/seed — reveal decrypted seed phrase (explicit opt-in) ───
router.get("/vault/:id/seed", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.user!.userId;
  const entry = await selectVaultOne(id, userId);
  if (!entry) { res.status(404).json({ error: "Vault entry not found" }); return; }
  const encSeed = entry.encrypted_seed_phrase ?? entry.encryptedSeedPhrase ?? null;
  if (!encSeed) { res.status(404).json({ error: "No seed phrase stored for this entity" }); return; }
  const plaintext = decryptSeedPhrase(encSeed as string);
  if (!plaintext) { res.status(500).json({ error: "Failed to decrypt seed phrase" }); return; }
  logVaultActivity(id, userId, "seed_revealed");
  res.json({ seedPhrase: plaintext });
});

// ─── PATCH /vault/:id/drive-wallet — set the fixed Drive wallet record ───────
// Wallet → Drive is a one-time, unedited fixed record (per spec): once set,
// it can never be changed or cleared through this endpoint.
router.patch("/vault/:id/drive-wallet", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.user!.userId;
  const { label, address, note } = req.body;
  if (!address || !String(address).trim()) { res.status(400).json({ error: "Wallet address is required" }); return; }

  const entry = await selectVaultOne(id, userId);
  if (!entry) { res.status(404).json({ error: "Vault entry not found" }); return; }
  const alreadySet = entry.drive_wallet_set_at ?? (entry as any).driveWalletSetAt ?? entry.drive_wallet_address ?? (entry as any).driveWalletAddress;
  if (alreadySet) { res.status(409).json({ error: "Drive wallet is already set and cannot be edited" }); return; }

  try {
    const [row] = await db.update(vaultEntriesTable)
      .set({
        driveWalletLabel: label || null,
        driveWalletAddress: String(address).trim(),
        driveWalletNote: note || null,
        driveWalletSetAt: new Date(),
        updatedAt: new Date(),
      } as Partial<typeof vaultEntriesTable.$inferInsert>)
      .where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Vault entry not found" }); return; }
    logVaultActivity(id, userId, "drive_wallet_set");
    res.json(formatRow(row as unknown as Record<string, unknown>));
  } catch (err: any) {
    res.status(500).json({ error: "Unable to save drive wallet", detail: err?.message });
  }
});

// ─── PATCH /vault/:id — update vault entry ───────────────────────────────────
router.patch("/vault/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.user!.userId;

  const baseFields = [
    "category", "projectName", "email", "emailPassword",
    "twitterUsername", "twitterPassword",
    "discordUsername", "discordPassword",
    "telegramUsername", "telegramPassword",
    "notes",
  "currentValue", "currentBuyValue",
  ];
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const f of baseFields) {
    if (req.body[f] !== undefined) updates[f] = SENSITIVE_VAULT_FIELDS.has(f) ? encryptField(req.body[f]) : req.body[f];
  }
  const DATE_FIELDS = new Set([
    "lastLoginAt", "buyDate", "createDate",
    "twitterLastLoginAt", "twitterBuyDate", "twitterCreateDate",
    "discordLastLoginAt", "discordBuyDate", "discordCreateDate",
    "telegramLastLoginAt", "telegramBuyDate", "telegramCreateDate",
  ]);
  for (const f of NEW_VAULT_FIELDS) {
    if (req.body[f] === undefined) continue;
    if (DATE_FIELDS.has(f)) { updates[f] = req.body[f] ? new Date(req.body[f]) : null; continue; }
    updates[f] = SENSITIVE_VAULT_FIELDS.has(f) ? encryptField(req.body[f]) : req.body[f];
  }
  if (req.body.followers !== undefined) {
    const n = Number(req.body.followers);
    if (Number.isFinite(n)) updates.followers = Math.max(0, Math.round(n));
  }
  if (req.body.walletAddresses !== undefined) updates.walletAddresses = JSON.stringify(req.body.walletAddresses);
  if (req.body.backupCodes !== undefined) updates.backupCodes = encryptField(JSON.stringify(req.body.backupCodes));
  if (req.body.tags !== undefined) updates.tags = JSON.stringify(Array.isArray(req.body.tags) ? req.body.tags : []);
  if (req.body.otherAccounts !== undefined) updates.otherAccounts = encryptField(req.body.otherAccounts);
  if (req.body.seedPhrase !== undefined) {
    updates.encryptedSeedPhrase = req.body.seedPhrase ? encryptSeedPhrase(req.body.seedPhrase) : null;
  }
  if (req.body.status !== undefined) {
    const allowed = ["active", "warning", "banned", "suspended"];
    if (allowed.includes(req.body.status)) {
      updates.status = req.body.status;
      updates.lastActivityAt = new Date();
    }
  }
  if (req.body.score !== undefined) {
    const n = Number(req.body.score);
    if (Number.isFinite(n)) updates.score = Math.max(0, Math.min(10, Math.round(n)));
  }
  if (req.body.currentValue !== undefined) {
    const n = Number(req.body.currentValue);
    if (Number.isFinite(n)) updates.currentValue = n;
  }
  if (req.body.currentBuyValue !== undefined) {
    const n = Number(req.body.currentBuyValue);
    if (Number.isFinite(n)) updates.currentBuyValue = n;
  }

  let entry: Record<string, unknown>;
  try {
    const [row] = await db.update(vaultEntriesTable)
      .set(updates as Partial<typeof vaultEntriesTable.$inferInsert>)
      .where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Vault entry not found" }); return; }
    entry = row as unknown as Record<string, unknown>;
  } catch {
    // Strip new fields and retry with base fields only
    for (const f of NEW_VAULT_FIELDS) delete updates[f];
    delete updates.encryptedSeedPhrase;
    delete updates.status;
    delete updates.lastActivityAt;
    delete updates.followers;
    delete updates.tags;
    delete updates.lastHealthAlertAt;
    delete updates.lastHealthFlags;
    const [row] = await db.update(vaultEntriesTable)
      .set(updates as Partial<typeof vaultEntriesTable.$inferInsert>)
      .where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Vault entry not found" }); return; }
    entry = row as unknown as Record<string, unknown>;
  }

  broadcastEvent("vault_updated", { action: "updated", entryId: id });
  // Health Monitor: auto-recalculate score (unless the client sent one explicitly)
  // and check health rules, firing a notification only for newly-triggered issues.
  runHealthCheck(id, userId, req.body.score === undefined).catch(() => {});
  if (req.body.status !== undefined) {
    logVaultActivity(id, userId, "status_changed", `→ ${req.body.status}`);
    // Sync: propagate status change to marketplace (auto-delist if banned/suspended)
    syncOnVaultStatusChange(id, req.body.status).catch(() => {});
  } else {
    logVaultActivity(id, userId, "updated");
    // Sync: refresh stale marketplace listing previews for this entry
    syncOnVaultUpdate(id).catch(() => {});
  }
  res.json(formatRow(entry));
});

// ─── DELETE /vault/:id — delete vault entry ──────────────────────────────────
router.delete("/vault/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.user!.userId;
  await db.delete(vaultEntriesTable).where(and(eq(vaultEntriesTable.id, id), eq(vaultEntriesTable.userId, userId)));
  broadcastEvent("vault_updated", { action: "deleted", entryId: id });
  logVaultActivity(id, userId, "deleted");
  // Sync: delist any marketplace listing for this entry, prune orphaned ROI rows
  syncOnVaultDelete(id).catch(() => {});
  res.json({ message: "Vault entry deleted" });
});

// ─── GET /admin/vault — admin view of all entries ────────────────────────────
router.get("/admin/vault", requireAdmin, async (req, res): Promise<void> => {
  try {
    const entries = await db
      .select({ entry: vaultEntriesTable, username: usersTable.username, userEmail: usersTable.email })
      .from(vaultEntriesTable)
      .leftJoin(usersTable, eq(vaultEntriesTable.userId, usersTable.id));
    res.json(entries.map(({ entry, username, userEmail }) => ({
      ...formatRow(entry as unknown as Record<string, unknown>),
      username,
      userEmail,
    })));
  } catch {
    const rows = await selectVault(0);
    res.json(rows.map(e => formatRow(e)));
  }
});

// ─── GET /admin/vault/full — full unencrypted vault for admin ─────────────────
router.get("/admin/vault/full", requireAdmin, async (req, res): Promise<void> => {
  try {
    const entries = await db
      .select({ entry: vaultEntriesTable, username: usersTable.username, userEmail: usersTable.email })
      .from(vaultEntriesTable)
      .leftJoin(usersTable, eq(vaultEntriesTable.userId, usersTable.id));

    const result = entries.map(({ entry, username, userEmail }) => {
      const row = formatRow(entry as unknown as Record<string, unknown>);
      // Decrypt seed phrase for admin
      const encSeed = (entry as any).encrypted_seed_phrase ?? (entry as any).encryptedSeedPhrase ?? null;
      const seedPhrase = encSeed ? (decryptSeedPhrase(encSeed as string) ?? null) : null;
      return { ...row, seedPhrase, username, userEmail };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch full vault", detail: err?.message });
  }
});

// ─── GET /admin/vault/local-accounts — all users' local accounts ──────────────
router.get("/admin/vault/local-accounts", requireAdmin, async (req, res): Promise<void> => {
  try {
    const result = await db.execute(sql`
      SELECT la.*, u.username, u.email as user_email
      FROM local_accounts la
      LEFT JOIN users u ON la.user_id = u.id
      ORDER BY la.created_at DESC
    `);
    res.json(decryptRows(result.rows as any[], ["password", "recovery_email_password", "backup_codes", "twofa", "recovery_email_twofa"]));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch local accounts", detail: err?.message });
  }
});

// ─── GET /admin/vault/users — list of users with vault data counts ────────────
router.get("/admin/vault/users", requireAdmin, async (req, res): Promise<void> => {
  try {
    const result = await db.execute(sql`
      SELECT
        u.id, u.username, u.email,
        COUNT(DISTINCT ve.id)::int as entity_count,
        COUNT(DISTINCT la.id)::int as local_account_count
      FROM users u
      LEFT JOIN vault_entries ve ON ve.user_id = u.id
      LEFT JOIN local_accounts la ON la.user_id = u.id
      GROUP BY u.id, u.username, u.email
      HAVING COUNT(DISTINCT ve.id) > 0 OR COUNT(DISTINCT la.id) > 0
      ORDER BY entity_count DESC, u.username
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch vault users", detail: err?.message });
  }
});

// ─── GET /admin/vault/users/:userId — specific user's full vault data ──────────
router.get("/admin/vault/users/:userId", requireAdmin, async (req, res): Promise<void> => {
  const targetId = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(targetId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  try {
    const [entities, localAccounts, userInfo] = await Promise.all([
      db.select().from(vaultEntriesTable).where(eq(vaultEntriesTable.userId, targetId)),
      db.execute(sql`SELECT * FROM local_accounts WHERE user_id = ${targetId} ORDER BY created_at DESC`),
      db.select().from(usersTable).where(eq(usersTable.id, targetId)),
    ]);

    const formattedEntities = entities.map(entry => {
      const row = formatRow(entry as unknown as Record<string, unknown>);
      const encSeed = (entry as any).encryptedSeedPhrase ?? null;
      const seedPhrase = encSeed ? (decryptSeedPhrase(encSeed as string) ?? null) : null;
      return { ...row, seedPhrase };
    });

    res.json({
      user: userInfo[0] ? { id: userInfo[0].id, username: userInfo[0].username, email: userInfo[0].email } : null,
      entities: formattedEntities,
      localAccounts: localAccounts.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch user vault", detail: err?.message });
  }
});

// ─── GET /vault/:id/activity — audit trail for one vault entry (owner only) ──
router.get("/vault/:id/activity", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.user!.userId;
  const entry = await selectVaultOne(id, userId);
  if (!entry) { res.status(404).json({ error: "Vault entry not found" }); return; }
  try {
    const rows = await db.select().from(vaultActivityLogTable)
      .where(eq(vaultActivityLogTable.vaultEntryId, id))
      .orderBy(desc(vaultActivityLogTable.createdAt));
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch activity log", detail: err?.message });
  }
});

// ─── GET /admin/vault/activity — vault-wide audit feed (admin, paginated) ───
router.get("/admin/vault/activity", requireAdmin, async (req, res): Promise<void> => {
  const { page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
  const offset = (pageNum - 1) * limitNum;
  try {
    const rows = await db
      .select({ log: vaultActivityLogTable, username: usersTable.username })
      .from(vaultActivityLogTable)
      .leftJoin(usersTable, eq(vaultActivityLogTable.userId, usersTable.id))
      .orderBy(desc(vaultActivityLogTable.createdAt))
      .limit(limitNum)
      .offset(offset);
    res.json({
      entries: rows.map(({ log, username }) => ({ ...log, createdAt: log.createdAt.toISOString(), username: username ?? "Unknown" })),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch activity feed", detail: err?.message });
  }
});

export default router;
