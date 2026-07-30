/**
 * lib/vault-lock.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 5 — Vault Security: PINs & Session.
 *
 * Client-side unlock state for the two PIN gates. The server (routes/vault-security.ts)
 * only ever verifies a PIN was entered correctly — it doesn't issue or track a
 * session of its own. "Staying unlocked" is a local, per-browser UI state, same
 * spirit as the existing account "keep me signed in" toggle in hooks/use-auth.tsx
 * (localStorage vs sessionStorage), just with an explicit expiry on top.
 *
 * Vault-login PIN (see components/vault/vault-unlock-gate.tsx):
 *   - "Keep me signed in" checked   → unlock recorded in localStorage, survives
 *     closing the tab/browser, expires after VAULT_UNLOCK_HOURS.
 *   - Unchecked                     → unlock recorded in sessionStorage only,
 *     so it disappears the moment the tab closes — but still capped at
 *     VAULT_UNLOCK_HOURS in case the tab is left open that long.
 *   Either way, once the timestamp passes, isVaultUnlocked() goes false and
 *   the gate re-prompts for the PIN — this is the "re-locks after 3 hours"
 *   acceptance criterion.
 *
 * Entity-view PIN (see components/vault/entity-pin-gate.tsx):
 *   - No "keep me signed in" concept in the spec — unlocking is scoped to the
 *     current browser session only (sessionStorage, no expiry needed beyond
 *     that), so re-entering the entity PIN is required again next session but
 *     not on every single entity within one.
 */

const VAULT_UNLOCK_KEY = "ayzen_vault_unlock_until";
const ENTITY_UNLOCK_KEY = "ayzen_entity_unlock";

export const VAULT_UNLOCK_HOURS = 3;

function readVaultUnlockUntil(): number | null {
  const raw = localStorage.getItem(VAULT_UNLOCK_KEY) ?? sessionStorage.getItem(VAULT_UNLOCK_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** True if the vault-login PIN unlock is still within its window. */
export function isVaultUnlocked(): boolean {
  const until = readVaultUnlockUntil();
  return !!until && until > Date.now();
}

/** Record a successful vault-PIN unlock. `keepSignedIn` picks the storage (see file header). */
export function setVaultUnlocked(keepSignedIn: boolean): void {
  const until = Date.now() + VAULT_UNLOCK_HOURS * 60 * 60 * 1000;
  localStorage.removeItem(VAULT_UNLOCK_KEY);
  sessionStorage.removeItem(VAULT_UNLOCK_KEY);
  (keepSignedIn ? localStorage : sessionStorage).setItem(VAULT_UNLOCK_KEY, String(until));
}

/** Re-lock Vault immediately (e.g. a manual "Lock Vault" action, or on logout). */
export function lockVault(): void {
  localStorage.removeItem(VAULT_UNLOCK_KEY);
  sessionStorage.removeItem(VAULT_UNLOCK_KEY);
}

/** True if the entity-view PIN has already been unlocked for this browser session. */
export function isEntityViewUnlocked(): boolean {
  return sessionStorage.getItem(ENTITY_UNLOCK_KEY) === "1";
}

/** Record a successful entity-PIN unlock for the rest of this browser session. */
export function setEntityViewUnlocked(): void {
  sessionStorage.setItem(ENTITY_UNLOCK_KEY, "1");
}

/** Re-lock entity-detail viewing immediately. */
export function lockEntityView(): void {
  sessionStorage.removeItem(ENTITY_UNLOCK_KEY);
}

/** Clears both unlock states — call this on account logout. */
export function clearAllVaultLocks(): void {
  lockVault();
  lockEntityView();
}
