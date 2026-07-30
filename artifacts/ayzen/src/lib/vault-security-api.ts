/**
 * lib/vault-security-api.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 5 — Vault Security: PINs & Session.
 *
 * Thin typed wrapper around customFetch for routes/vault-security.ts. Not
 * generated from the OpenAPI spec (same pattern as several other Vault
 * sub-pages, e.g. vault-2fa-entity.tsx's direct customFetch calls) — this
 * endpoint set is small enough that hand-writing it is simpler than wiring
 * up codegen for it.
 */
import { customFetch } from "@workspace/api-client-react";

export type PinKind = "vault" | "entity";

export interface VaultSecurityStatus {
  vaultPinSet: boolean;
  entityPinSet: boolean;
  updatedAt: string | null;
}

export interface VerifyPinResult {
  valid: boolean;
  pinSet: boolean;
}

export function getVaultSecurityStatus(): Promise<VaultSecurityStatus> {
  return customFetch<VaultSecurityStatus>("/vault/security/status");
}

export function setPin(kind: PinKind, pin: string, currentPin?: string): Promise<{ ok: true; kind: PinKind }> {
  return customFetch("/vault/security/pin", {
    method: "PUT",
    body: JSON.stringify({ kind, pin, currentPin }),
  });
}

export function verifyPin(kind: PinKind, pin: string): Promise<VerifyPinResult> {
  return customFetch("/vault/security/verify", {
    method: "POST",
    body: JSON.stringify({ kind, pin }),
  });
}
