/**
 * vault-enrollment-linked.tsx
 * ─────────────────────────────────────────────
 * Enrollment → Linked: shows all vault entity links (alt accounts, shared
 * wallets, shared IPs, etc.) as a networked entity list. Clicking an entity
 * opens its detail page; a visual relationship map is shown per entity pair.
 */
import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Link2, Loader2, Shield, ChevronRight, GitFork, Wallet, Mail, Cpu, Monitor, User2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { VaultSectionPage, VaultSectionEmptyState } from "@/components/layout/vault-sidebar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AllLink {
  id: number;
  entity_id: number;
  linked_entity_id: number;
  relation_type: string;
  note: string | null;
  entity_name: string;
  entity_category: string;
  entity_serial: string | null;
  linked_entity_name: string;
  linked_entity_category: string;
  linked_entity_serial: string | null;
  created_at: string;
}

const RELATION_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  alt_of:        { label: "Alt of",        icon: GitFork,  color: "text-violet-400" },
  main_of:       { label: "Main of",       icon: GitFork,  color: "text-cyan-400" },
  shares_wallet: { label: "Shares Wallet", icon: Wallet,   color: "text-amber-400" },
  shares_email:  { label: "Shares Email",  icon: Mail,     color: "text-emerald-400" },
  shares_ip:     { label: "Shares IP",     icon: Cpu,      color: "text-orange-400" },
  shares_device: { label: "Shares Device", icon: Monitor,  color: "text-blue-400" },
  same_owner:    { label: "Same Owner",    icon: User2,    color: "text-pink-400" },
  other:         { label: "Linked",        icon: Link2,    color: "text-muted-foreground" },
};

// Visual mini-graph showing entity A — [relation] — entity B
function RelationshipMap({ link }: { link: AllLink }) {
  const meta = RELATION_META[link.relation_type] ?? RELATION_META.other;
  const Icon = meta.icon;

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/10 rounded-lg border border-border/20">
      {/* Entity A */}
      <div className="flex flex-col items-center gap-0.5 min-w-0 flex-1">
        <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Shield className="w-3.5 h-3.5 text-primary/70" />
        </div>
        <p className="font-mono text-[9px] text-foreground/80 truncate max-w-[80px] text-center leading-tight">
          {link.entity_name}
        </p>
        <span className="font-mono text-[8px] text-muted-foreground/40">{link.entity_category}</span>
      </div>

      {/* Relation connector */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
        <div className="flex items-center gap-0.5">
          <div className="h-px w-4 bg-border/40" />
          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center border", `border-${meta.color.replace("text-", "")}/20 bg-${meta.color.replace("text-", "")}/10`)}>
            <Icon className={cn("w-3 h-3", meta.color)} />
          </div>
          <div className="h-px w-4 bg-border/40" />
        </div>
        <span className={cn("font-mono text-[8px] font-bold", meta.color)}>{meta.label}</span>
      </div>

      {/* Entity B */}
      <div className="flex flex-col items-center gap-0.5 min-w-0 flex-1">
        <div className="w-7 h-7 rounded-lg bg-muted/30 border border-border/30 flex items-center justify-center">
          <Shield className="w-3.5 h-3.5 text-muted-foreground/50" />
        </div>
        <p className="font-mono text-[9px] text-foreground/80 truncate max-w-[80px] text-center leading-tight">
          {link.linked_entity_name}
        </p>
        <span className="font-mono text-[8px] text-muted-foreground/40">{link.linked_entity_category}</span>
      </div>
    </div>
  );
}

export default function VaultEnrollmentLinked() {
  const [, navigate] = useLocation();
  const [links, setLinks] = useState<AllLink[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await customFetch<AllLink[]>("/api/vault/links/all");
      setLinks(Array.isArray(rows) ? rows : []);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  // Group links by entity_id (the "from" side) so each entity shows its
  // full relationship cluster — clicking opens the entity detail.
  const grouped = new Map<number, { name: string; category: string; links: AllLink[] }>();
  for (const link of links) {
    if (!grouped.has(link.entity_id)) {
      grouped.set(link.entity_id, { name: link.entity_name, category: link.entity_category, links: [] });
    }
    grouped.get(link.entity_id)!.links.push(link);
  }

  return (
    <VaultSectionPage
      title="Linked"
      description="Networked entity relationships — shared wallets, alts, and more"
      icon={Link2}
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
      ) : grouped.size === 0 ? (
        <VaultSectionEmptyState
          icon={Link2}
          title="No linked entities"
          note="Link entities from an entity's detail page — mark alts, shared wallets, shared IPs, and more."
        />
      ) : (
        <div className="space-y-3">
          {[...grouped.entries()].map(([entityId, { name, category, links: eLinks }]) => (
            <div key={entityId} className="bg-card border border-card-border rounded-xl overflow-hidden">
              {/* Entity header — click to navigate to detail */}
              <button
                onClick={() => navigate(`/vault/entity/${entityId}`)}
                className="w-full flex items-center gap-3 p-3.5 hover:bg-muted/10 transition-colors text-left group border-b border-border/30"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                    {name}
                  </p>
                  <p className="font-mono text-[9px] text-muted-foreground/50">{category}</p>
                </div>
                <Badge variant="outline" className="font-mono text-[9px] text-primary/70 border-primary/20 bg-primary/5 flex-shrink-0">
                  {eLinks.length} link{eLinks.length === 1 ? "" : "s"}
                </Badge>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-primary/40 flex-shrink-0 transition-colors" />
              </button>

              {/* Relationship maps */}
              <div className="p-3 space-y-2">
                {eLinks.map(link => (
                  <div key={link.id} className="space-y-1.5">
                    <RelationshipMap link={link} />
                    {link.note && (
                      <p className="font-mono text-[9px] text-muted-foreground/50 px-1">{link.note}</p>
                    )}
                    {/* Linked entity — also clickable */}
                    <button
                      onClick={() => navigate(`/vault/entity/${link.linked_entity_id}`)}
                      className="flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground/40 hover:text-primary transition-colors px-1"
                    >
                      <Shield className="w-2.5 h-2.5" />
                      Open {link.linked_entity_name} →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </VaultSectionPage>
  );
}
