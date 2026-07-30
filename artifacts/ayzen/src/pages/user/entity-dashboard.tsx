// entity-dashboard.tsx
// ─────────────────────────────────────────────
// Phase 10B — Enroll: entity dedicated dashboard
//
// Each entity in the Phase 10A list (pages/user/enroll-entities.tsx,
// OthersEntitiesTab via its onSelect prop) is clickable and opens here — its
// own deep-linkable URL (/enroll/entities/:id), mirroring Phase 9B's
// project-dashboard.tsx pattern for projects. Unlike project-dashboard.tsx,
// there's no separate stats panel to build here: the header just identifies
// the entity, and the body is entirely components/entity-dashboard-tabs.tsx
// (EntityDashboardTabs) scoped to this vaultEntryId — the same component
// vault-entity-detail.tsx already uses for its "Dashboard" tab. Zero
// duplicate dashboard code.
import { useParams, useLocation } from "wouter";
import { useListVaultEntries } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Loader2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import EntityDashboardTabs from "@/components/entity-dashboard-tabs";

type EntryAny = any;

const CATEGORY_COLORS: Record<string, string> = {
  DeFi:   "text-cyan-400 border-cyan-400/20 bg-cyan-400/5",
  NFT:    "text-purple-400 border-purple-400/20 bg-purple-400/5",
  GameFi: "text-emerald-400 border-emerald-400/20 bg-emerald-400/5",
  Layer2: "text-blue-400 border-blue-400/20 bg-blue-400/5",
  Testnet:"text-orange-400 border-orange-400/20 bg-orange-400/5",
  CEX:    "text-amber-400 border-amber-400/20 bg-amber-400/5",
  Social: "text-pink-400 border-pink-400/20 bg-pink-400/5",
  Other:  "text-muted-foreground border-border bg-muted/20",
};

export default function EntityDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const vaultEntryId = Number(id);
  const [, navigate] = useLocation();
  const { data, isLoading } = useListVaultEntries();

  const entries: EntryAny[] = (data as EntryAny[] | undefined) ?? [];
  const entry = entries.find(e => String(e.id) === String(id));

  return (
    <div className="space-y-5 page-enter">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/enroll/entities")} className="font-mono text-xs gap-1.5 mb-3 -ml-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to Entities
        </Button>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Shield className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold font-mono tracking-tighter truncate">
              {isLoading ? "Loading..." : entry?.projectName ?? `Entity #${vaultEntryId}`}
            </h1>
            {entry?.category && (
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className={cn("font-mono text-[9px] uppercase tracking-wider px-1.5", CATEGORY_COLORS[entry.category] ?? CATEGORY_COLORS["Other"])}>
                  {entry.category}
                </Badge>
                {entry.entitySerial && (
                  <span className="font-mono text-[10px] text-muted-foreground/50">{entry.entitySerial}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-primary animate-spin" /></div>
      ) : (
        <EntityDashboardTabs vaultEntryId={vaultEntryId} />
      )}
    </div>
  );
}
