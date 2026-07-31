import type { FieldDef } from "@/config/types";

// Field config for components/kyc-entries.tsx's Add/Edit KYC Entity dialog.
// Account tab is split into three sub-tabs (Main / Info / Recovery) to mirror
// the vault entity create dialog. KYC tab keeps Info/Seller sub-tabs.
// Email tab is retained for IMAP/SMTP configuration.
//
// "paid" (type: "toggle") has no SchemaForm control — kyc-entries.tsx renders
// it as its own Yes/No pill pair next to the Seller SchemaForm.

export const ACCOUNT_KYC_SUBTABS = [
  { id: "main",     label: "Main" },
  { id: "info",     label: "Info" },
  { id: "recovery", label: "Recovery" },
] as const;

export const KYC_FIELDS: FieldDef[] = [
  // ── Account · Main ───────────────────────────────────────────────────
  {
    key: "username", label: "Username", type: "text", tab: "account", subtab: "main",
    pairKey: "acct-1", placeholder: "account username / handle", compact: true,
  },
  {
    key: "accountPassword", label: "Account Password", type: "password", tab: "account", subtab: "main",
    pairKey: "acct-1", placeholder: "••••••••", compact: true,
  },
  {
    key: "email", label: "Email", type: "text", tab: "account", subtab: "main",
    pairKey: "acct-2", placeholder: "account@email.com", compact: true,
  },
  {
    key: "emailPassword", label: "Email Password", type: "password", tab: "account", subtab: "main",
    pairKey: "acct-2", placeholder: "••••••••", compact: true,
  },
  {
    key: "account2fa", label: "Account 2FA Secret", type: "text", tab: "account", subtab: "main",
    pairKey: "acct-3", placeholder: "TOTP secret...", compact: true,
  },
  {
    key: "accountBackupCode", label: "Account Backup Code", type: "text", tab: "account", subtab: "main",
    pairKey: "acct-3", placeholder: "backup code...", compact: true,
  },
  {
    key: "email2fa", label: "Email 2FA Secret", type: "text", tab: "account", subtab: "main",
    pairKey: "acct-4", placeholder: "TOTP secret...", compact: true,
  },
  {
    key: "emailBackupCode", label: "Email Backup Code", type: "text", tab: "account", subtab: "main",
    pairKey: "acct-4", placeholder: "backup code...", compact: true,
  },
  {
    key: "notes", label: "Notes", type: "textarea", tab: "account", subtab: "main",
    placeholder: "Any additional info about this KYC entity...", rows: 3,
  },

  // ── Account · Info ────────────────────────────────────────────────────
  {
    key: "lastLoginAt", label: "Last Login", type: "date", tab: "account", subtab: "info",
    pairKey: "info-date", compact: true,
  },
  {
    key: "accountBuyDate", label: "Buy Date", type: "date", tab: "account", subtab: "info",
    pairKey: "info-date", compact: true,
  },
  {
    key: "accountCreateDate", label: "Create Date", type: "date", tab: "account", subtab: "info",
    pairKey: "info-date2", compact: true,
  },
  {
    key: "accountBuyPrice", label: "Buy Price ($)", type: "number", tab: "account", subtab: "info",
    pairKey: "info-value", placeholder: "e.g. 20", compact: true,
  },
  {
    key: "accountWorth", label: "Worth ($)", type: "number", tab: "account", subtab: "info",
    pairKey: "info-value", placeholder: "e.g. 50", compact: true,
  },
  {
    key: "kycFollowers", label: "Followers / Metric", type: "text", tab: "account", subtab: "info",
    placeholder: "e.g. 1200", compact: true,
  },

  // ── Account · Recovery ───────────────────────────────────────────────
  {
    key: "emailRecovery", label: "Recovery Email", type: "text", tab: "account", subtab: "recovery",
    pairKey: "rec-1", placeholder: "recovery@email.com", compact: true,
  },
  {
    key: "emailRecoveryPassword", label: "Recovery Email Password", type: "password", tab: "account", subtab: "recovery",
    pairKey: "rec-1", placeholder: "••••••••", compact: true,
  },
  {
    key: "recovery2fa", label: "Recovery 2FA Secret", type: "text", tab: "account", subtab: "recovery",
    pairKey: "rec-2", placeholder: "TOTP secret...", compact: true,
  },
  {
    key: "recoveryBackupCode", label: "Recovery Backup Code", type: "text", tab: "account", subtab: "recovery",
    pairKey: "rec-2", placeholder: "backup code...", compact: true,
  },

  // ── KYC · Info ────────────────────────────────────────────────────────
  {
    key: "nidNumber", label: "NID Number", type: "text", tab: "kyc", subtab: "info",
    pairKey: "info-1", placeholder: "e.g. 1990123456789", compact: true,
  },
  {
    key: "name", label: "Name", type: "text", tab: "kyc", subtab: "info",
    pairKey: "info-1", placeholder: "Full name as on NID", compact: true,
  },
  {
    key: "fatherName", label: "Father's Name", type: "text", tab: "kyc", subtab: "info",
    pairKey: "info-2", placeholder: "Father's full name", compact: true,
  },
  {
    key: "birthDate", label: "Birthdate", type: "date", tab: "kyc", subtab: "info",
    pairKey: "info-2", compact: true,
  },
  {
    key: "photo1Url", label: "Photo 1", type: "image", tab: "kyc", subtab: "info",
    help: "NID front (or any ID photo).",
  },
  {
    key: "photo2Url", label: "Photo 2", type: "image", tab: "kyc", subtab: "info",
    help: "NID back (or a second ID photo).",
  },

  // ── KYC · Seller ──────────────────────────────────────────────────────
  {
    key: "platform", label: "Platform", type: "text", tab: "kyc", subtab: "seller",
    pairKey: "seller-1", placeholder: "e.g. Bitget", compact: true,
  },
  {
    key: "buyPrice", label: "Buy Price ($)", type: "number", tab: "kyc", subtab: "seller",
    pairKey: "seller-1", placeholder: "e.g. 20", compact: true,
  },
  {
    key: "location", label: "Location", type: "text", tab: "kyc", subtab: "seller",
    pairKey: "seller-2", placeholder: "e.g. Dhaka, BD", compact: true,
  },
  {
    key: "connection", label: "Connection", type: "text", tab: "kyc", subtab: "seller",
    pairKey: "seller-2", placeholder: "how you're connected to the seller", compact: true,
  },
  {
    key: "contactNumber", label: "Contact Number", type: "text", tab: "kyc", subtab: "seller",
    pairKey: "seller-3", placeholder: "+8801XXXXXXXXX", compact: true,
  },
  {
    key: "buyDate", label: "Buy Date", type: "date", tab: "kyc", subtab: "seller",
    pairKey: "seller-3", compact: true,
  },
  {
    key: "sellerName", label: "Seller Name", type: "text", tab: "kyc", subtab: "seller",
    pairKey: "seller-4", placeholder: "seller's name", compact: true,
  },
  {
    key: "socialAccount", label: "Social Account", type: "text", tab: "kyc", subtab: "seller",
    pairKey: "seller-4", placeholder: "FB/Telegram/WhatsApp link or handle", compact: true,
  },
  {
    key: "paid", label: "Paid", type: "toggle", tab: "kyc", subtab: "seller",
    help: "Toggle on once the seller has been paid.",
  },
];
