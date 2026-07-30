import type { ElementType } from "react";
import {
  Shield, Mail, Twitter, MessageSquare, Phone, Wallet, Key, FileText, Smartphone,
} from "lucide-react";

// Entity completeness-check config for pages/user/vault-entity-dashboard.tsx.
// See UI_CONFIG_PLAN.md Phase B ("Entity create/edit/view ... extends
// existing CHECKS"). Previously a page-local CHECKS array; moved here so it
// has one home a new credential type can be added to, matching the field
// config in fields/entity-create.ts (e.g. adding a new platform means one
// entry here for the health check *and* one entry in ENTITY_FIELDS for the
// form — not page-JSX edits in either place).

type EntryAny = any;

export interface CheckItem {
  key: string;
  label: string;
  icon: ElementType;
  color: string;
  getValue: (e: EntryAny) => boolean;
}

export const ENTITY_HEALTH_CHECKS: CheckItem[] = [
  { key: "email",       label: "Main Email",     icon: Mail,          color: "text-cyan-400",         getValue: e => !!e.email },
  { key: "emailPass",   label: "Email Password", icon: Key,           color: "text-amber-400",        getValue: e => !!e.emailPassword },
  { key: "twitter",     label: "Twitter",        icon: Twitter,       color: "text-sky-400",          getValue: e => !!e.twitterUsername },
  { key: "twitter2fa",  label: "Twitter 2FA",    icon: Smartphone,    color: "text-sky-300",          getValue: e => !!e.twitter2fa },
  { key: "discord",     label: "Discord",        icon: MessageSquare, color: "text-indigo-400",       getValue: e => !!e.discordUsername },
  { key: "discord2fa",  label: "Discord 2FA",    icon: Smartphone,    color: "text-indigo-300",       getValue: e => !!e.discord2fa },
  { key: "telegram",    label: "Telegram",       icon: Phone,         color: "text-blue-400",         getValue: e => !!e.telegramUsername || !!e.telegramPhone },
  { key: "telegram2fa", label: "Telegram 2FA",   icon: Smartphone,    color: "text-blue-300",         getValue: e => !!e.telegram2fa },
  { key: "wallet",      label: "Wallet Address", icon: Wallet,        color: "text-emerald-400",      getValue: e => Array.isArray(e.walletAddresses) ? e.walletAddresses.length > 0 : !!e.walletAddresses },
  { key: "seed",        label: "Seed Phrase",    icon: Shield,        color: "text-violet-400",       getValue: e => !!e.hasSeedPhrase },
  { key: "backup",      label: "Backup Codes",   icon: Key,           color: "text-orange-400",       getValue: e => Array.isArray(e.backupCodes) ? e.backupCodes.length > 0 : !!e.backupCodes },
  { key: "notes",       label: "Notes",          icon: FileText,      color: "text-muted-foreground", getValue: e => !!e.notes },
];
