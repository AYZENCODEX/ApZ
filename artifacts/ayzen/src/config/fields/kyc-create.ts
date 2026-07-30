import type { FieldDef } from "@/config/types";

// Field config for components/kyc-entries.tsx's Add/Edit KYC Entity dialog.
// Same config-driven pattern as entity-create.ts / local-account-create.ts —
// consumer renders <SchemaForm fields={KYC_FIELDS.filter(...)} tab="..." .../>
// per active top-level tab, and for the "kyc" tab additionally filters by
// `subtab` (SchemaForm itself only understands `tab`) — see entity-create.ts's
// comment for the same pattern on the Account tab there.
//
// Category (the box picker) is its own step in the dialog, not a field here.
//
// "paid" (type: "toggle") is listed here for the field set's documentation,
// but SchemaForm/FieldBlock doesn't have a toggle control (same situation
// noted in local-account-buy.ts) — kyc-entries.tsx renders it as its own
// Yes/No pill pair next to the Seller sub-tab's SchemaForm, and excludes
// key === "paid" from what it passes into SchemaForm.

export const KYC_FIELDS: FieldDef[] = [
  // ── Account ───────────────────────────────────────────────────────────
  {
    key: "username", label: "Username", type: "text", tab: "account",
    pairKey: "acct-1", placeholder: "account username / handle", compact: true,
  },
  {
    key: "accountPassword", label: "Account Password", type: "password", tab: "account",
    pairKey: "acct-1", placeholder: "••••••••", compact: true,
  },
  {
    key: "notes", label: "Notes", type: "textarea", tab: "account",
    placeholder: "Any additional info about this KYC entity...", rows: 3,
  },

  // ── Email ─────────────────────────────────────────────────────────────
  {
    key: "email", label: "Email", type: "text", tab: "email",
    pairKey: "email-1", placeholder: "account@email.com", compact: true,
  },
  {
    key: "emailPassword", label: "Email Password", type: "password", tab: "email",
    pairKey: "email-1", placeholder: "••••••••", compact: true,
  },
  {
    key: "email2fa", label: "Email 2FA Secret", type: "text", tab: "email",
    pairKey: "email-2", placeholder: "TOTP secret...", compact: true,
  },
  {
    key: "emailBackupCode", label: "Email Backup Code", type: "text", tab: "email",
    pairKey: "email-2", placeholder: "backup code...", compact: true,
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
  // NID photo pair — front/back (or selfie-with-NID, up to the user).
  // Stored as data-URLs in kyc_entries.photo1_url/photo2_url, same as
  // project-create.ts's thumbnailUrl/bannerUrl image fields.
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
