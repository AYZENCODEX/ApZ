import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ChevronLeft, Shield, ShieldCheck, Loader2, KeyRound,
  Edit2, Trash2, Eye, EyeOff, Copy, Check, Ban, ShieldOff, AlertTriangle,
  User, Mail, Calendar, Building2, Phone, MapPin, Wifi, CreditCard,
  CheckCircle2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import type { KycEntry } from "@/components/kyc-entries";

const TABS = [
  { id: "credentials", label: "Credentials" },
  { id: "kyc",         label: "KYC Info" },
  { id: "purchase",    label: "Purchase" },
] as const;
type KycDetailTab = typeof TABS[number]["id"];

function calcAge(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}yr`;
}

function SecretField({ label, value }: { label: string; value: string | null | undefined }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/20 last:border-0 group">
      <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider w-24 flex-shrink-0">{label}</span>
      <span className={cn("flex-1 font-mono text-xs truncate", shown ? "text-foreground/90" : "text-muted-foreground/40 select-none")}>
        {shown ? value : "•".repeat(Math.min(value.length, 16))}
      </span>
      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setShown(s => !s)} className="p-1 rounded text-muted-foreground/40 hover:text-primary transition-colors">
          {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        <button onClick={copy} className={cn("p-1 rounded transition-colors", copied ? "text-emerald-400" : "text-muted-foreground/40 hover:text-primary")}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
      <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">{label}</span>
      <span className="font-mono text-xs text-foreground/80 max-w-[200px] truncate text-right">{value}</span>
    </div>
  );
}

export default function VaultKycDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [entry, setEntry] = useState<KycEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<KycDetailTab>("credentials");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [banPending, setBanPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Try individual endpoint first, fall back to list filter
      try {
        const single = await customFetch<KycEntry>(`/api/kyc-entries/${params.id}`);
        setEntry(single);
        return;
      } catch {}
      const list = await customFetch<KycEntry[]>("/api/kyc-entries");
      const found = (Array.isArray(list) ? list : []).find(e => String(e.id) === params.id);
      setEntry(found ?? null);
    } catch {
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!entry) return;
    setDeleting(true);
    try {
      await customFetch<unknown>(`/api/kyc-entries/${entry.id}`, { method: "DELETE" });
      toast({ title: "KYC entity deleted" });
      navigate("/vault?tab=kyc");
    } catch {
      toast({ variant: "destructive", title: "Delete failed" });
    } finally { setDeleting(false); setConfirmDelete(false); }
  };

  const handleToggleBan = async () => {
    if (!entry) return;
    setBanPending(true);
    const nextStatus = entry.status === "banned" ? "active" : "banned";
    try {
      await customFetch<unknown>(`/api/kyc-entries/${entry.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      toast({ title: nextStatus === "banned" ? "KYC entity banned" : "KYC entity unbanned" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update status" });
    } finally { setBanPending(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/vault?tab=kyc")} className="font-mono text-xs gap-1.5">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to Vault
        </Button>
        <div className="text-center py-20">
          <ShieldCheck className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="font-mono text-sm text-muted-foreground/60">KYC entity not found</p>
        </div>
      </div>
    );
  }

  const displayName = entry.name || entry.username || `KYC #${entry.id}`;
  const isBanned = entry.status === "banned";

  return (
    <div className="space-y-5 page-enter max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/vault?tab=kyc")} className="font-mono text-xs gap-1.5 mb-3 -ml-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to Vault
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-mono tracking-tighter">{displayName}</h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="font-mono text-[9px] px-1.5">{entry.category}</Badge>
                {entry.platform && <span className="font-mono text-[10px] text-muted-foreground/50">{entry.platform}</span>}
                {isBanned && <Badge variant="outline" className="font-mono text-[9px] px-1.5 border-red-400/30 text-red-400 bg-red-400/5">Banned</Badge>}
              </div>
            </div>
          </div>
          {/* Action buttons — Access at top */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setAccessOpen(true)} className="font-mono text-xs gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> Access
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleBan}
              disabled={banPending}
              className={cn("font-mono text-xs gap-1.5", isBanned
                ? "text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                : "text-red-400 border-red-400/30 hover:bg-red-400/10"
              )}
            >
              {banPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isBanned ? <ShieldOff className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
              {isBanned ? "Unban" : "Ban"}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} className="font-mono text-xs gap-1.5">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-muted/20 rounded-lg overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 py-1.5 rounded-md font-mono text-[10px] uppercase tracking-wider transition-all flex-shrink-0",
              tab === t.id ? "bg-card text-primary shadow-sm font-bold" : "text-muted-foreground/50 hover:text-muted-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Credentials Tab */}
      {tab === "credentials" && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 font-mono text-xs font-bold uppercase tracking-widest text-cyan-400">
            Credentials
          </div>
          <div className="px-4 py-2">
            <SecretField label="Username" value={entry.username} />
            <SecretField label="Email" value={entry.email} />
            <SecretField label="Password" value={entry.account_password} />
            <SecretField label="Email Pass" value={entry.email_password} />
            <SecretField label="2FA Secret" value={entry.email_2fa} />
            <SecretField label="Backup Code" value={entry.email_backup_code} />
            {!entry.username && !entry.email && !entry.account_password && (
              <p className="font-mono text-xs text-muted-foreground/40 py-4 text-center">No credentials stored</p>
            )}
          </div>
          {entry.notes && (
            <div className="px-4 pb-4 border-t border-border/20 mt-2">
              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50 mb-2 mt-3">Notes</p>
              <p className="font-mono text-xs text-muted-foreground leading-relaxed bg-muted/20 rounded-lg px-3 py-2 border border-border/30">
                {entry.notes}
              </p>
            </div>
          )}
        </div>
      )}

      {/* KYC Info Tab */}
      {tab === "kyc" && (
        <div className="space-y-4">
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border/30 font-mono text-xs font-bold uppercase tracking-widest text-primary">
              Identity
            </div>
            <div className="px-4 py-2">
              <InfoRow label="Full Name" value={entry.name} />
              <InfoRow label="Father Name" value={entry.father_name} />
              <InfoRow label="NID Number" value={entry.nid_number} />
              <InfoRow label="Birth Date" value={entry.birth_date ? new Date(entry.birth_date).toLocaleDateString() : null} />
              <InfoRow label="Location" value={entry.location} />
              <InfoRow label="Contact" value={entry.contact_number} />
              <InfoRow label="Social" value={entry.social_account} />
              {!entry.name && !entry.nid_number && (
                <p className="font-mono text-xs text-muted-foreground/40 py-4 text-center">No KYC info recorded</p>
              )}
            </div>
          </div>

          {/* Photos */}
          {(entry.photo1_url || entry.photo2_url) && (
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
                Photos
              </div>
              <div className="p-4 flex gap-3">
                {entry.photo1_url && (
                  <a href={entry.photo1_url} target="_blank" rel="noopener noreferrer" className="relative group">
                    <img src={entry.photo1_url} alt="ID Photo 1" className="w-24 h-24 object-cover rounded-lg border border-border/40 group-hover:border-primary/40 transition-colors" />
                    <p className="font-mono text-[9px] text-muted-foreground/50 mt-1 text-center">Photo 1</p>
                  </a>
                )}
                {entry.photo2_url && (
                  <a href={entry.photo2_url} target="_blank" rel="noopener noreferrer" className="relative group">
                    <img src={entry.photo2_url} alt="ID Photo 2" className="w-24 h-24 object-cover rounded-lg border border-border/40 group-hover:border-primary/40 transition-colors" />
                    <p className="font-mono text-[9px] text-muted-foreground/50 mt-1 text-center">Photo 2</p>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Purchase Tab */}
      {tab === "purchase" && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 font-mono text-xs font-bold uppercase tracking-widest text-amber-400">
            Purchase Info
          </div>
          <div className="px-4 py-2">
            <InfoRow label="Platform" value={entry.platform} />
            <InfoRow label="Buy Price" value={entry.buy_price != null ? `$${Number(entry.buy_price).toFixed(2)}` : null} />
            <InfoRow label="Buy Date" value={entry.buy_date ? new Date(entry.buy_date).toLocaleDateString() : null} />
            <InfoRow label="Seller" value={entry.seller_name} />
            <InfoRow label="Connection" value={entry.connection} />
            <div className="flex items-center justify-between py-2 border-b border-border/20">
              <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">Payment</span>
              <div className={cn("flex items-center gap-1 font-mono text-xs font-bold", entry.paid ? "text-emerald-400" : "text-red-400")}>
                {entry.paid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {entry.paid ? "Paid" : "Unpaid"}
              </div>
            </div>
            <InfoRow label="Created" value={new Date(entry.created_at).toLocaleDateString()} />
            {!entry.buy_price && !entry.seller_name && !entry.buy_date && (
              <p className="font-mono text-xs text-muted-foreground/40 py-4 text-center">No purchase info recorded</p>
            )}
          </div>
        </div>
      )}

      {/* Access Dialog — quick credential reveal */}
      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" /> Quick Access
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <SecretField label="Email" value={entry.email} />
            <SecretField label="Password" value={entry.account_password} />
            <SecretField label="2FA" value={entry.email_2fa} />
            <SecretField label="Backup" value={entry.email_backup_code} />
            {!entry.email && !entry.account_password && !entry.email_2fa && (
              <p className="font-mono text-xs text-muted-foreground/40 text-center py-2">No credentials to show</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Delete KYC Entity?
            </DialogTitle>
          </DialogHeader>
          <p className="font-mono text-xs text-muted-foreground py-2">All data for this KYC entity will be permanently deleted. This cannot be undone.</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} className="font-mono text-xs">Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting} className="font-mono text-xs gap-1.5">
              {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
