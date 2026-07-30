/**
 * vault-backup.tsx
 * ─────────────────────────────────────────────
 * Phase 6 — Backup Codes.
 *
 * Lists every entity in the vault; clicking one reveals its stored backup
 * codes (vault_entries.backup_codes, already captured via the entity form's
 * Wallet · Manual tab and returned decrypted by useListVaultEntries) with a
 * one-tap Copy per code, plus a "Copy all" for the whole set.
 */
import { useState } from "react";
import { HardDrive, Shield, ArrowLeft, Copy, Check, Loader2 } from "lucide-react";
import { useListVaultEntries } from "@workspace/api-client-react";
import { VaultSectionPage, VaultSectionEmptyState } from "@/components/layout/vault-sidebar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type EntryAny = any;

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(value); } catch { /* clipboard unavailable */ }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground/60 hover:text-primary transition-colors flex-shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {label && <span className={copied ? "text-emerald-400" : ""}>{copied ? "Copied" : label}</span>}
    </button>
  );
}

export function EntityBackupDetail({ entity, onBack }: { entity: EntryAny; onBack?: () => void }) {
  const codes: string[] = Array.isArray(entity.backupCodes) ? entity.backupCodes : [];

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
      )}

      <div className="flex items-center gap-2.5">
        <Shield className="w-4 h-4 text-primary/70 flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold truncate">{entity.projectName || `Entity #${entity.id}`}</p>
          <p className="font-mono text-[9px] text-muted-foreground/50">
            {entity.category}{entity.entitySerial ? ` · ${entity.entitySerial}` : ""}
          </p>
        </div>
      </div>

      {codes.length === 0 ? (
        <VaultSectionEmptyState
          icon={HardDrive}
          title="No backup codes stored for this entity"
          note="Add backup codes from the entity's Wallet · Manual tab in the Vault Entity list."
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">
              {codes.length} backup code{codes.length !== 1 ? "s" : ""}
            </p>
            <CopyButton value={codes.join("\n")} label="Copy all" />
          </div>
          <div className="border border-border/30 rounded-lg divide-y divide-border/20 overflow-hidden">
            {codes.map((code, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 bg-card">
                <span className="font-mono text-xs text-foreground/80 truncate">{code}</span>
                <CopyButton value={code} label="Copy" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function VaultBackup() {
  const { data, isLoading } = useListVaultEntries();
  const entries: EntryAny[] = (data as EntryAny[] | undefined) ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = entries.find(e => e.id === selectedId) ?? null;

  return (
    <VaultSectionPage title="Backup" description="Backup-code recovery" icon={HardDrive}>
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-primary animate-spin" /></div>
      ) : selected ? (
        <EntityBackupDetail entity={selected} onBack={() => setSelectedId(null)} />
      ) : entries.length === 0 ? (
        <VaultSectionEmptyState
          icon={HardDrive}
          title="No entities in Vault yet"
          note="Once entities are added to Vault, their backup codes will be recoverable here."
        />
      ) : (
        <div className="space-y-2">
          {entries.map(e => {
            const count = Array.isArray(e.backupCodes) ? e.backupCodes.length : 0;
            return (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className="w-full flex items-center gap-3 bg-card border border-card-border rounded-lg p-3 text-left hover:border-primary/40 transition-colors"
              >
                <Shield className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-bold truncate">{e.projectName || `Entity #${e.id}`}</p>
                  <p className="font-mono text-[9px] text-muted-foreground/50 truncate">
                    {e.category}{e.entitySerial ? ` · ${e.entitySerial}` : ""}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono text-[9px] flex-shrink-0",
                    count > 0 ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/5" : "text-muted-foreground/40 border-border/30"
                  )}
                >
                  {count} code{count !== 1 ? "s" : ""}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </VaultSectionPage>
  );
}
