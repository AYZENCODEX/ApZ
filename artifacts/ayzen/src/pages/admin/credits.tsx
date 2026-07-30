import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Coins, Check, X, Loader2, RefreshCw, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const METHOD_ICONS: Record<string, string> = { bkash: "💳", nagad: "📱", binance_usdt: "₮" };
const METHOD_LABELS: Record<string, string> = { bkash: "bKash", nagad: "Naggad", binance_usdt: "Binance USDT" };

interface PendingTx {
  id: number;
  userId: number;
  type: string;
  method: string | null;
  credits: number;
  amountBDT: number | null;
  amountUSDT: number | null;
  referenceId: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}

export default function AdminCreditsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/credits`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setPending(await r.json());
    } catch { }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const handleApprove = async (id: number) => {
    setProcessing(id);
    try {
      const r = await fetch(`${BASE}/api/admin/credits/${id}/approve`, {
        method: "POST", headers, body: JSON.stringify({ note: notes[id] }),
      });
      if (r.ok) {
        toast({ title: "✅ Credits approved & added to user" });
        await fetchPending();
      } else {
        const d = await r.json();
        toast({ variant: "destructive", title: d.error ?? "Failed to approve" });
      }
    } catch { toast({ variant: "destructive", title: "Connection error" }); }
    setProcessing(null);
  };

  const handleReject = async (id: number) => {
    setProcessing(id);
    try {
      const r = await fetch(`${BASE}/api/admin/credits/${id}/reject`, {
        method: "POST", headers, body: JSON.stringify({ note: notes[id] ?? "Rejected" }),
      });
      if (r.ok) {
        toast({ title: "Transaction rejected" });
        await fetchPending();
      }
    } catch { toast({ variant: "destructive", title: "Connection error" }); }
    setProcessing(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tighter uppercase flex items-center gap-2">
            <Coins className="w-6 h-6 text-primary" /> Credit Approvals
          </h1>
          <p className="text-muted-foreground font-mono text-xs mt-1">
            {pending.length} pending verification{pending.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchPending} disabled={loading} className="font-mono text-xs gap-2">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="bg-card border border-card-border rounded-lg h-28 animate-pulse" />)}
        </div>
      ) : pending.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg px-6 py-12 text-center">
          <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-mono text-sm text-muted-foreground">No pending approvals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(tx => (
            <div key={tx.id} className="bg-card border border-amber-400/20 rounded-lg overflow-hidden">
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl mt-0.5">{tx.method ? (METHOD_ICONS[tx.method] ?? "⚙️") : "⚙️"}</span>
                    <div>
                      <div className="font-mono font-bold text-sm text-foreground flex items-center gap-2">
                        User #{tx.userId}
                        <Badge className="font-mono text-[8px] px-1.5 py-0 bg-amber-400/10 text-amber-400 border-amber-400/30">
                          PENDING
                        </Badge>
                      </div>
                      <div className="font-mono text-xs text-muted-foreground mt-0.5">
                        {tx.method ? METHOD_LABELS[tx.method] : "System"} · {tx.credits.toLocaleString()} credits
                      </div>
                      {tx.amountBDT && <div className="font-mono text-xs text-primary mt-0.5">৳ {tx.amountBDT} BDT</div>}
                      {tx.amountUSDT && <div className="font-mono text-xs text-primary mt-0.5">${tx.amountUSDT} USDT</div>}
                      {tx.referenceId && (
                        <div className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">
                          TrxID: {tx.referenceId}
                        </div>
                      )}
                      {tx.notes && (
                        <div className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">{tx.notes}</div>
                      )}
                      <div className="font-mono text-[9px] text-muted-foreground/40 mt-1">
                        {new Date(tx.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(tx.id)}
                      disabled={processing === tx.id}
                      className="font-mono text-[10px] gap-1.5 h-8 px-3 bg-emerald-500 hover:bg-emerald-500/90 text-white"
                    >
                      {processing === tx.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReject(tx.id)}
                      disabled={processing === tx.id}
                      className="font-mono text-[10px] gap-1.5 h-8 px-3 border-red-500/20 text-red-400 hover:bg-red-500/10"
                    >
                      <X className="w-3 h-3" /> Reject
                    </Button>
                  </div>
                </div>

                <div className="mt-3">
                  <Input
                    placeholder="Admin note (optional)"
                    value={notes[tx.id] ?? ""}
                    onChange={e => setNotes(n => ({ ...n, [tx.id]: e.target.value }))}
                    className="font-mono text-xs h-8 bg-input border-border"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
