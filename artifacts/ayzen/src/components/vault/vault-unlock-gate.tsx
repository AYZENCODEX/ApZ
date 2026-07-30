/**
 * components/vault/vault-unlock-gate.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 5 — Vault Security: PINs & Session.
 *
 * Wraps every /vault/* route (see App.tsx) and requires the vault-login PIN
 * before rendering the page underneath:
 *
 *   - No vault PIN set yet         → renders children immediately. This is
 *     what lets a brand-new user reach /vault/security to set their first
 *     PIN without being locked out of the page that sets it.
 *   - PIN set, already unlocked    → renders children immediately (see
 *     lib/vault-lock.ts for what "unlocked" means and how long it lasts).
 *   - PIN set, locked              → shows the unlock screen with a "Keep me
 *     signed in" checkbox (3-hour session, see lib/vault-lock.ts) and blocks
 *     children until the correct PIN is entered.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PinInput } from "@/components/vault/pin-input";
import { getVaultSecurityStatus, verifyPin } from "@/lib/vault-security-api";
import { isVaultUnlocked, setVaultUnlocked } from "@/lib/vault-lock";
import { ApiError } from "@workspace/api-client-react";

type GateState = "checking" | "open" | "locked";

export function VaultUnlockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    let cancelled = false;
    getVaultSecurityStatus()
      .then(status => {
        if (cancelled) return;
        if (!status.vaultPinSet || isVaultUnlocked()) {
          setState("open");
        } else {
          setState("locked");
        }
      })
      .catch(() => {
        // If the status check itself fails, don't hard-lock the user out of
        // Vault over a transient network error — fail open, same as before
        // this feature existed.
        if (!cancelled) setState("open");
      });
    return () => { cancelled = true; };
  }, []);

  if (state === "checking") {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (state === "locked") {
    return <VaultUnlockScreen onUnlocked={() => setState("open")} />;
  }

  return <>{children}</>;
}

function VaultUnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function submit(candidate: string) {
    if (verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await verifyPin("vault", candidate);
      if (result.valid) {
        setVaultUnlocked(keepSignedIn);
        onUnlocked();
      } else {
        setError("Incorrect PIN");
        setPin("");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError((err.data as any)?.solution ?? "Too many attempts — try again shortly.");
      } else {
        setError("Couldn't verify PIN — try again.");
      }
      setPin("");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center page-enter">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
          <ShieldCheck className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold font-mono uppercase tracking-tight">Vault Locked</h1>
          <p className="text-muted-foreground font-mono text-xs mt-1">Enter your Vault PIN to continue</p>
        </div>

        <PinInput value={pin} onChange={setPin} onComplete={submit} disabled={verifying} error={!!error} />

        {error && (
          <p className="text-destructive font-mono text-xs flex items-center justify-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </p>
        )}

        <div className="flex items-center justify-center gap-2">
          <Checkbox id="keep-signed-in" checked={keepSignedIn} onCheckedChange={v => setKeepSignedIn(!!v)} />
          <Label htmlFor="keep-signed-in" className="font-mono text-xs text-muted-foreground cursor-pointer">
            Keep me signed in for 3 hours
          </Label>
        </div>

        <Button
          size="sm"
          className="font-mono text-xs uppercase tracking-wider"
          disabled={pin.length !== 4 || verifying}
          onClick={() => submit(pin)}
        >
          {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Unlock"}
        </Button>
      </div>
    </div>
  );
}
