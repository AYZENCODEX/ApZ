import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function ValuePnlPanel({ compact = false, metric = "value", title = "Value P&L" }: { compact?: boolean; metric?: "value" | "follower"; title?: string }) {
  const [period, setPeriod] = useState<7 | 14 | 28>(7);
  const [data, setData] = useState<any>({ items: [], totalPnl: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/api/value-history/pnl?period=${period}&metric=${metric}`, { headers: { Authorization: `Bearer ${localStorage.getItem("ayzen_token") ?? ""}` } })
      .then(r => r.ok ? r.json() : { items: [], totalPnl: 0 })
      .then(setData)
      .catch(() => setData({ items: [], totalPnl: 0 }))
      .finally(() => setLoading(false));
  }, [period, metric]);
  const positive = Number(data.totalPnl ?? 0) >= 0;
  const fmt = (n: number) => metric === "follower" ? Math.round(n).toString() : `$${n.toFixed(2)}`;
  return (
    <div className={cn("bg-card border border-card-border rounded-xl p-4 space-y-3", compact && "p-3")}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">{title}</p>
          <p className={cn("font-mono text-xl font-bold", positive ? "text-emerald-400" : "text-red-400")}>{positive ? "+" : ""}{fmt(Number(data.totalPnl ?? 0))}</p>
        </div>
        <div className="flex gap-1">
          {[7, 14, 28].map(days => <button key={days} onClick={() => setPeriod(days as 7 | 14 | 28)} className={cn("px-2 py-1 rounded border font-mono text-[9px]", period === days ? "border-primary/40 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground/50")}>{days}d</button>)}
        </div>
      </div>
      {loading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : data.items?.length ? (
        <div className="space-y-1.5">
          {data.items.slice(0, compact ? 4 : 10).map((item: any, i: number) => (
            <div key={`${item.sourceType}-${item.sourceId}-${item.target}-${i}`} className="flex items-center gap-2 font-mono text-[10px]">
              {Number(item.pnl) >= 0 ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />}
              <span className="flex-1 truncate text-muted-foreground/70">{item.label ?? item.target}</span>
              <span className={Number(item.pnl) >= 0 ? "text-emerald-400" : "text-red-400"}>{Number(item.pnl) >= 0 ? "+" : ""}{fmt(Number(item.pnl))}</span>
            </div>
          ))}
        </div>
      ) : <p className="font-mono text-[10px] text-muted-foreground/40">{metric === "follower" ? "Add follower counts to begin tracking." : "Add values to begin tracking P&L."}</p>}
    </div>
  );
}