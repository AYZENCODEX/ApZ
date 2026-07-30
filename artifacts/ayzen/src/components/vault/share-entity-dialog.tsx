import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Share2, Loader2, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";

export type VaultEntityType = "local" | "entity" | "kyc" | "game";

export interface ShareTarget {
  entityType: VaultEntityType;
  entityId: number;
}

/**
 * Create-a-share dialog. Pass a single item via `items={[{ entityType, entityId }]}`
 * or many for a bulk share (same or mixed types) — the same dialog drives both.
 * Ownership of the underlying item never changes; this only grants another
 * user access, which the owner can turn off later from ManageSharesDialog.
 */
export function ShareEntityDialog({
  open, onClose, items, entityLabel, onShared,
}: {
  open: boolean;
  onClose: () => void;
  items: ShareTarget[];
  /** Optional human label shown in the dialog, e.g. an account name — only used for single-item shares. */
  entityLabel?: string;
  onShared?: () => void;
}) {
  const [username, setUsername] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isBulk = items.length > 1;

  const reset = () => { setUsername(""); setPermission("view"); };

  const submit = async () => {
    if (!username.trim()) { toast({ variant: "destructive", title: "Enter a username or email to share with" }); return; }
    if (!items.length) return;
    setSaving(true);
    try {
      if (isBulk) {
        const data = await customFetch<{ sharedCount: number; failedCount: number; failed: { reason: string }[] }>(
          "/api/vault-shares/bulk",
          { method: "POST", body: JSON.stringify({ items, username: username.trim(), permission }) }
        );
        if (data.sharedCount > 0) {
          toast({
            title: `Shared ${data.sharedCount} item${data.sharedCount === 1 ? "" : "s"}`,
            description: data.failedCount ? `${data.failedCount} item(s) couldn't be shared.` : undefined,
          });
        } else {
          toast({ variant: "destructive", title: "Nothing was shared", description: data.failed?.[0]?.reason });
        }
      } else {
        await customFetch("/api/vault-shares", {
          method: "POST",
          body: JSON.stringify({ entityType: items[0].entityType, entityId: items[0].entityId, username: username.trim(), permission }),
        });
        toast({ title: "Shared", description: `${entityLabel ?? "This item"} is now shared with ${username.trim()}.` });
      }
      reset();
      onShared?.();
      onClose();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to share", description: err?.data?.error ?? err?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" />
            {isBulk ? `Share ${items.length} Items` : "Share Item"}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            {isBulk
              ? "Grant another user access to the selected items. Ownership stays with you."
              : `Grant another user access to ${entityLabel ?? "this item"}. Ownership stays with you.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">Share with (username or email)</Label>
            <div className="relative">
              <User className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
              <Input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. teammate01"
                className="pl-8 font-mono text-xs"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">Access level</Label>
            <Select value={permission} onValueChange={(v: any) => setPermission(v)}>
              <SelectTrigger className="font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view" className="font-mono text-xs">View only</SelectItem>
                <SelectItem value="edit" className="font-mono text-xs">Can edit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="font-mono text-xs">Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving} className="font-mono text-xs gap-1.5">
            {saving && <Loader2 className="w-3 h-3 animate-spin" />} Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
