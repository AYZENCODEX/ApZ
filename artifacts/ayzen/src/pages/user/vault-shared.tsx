/**
 * vault-shared.tsx
 * ─────────────────────────────────────────────
 * Phase 6 — Shared tab.
 *
 * Lists vault entities *this user has shared out* (GET /api/vault-shares/sent,
 * scoped to entityType "entity" — the same vault_shares table and endpoints
 * ManageSharesDialog already uses) and gives each one a working
 * Configure-Permission control (read-only vs full access) plus an
 * active/inactive toggle and a way to revoke the share entirely.
 */
import { useState, useEffect, useCallback } from "react";
import { Share2, Loader2, Trash2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { VaultSectionPage, VaultSectionEmptyState } from "@/components/layout/vault-sidebar";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface SharedEntity {
  id: number;
  entityType: string;
  entityId: number;
  entityLabel: string;
  sharedWithUserId: number;
  sharedWithUsername: string;
  permission: "view" | "edit";
  isActive: boolean;
  createdAt: string;
}

export default function VaultShared() {
  const [shares, setShares] = useState<SharedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await customFetch<SharedEntity[]>("/api/vault-shares/sent?entityType=entity");
      setShares(Array.isArray(data) ? data : []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load shared entities" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const updatePermission = async (share: SharedEntity, permission: "view" | "edit") => {
    if (permission === share.permission) return;
    const prevPermission = share.permission;
    setBusyId(share.id);
    setShares(prev => prev.map(s => s.id === share.id ? { ...s, permission } : s));
    try {
      await customFetch(`/api/vault-shares/${share.id}`, { method: "PATCH", body: JSON.stringify({ permission }) });
      toast({
        title: "Permission updated",
        description: `${share.sharedWithUsername} — ${permission === "edit" ? "Full access" : "Read-only"}`,
      });
    } catch {
      setShares(prev => prev.map(s => s.id === share.id ? { ...s, permission: prevPermission } : s));
      toast({ variant: "destructive", title: "Failed to update permission" });
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (share: SharedEntity, next: boolean) => {
    setBusyId(share.id);
    setShares(prev => prev.map(s => s.id === share.id ? { ...s, isActive: next } : s));
    try {
      await customFetch(`/api/vault-shares/${share.id}`, { method: "PATCH", body: JSON.stringify({ isActive: next }) });
      toast({ title: next ? "Access turned on" : "Access turned off", description: share.entityLabel });
    } catch {
      setShares(prev => prev.map(s => s.id === share.id ? { ...s, isActive: !next } : s));
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setBusyId(null);
    }
  };

  const removeShare = async (share: SharedEntity) => {
    setBusyId(share.id);
    try {
      await customFetch(`/api/vault-shares/${share.id}`, { method: "DELETE" });
      setShares(prev => prev.filter(s => s.id !== share.id));
      toast({ title: "Share removed", description: share.entityLabel });
    } catch {
      toast({ variant: "destructive", title: "Failed to remove share" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <VaultSectionPage title="Shared" description="Sharing & permissions" icon={Share2}>
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-primary animate-spin" /></div>
      ) : shares.length === 0 ? (
        <VaultSectionEmptyState
          icon={Share2}
          title="Nothing shared yet"
          note="Entities you share from the Vault entity list will appear here with their permission settings."
        />
      ) : (
        <div className="space-y-2">
          {shares.map(s => (
            <div key={s.id} className="bg-card border border-card-border rounded-lg p-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-bold truncate">{s.entityLabel}</p>
                <p className="font-mono text-[9px] text-muted-foreground/50 truncate">
                  shared with <span className="text-foreground/70">{s.sharedWithUsername}</span>
                </p>
              </div>

              <Select
                value={s.permission}
                onValueChange={(v: "view" | "edit") => updatePermission(s, v)}
                disabled={busyId === s.id}
              >
                <SelectTrigger className="font-mono text-[10px] h-8 w-[120px] flex-shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view" className="font-mono text-xs">Read-only</SelectItem>
                  <SelectItem value="edit" className="font-mono text-xs">Full access</SelectItem>
                </SelectContent>
              </Select>

              <Switch
                checked={s.isActive}
                disabled={busyId === s.id}
                onCheckedChange={(v) => toggleActive(s, v)}
              />

              <button
                onClick={() => removeShare(s)}
                disabled={busyId === s.id}
                className="p-1 rounded text-muted-foreground/30 hover:text-red-400 transition-colors flex-shrink-0"
                title="Remove share"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </VaultSectionPage>
  );
}
