/**
 * vault-enroll.tsx
 * ─────────────────────────────────────────────
 * Phase 4 — Vault Sidebar Restructure
 * Phase 6 — real data lands here.
 *
 * Shows every entity in Vault plus whether it's enrolled into at least one
 * project (GET /api/projects/entity-leaderboard, which already rolls up
 * project_enrollments per vaultEntryId for the current user). This is the
 * same "Enrolled" status mirrored onto the Others tab on the Projects side
 * (pages/user/project-entities.tsx) — the two views read the same
 * entity-leaderboard data so the badge always matches.
 */
import { useEffect, useState, useCallback } from "react";
import { UserPlus, Shield, Loader2 } from "lucide-react";
import { useListVaultEntries, customFetch } from "@workspace/api-client-react";
import { VaultSectionPage, VaultSectionEmptyState } from "@/components/layout/vault-sidebar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type EntryAny = any;

interface LeaderboardRow {
  vaultEntryId: number;
  totalProjects: number;
}

export default function VaultEnroll() {
  const { data, isLoading } = useListVaultEntries();
  const entries: EntryAny[] = (data as EntryAny[] | undefined) ?? [];
  const [enrolledCounts, setEnrolledCounts] = useState<Record<number, number>>({});
  const [lbLoading, setLbLoading] = useState(true);

  const loadLeaderboard = useCallback(async () => {
    setLbLoading(true);
    try {
      const rows = await customFetch<LeaderboardRow[]>("/api/projects/entity-leaderboard");
      const map: Record<number, number> = {};
      for (const r of Array.isArray(rows) ? rows : []) map[r.vaultEntryId] = r.totalProjects;
      setEnrolledCounts(map);
    } catch {
      setEnrolledCounts({});
    } finally {
      setLbLoading(false);
    }
  }, []);

  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);

  const loading = isLoading || lbLoading;

  return (
    <VaultSectionPage
      title="Enroll"
      description="Entities enrolled into Vault"
      icon={UserPlus}
    >
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 text-primary animate-spin" /></div>
      ) : entries.length === 0 ? (
        <VaultSectionEmptyState
          icon={UserPlus}
          title="No entities yet"
          note="Once entities are added to Vault, their enrolled status will show up here — and be reflected under the Others tab on the Projects side."
        />
      ) : (
        <div className="space-y-2">
          {entries.map(e => {
            const enrolledCount = enrolledCounts[e.id] ?? 0;
            const enrolled = enrolledCount > 0;
            return (
              <div key={e.id} className="bg-card border border-card-border rounded-lg p-3 flex items-center gap-3">
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
                    enrolled ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/5" : "text-muted-foreground/40 border-border/30"
                  )}
                >
                  {enrolled ? `Enrolled · ${enrolledCount}` : "Not enrolled"}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </VaultSectionPage>
  );
}
