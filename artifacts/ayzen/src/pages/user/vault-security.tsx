/**
 * vault-security.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 5 — Vault Security: PINs & Session.
 *
 * Lets the user set/change two independent 4-digit PINs (stored hashed
 * server-side, see routes/vault-security.ts):
 *   - Vault PIN   — required to unlock Vault itself (components/vault/vault-unlock-gate.tsx)
 *   - Entity PIN  — required to view any entity's details, one shared PIN
 *                   for every entity (components/vault/entity-pin-gate.tsx)
 *
 * "Keep me signed in" isn't a setting stored here — it's a checkbox on the
 * Vault unlock screen itself (see vault-unlock-gate.tsx), so this page just
 * explains what it does rather than duplicating a control for it.
 */
import { useEffect, useState } from "react";
import { ShieldCheck, KeyRound, Loader2, CheckCircle2, Circle, Clock, Lock } from "lucide-react";
import { useLocation } from "wouter";
import { VaultSectionPage } from "@/components/layout/vault-sidebar";
import { PinInput } from "@/components/vault/pin-input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getVaultSecurityStatus, setPin, type PinKind, type VaultSecurityStatus } from "@/lib/vault-security-api";
import { lockVault, lockEntityView } from "@/lib/vault-lock";
import { ApiError } from "@workspace/api-client-react";

export default function VaultSecurity() {
  const [status, setStatus] = useState<VaultSecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogKind, setDialogKind] = useState<PinKind | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const refresh = () => {
    setLoading(true);
    getVaultSecurityStatus()
      .then(setStatus)
      .catch(() => toast({ title: "Couldn't load security status", variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  return (
    <VaultSectionPage
      title="Security"
      description="Vault PIN, entity-view PIN & sign-in"
      icon={ShieldCheck}
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <PinStatusCard
            icon={ShieldCheck}
            title="Vault PIN"
            description="Required every time Vault is unlocked."
            isSet={!!status?.vaultPinSet}
            onManage={() => setDialogKind("vault")}
          />
          <PinStatusCard
            icon={KeyRound}
            title="Entity-View PIN"
            description="One shared PIN required to view any entity's details."
            isSet={!!status?.entityPinSet}
            onManage={() => setDialogKind("entity")}
          />

          <Card className="border-dashed border-border/40 bg-muted/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wide flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary/60" /> Keep Me Signed In
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs font-mono text-muted-foreground/70 leading-relaxed">
              When unlocking Vault, check "Keep me signed in" to stay unlocked for 3 hours
              without re-entering your Vault PIN. Leave it unchecked to require the PIN again
              as soon as this tab closes. This only applies to the Vault PIN — the entity-view
              PIN is asked once per browser session either way.
            </CardContent>
            <CardFooter>
              <Button
                variant="outline" size="sm" className="font-mono text-xs gap-1.5"
                onClick={() => {
                  lockVault();
                  lockEntityView();
                  toast({ title: "Vault locked", description: "You'll be asked for your PIN(s) again." });
                  navigate("/vault");
                }}
              >
                <Lock className="w-3.5 h-3.5" /> Lock Vault Now
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {dialogKind && (
        <PinDialog
          kind={dialogKind}
          isChange={dialogKind === "vault" ? !!status?.vaultPinSet : !!status?.entityPinSet}
          onClose={() => setDialogKind(null)}
          onSaved={() => { setDialogKind(null); refresh(); }}
        />
      )}
    </VaultSectionPage>
  );
}

function PinStatusCard({
  icon: Icon, title, description, isSet, onManage,
}: {
  icon: React.ElementType; title: string; description: string; isSet: boolean; onManage: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono uppercase tracking-wide flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary/60" /> {title}
        </CardTitle>
        <CardDescription className="text-xs font-mono">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1.5 text-xs font-mono">
          {isSet ? (
            <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> <span className="text-emerald-400">PIN set</span></>
          ) : (
            <><Circle className="w-3.5 h-3.5 text-muted-foreground/40" /> <span className="text-muted-foreground/60">Not set</span></>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button variant={isSet ? "outline" : "default"} size="sm" className="font-mono text-xs" onClick={onManage}>
          {isSet ? "Change PIN" : "Set PIN"}
        </Button>
      </CardFooter>
    </Card>
  );
}

type Step = "current" | "new" | "confirm";

function PinDialog({
  kind, isChange, onClose, onSaved,
}: {
  kind: PinKind; isChange: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [step, setStep] = useState<Step>(isChange ? "current" : "new");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const label = kind === "vault" ? "Vault PIN" : "Entity-View PIN";

  function handleCurrentComplete(pin: string) {
    setCurrentPin(pin);
    setError(null);
    setStep("new");
  }

  function handleNewComplete(pin: string) {
    setNewPin(pin);
    setError(null);
    setStep("confirm");
  }

  async function handleConfirmComplete(pin: string) {
    setConfirmPin(pin);
    if (pin !== newPin) {
      setError("PINs don't match — try again.");
      setConfirmPin("");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setPin(kind, newPin, isChange ? currentPin : undefined);
      toast({ title: `${label} saved`, description: isChange ? "Your PIN has been updated." : "Your PIN is now active." });
      onSaved();
    } catch (err) {
      setNewPin("");
      setConfirmPin("");
      if (err instanceof ApiError && err.status === 403) {
        setError("Current PIN was incorrect.");
        setCurrentPin("");
        setStep("current");
      } else {
        setError("Couldn't save PIN — try again.");
        setStep("new");
      }
    } finally {
      setSaving(false);
    }
  }

  const stepCopy: Record<Step, string> = {
    current: `Enter your current ${label.toLowerCase()}`,
    new: isChange ? `Enter a new ${label.toLowerCase()}` : `Choose a ${label.toLowerCase()}`,
    confirm: `Confirm your new ${label.toLowerCase()}`,
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wide">{isChange ? `Change ${label}` : `Set ${label}`}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{stepCopy[step]}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {step === "current" && (
            <PinInput value={currentPin} onChange={setCurrentPin} onComplete={handleCurrentComplete} disabled={saving} error={!!error} autoFocus />
          )}
          {step === "new" && (
            <PinInput value={newPin} onChange={setNewPin} onComplete={handleNewComplete} disabled={saving} error={!!error} autoFocus />
          )}
          {step === "confirm" && (
            <PinInput value={confirmPin} onChange={setConfirmPin} onComplete={handleConfirmComplete} disabled={saving} error={!!error} autoFocus />
          )}
        </div>

        {error && <p className="text-destructive font-mono text-xs text-center -mt-2">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" size="sm" className="font-mono text-xs" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {saving && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
