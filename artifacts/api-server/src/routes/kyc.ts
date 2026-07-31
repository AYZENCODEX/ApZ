import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { encryptField, decryptRow, decryptRows } from "../lib/vault-crypto";

const router = Router();

// Credential/PII columns encrypted at rest (see lib/vault-crypto.ts).
const KYC_SENSITIVE_FIELDS = [
  "account_password", "email_password", "email_2fa", "email_backup_code", "nid_number",
  // Extended Account fields
  "account_2fa", "account_backup_code",
  "email_recovery_password", "recovery_2fa", "recovery_backup_code",
] as const;

// Safely escape a string for SQL — mirrors routes/local-accounts.ts
const safe = (v: unknown) => v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const safeNum = (v: unknown) => isNaN(Number(v)) ? 0 : Number(v);
const safeDate = (v: unknown) => v ? `'${String(v).replace(/'/g, "''")}'` : "NULL";
const safeBool = (v: unknown) => v ? "TRUE" : "FALSE";

// ─── GET /kyc-entries — list user's KYC entities ──────────────────────────────
router.get("/kyc-entries", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const category = (req.query.category as string) || null;
  try {
    const q = category
      ? sql.raw(`SELECT * FROM kyc_entries WHERE user_id = ${userId} AND category = ${safe(category)} ORDER BY created_at DESC`)
      : sql.raw(`SELECT * FROM kyc_entries WHERE user_id = ${userId} ORDER BY created_at DESC`);
    const result = await db.execute(q);
    res.json(decryptRows(result.rows as any[], KYC_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── POST /kyc-entries — create KYC entity ─────────────────────────────────────
router.post("/kyc-entries", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const {
    category = "Other",
    // Account · Main
    username = null, accountPassword = null, notes = null,
    email = null, emailPassword = null,
    account2fa = null, accountBackupCode = null,
    email2fa = null, emailBackupCode = null,
    // Account · Info
    lastLoginAt = null, accountBuyDate = null, accountCreateDate = null,
    accountBuyPrice = 0, accountWorth = 0, kycFollowers = null,
    // Account · Recovery
    emailRecovery = null, emailRecoveryPassword = null,
    recovery2fa = null, recoveryBackupCode = null,
    // KYC · Info
    nidNumber = null, name = null, fatherName = null, birthDate = null,
    photo1Url = null, photo2Url = null,
    // KYC · Seller
    platform = null, buyPrice = 0, location = null, connection = null,
    contactNumber = null, buyDate = null, paid = false, sellerName = null, socialAccount = null,
  } = req.body;

  if (!category) { res.status(400).json({ error: "Category required" }); return; }

  try {
    const result = await db.execute(sql.raw(`
      INSERT INTO kyc_entries
        (user_id, category, username, account_password, notes,
         email, email_password, email_2fa, email_backup_code,
         account_2fa, account_backup_code,
         last_login_at, account_buy_date, account_create_date,
         account_buy_price, account_worth, followers,
         email_recovery, email_recovery_password, recovery_2fa, recovery_backup_code,
         nid_number, name, father_name, birth_date, photo1_url, photo2_url,
         platform, buy_price, location, connection, contact_number, buy_date, paid, seller_name, social_account)
      VALUES
        (${userId}, ${safe(category)}, ${safe(username)}, ${safe(encryptField(accountPassword))}, ${safe(notes)},
         ${safe(email)}, ${safe(encryptField(emailPassword))}, ${safe(encryptField(email2fa))}, ${safe(encryptField(emailBackupCode))},
         ${safe(encryptField(account2fa))}, ${safe(encryptField(accountBackupCode))},
         ${safeDate(lastLoginAt)}, ${safeDate(accountBuyDate)}, ${safeDate(accountCreateDate)},
         ${safeNum(accountBuyPrice)}, ${safeNum(accountWorth)}, ${safe(kycFollowers)},
         ${safe(emailRecovery)}, ${safe(encryptField(emailRecoveryPassword))}, ${safe(encryptField(recovery2fa))}, ${safe(encryptField(recoveryBackupCode))},
         ${safe(encryptField(nidNumber))}, ${safe(name)}, ${safe(fatherName)}, ${safeDate(birthDate)}, ${safe(photo1Url)}, ${safe(photo2Url)},
         ${safe(platform)}, ${safeNum(buyPrice)}, ${safe(location)}, ${safe(connection)},
         ${safe(contactNumber)}, ${safeDate(buyDate)}, ${safeBool(paid)}, ${safe(sellerName)}, ${safe(socialAccount)})
      RETURNING *
    `));
    res.status(201).json(decryptRow(result.rows[0] as any, KYC_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── GET /kyc-entries/:id — fetch single KYC entity ───────────────────────────
router.get("/kyc-entries/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const result = await db.execute(sql.raw(`SELECT * FROM kyc_entries WHERE id = ${id} AND user_id = ${userId} LIMIT 1`));
    if (!result.rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(decryptRow(result.rows[0] as any, KYC_SENSITIVE_FIELDS));
  } catch (err: any) { res.status(500).json({ error: "DB error", detail: err?.message }); }
});

// ─── PUT /kyc-entries/:id — update KYC entity ─────────────────────────────────
router.put("/kyc-entries/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const {
    category, username, accountPassword, notes,
    email, emailPassword, email2fa, emailBackupCode,
    account2fa, accountBackupCode,
    lastLoginAt, accountBuyDate, accountCreateDate,
    accountBuyPrice, accountWorth, kycFollowers,
    emailRecovery, emailRecoveryPassword, recovery2fa, recoveryBackupCode,
    nidNumber, name, fatherName, birthDate, photo1Url, photo2Url,
    platform, buyPrice, location, connection,
    contactNumber, buyDate, paid, sellerName, socialAccount,
  } = req.body;

  try {
    const result = await db.execute(sql.raw(`
      UPDATE kyc_entries SET
        category = ${safe(category)}, username = ${safe(username)},
        account_password = ${safe(encryptField(accountPassword))}, notes = ${safe(notes)},
        email = ${safe(email)}, email_password = ${safe(encryptField(emailPassword))},
        email_2fa = ${safe(encryptField(email2fa))}, email_backup_code = ${safe(encryptField(emailBackupCode))},
        account_2fa = ${safe(encryptField(account2fa))}, account_backup_code = ${safe(encryptField(accountBackupCode))},
        last_login_at = ${safeDate(lastLoginAt)}, account_buy_date = ${safeDate(accountBuyDate)},
        account_create_date = ${safeDate(accountCreateDate)},
        account_buy_price = ${safeNum(accountBuyPrice)}, account_worth = ${safeNum(accountWorth)},
        followers = ${safe(kycFollowers)},
        email_recovery = ${safe(emailRecovery)},
        email_recovery_password = ${safe(encryptField(emailRecoveryPassword))},
        recovery_2fa = ${safe(encryptField(recovery2fa))},
        recovery_backup_code = ${safe(encryptField(recoveryBackupCode))},
        nid_number = ${safe(encryptField(nidNumber))}, name = ${safe(name)},
        father_name = ${safe(fatherName)}, birth_date = ${safeDate(birthDate)},
        photo1_url = ${safe(photo1Url)}, photo2_url = ${safe(photo2Url)},
        platform = ${safe(platform)}, buy_price = ${safeNum(buyPrice)},
        location = ${safe(location)}, connection = ${safe(connection)},
        contact_number = ${safe(contactNumber)}, buy_date = ${safeDate(buyDate)},
        paid = ${paid !== undefined ? safeBool(paid) : "paid"},
        seller_name = ${safe(sellerName)}, social_account = ${safe(socialAccount)},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `));
    if (!result.rows.length) { res.status(404).json({ error: "Not found or forbidden" }); return; }
    res.json(decryptRow(result.rows[0] as any, KYC_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── PATCH /kyc-entries/:id/status — ban / unban KYC entity ──────────────────
router.patch("/kyc-entries/:id/status", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const allowed = ["active", "banned"];
  const status = req.body.status;
  if (!allowed.includes(status)) { res.status(400).json({ error: "status must be one of: active, banned" }); return; }

  try {
    const result = await db.execute(sql.raw(`
      UPDATE kyc_entries SET status = ${safe(status)}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `));
    if (!result.rows.length) { res.status(404).json({ error: "Not found or forbidden" }); return; }
    res.json(decryptRow(result.rows[0] as any, KYC_SENSITIVE_FIELDS));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ─── DELETE /kyc-entries/:id — delete KYC entity ──────────────────────────────
router.delete("/kyc-entries/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.execute(sql.raw(`DELETE FROM kyc_entries WHERE id = ${id} AND user_id = ${userId}`));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

export default router;
