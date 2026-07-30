/**
 * vault-banned.tsx
 * ─────────────────────────────────────────────
 * Vault sidebar → Banned.
 *
 * A single place to see everything currently flagged as banned across the
 * Vault: whole entities, local accounts, and KYC entities (all three use the
 * same `status === "banned"` convention — see routes/vault.ts PATCH
 * /vault/:id, routes/local-accounts.ts PATCH /local-accounts/:id/status,
 * routes/kyc.ts PATCH /kyc-entries/:id/status), plus any individually-banned
 * linked platform account (Twitter/Discord/Telegram/Other) that lives inside
 * an otherwise-active entity.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListVaultEntries, customFetch } from "@workspace/api-client-react";
import { VaultSectionPage, VaultSectionEmptyState } from "@/components/layout/vault-sidebar";
import { Badge } from "@/components/ui/badge";
import { Ban, Shield, User, ShieldCheck, Loader2, ChevronRight, Twitter, MessageCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";

type EntryAny = any;

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">{label}</p>
      <span className="font-mono text-[9px] text-muted-foreground/40">({count})</span>
    </div>
  );
}

function BannedRow({ icon: Icon, title, subtitle, onClick }: { icon: React.ElementType; title: string; subtitle?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 bg-card border border-red-400/20 rounded-lg px-3 py-2.5",
        onClick && "cursor-pointer hover:border-red-400/40 transition-colors"
      )}
    >
      <div className="w-7 h-7 rounded-md bg-red-400/10 border border-red-400/20 flex items-center justify-center flex-shrink-0">
        <Icon className="w-3.5 h-3.5 text-red-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs font-bold text-foreground truncate">{title}</p>
        {subtitle && <p className="font-mono text-[9px] text-muted-foreground/50 truncate">{subtitle}</p>}
      </div>
      <Badge variant="outline" className="font-mono text-[8px] uppercase tracking-wider px-1.5 text-red-400 border-red-400/30 bg-red-400/5 flex-shrink-0">
        Banned
      </Badge>
      {onClick && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />}
    </div>
  );
}

export default function VaultBanned() {
  const [, navigate] = useLocation();
  const { data: vaultData, isLoading: entitiesLoading } = useListVaultEntries();
  const [localAccounts, setLocalAccounts] = useState<EntryAny[]>([]);
  const [kycEntries, setKycEntries] = useState<EntryAny[]>([]);
  const [loadingOthers, setLoadingOthers] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOthers(true);
      try {
        const [local, kyc] = await Promise.all([
          customFetch<EntryAny[]>("/api/local-accounts").catch(() => []),
          customFetch<EntryAny[]>("/api/kyc-entries").catch(() => []),
        ]);
        if (!cancelled) {
          setLocalAccounts(Array.isArray(local) ? local : []);
          setKycEntries(Array.isArray(kyc) ? kyc : []);
        }
      } finally {
        if (!cancelled) setLoadingOthers(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const entities: EntryAny[] = (vaultData as EntryAny[] | undefined) ?? [];
  const bannedEntities = entities.filter(e => e.status === "banned");
  const bannedLocal = localAccounts.filter(a => a.status === "banned");
  const bannedKyc = kycEntries.filter(k => k.status === "banned");

  // Individually-banned platform accounts inside otherwise-active entities.
  type PlatformBan = { entity: EntryAny; platform: "twitter" | "discord" | "telegram"; handle: string };
  const platformBans: PlatformBan[] = [];
  for (const e of entities) {
    if (e.twitterBanned && e.twitterUsername) platformBans.push({ entity: e, platform: "twitter", handle: `@${e.twitterUsername}` });
    if (e.discordBanned && e.discordUsername) platformBans.push({ entity: e, platform: "discord", handle: e.discordUsername });
    if (e.telegramBanned && (e.telegramUsername || e.telegramPhone)) platformBans.push({ entity: e, platform: "telegram", handle: e.telegramUsername ? `@${e.telegramUsername}` : e.telegramPhone });
  }

  type OtherBan = { entity: EntryAny; platform: string };
  const otherBans: OtherBan[] = [];
  for (const e of entities) {
    if (!e.otherAccounts) continue;
    try {
      const others = JSON.parse(e.otherAccounts);
      if (Array.isArray(others)) {
        others.forEach((acc: any) => { if (acc?.banned) otherBans.push({ entity: e, platform: acc.platform || "Other" }); });
      }
    } catch { /* ignore malformed otherAccounts */ }
  }

  const loading = entitiesLoading || loadingOthers;
  const total = bannedEntities.length + bannedLocal.length + bannedKyc.length + platformBans.length + otherBans.length;

  const PLATFORM_ICON: Record<string, React.ElementType> = { twitter: Twitter, discord: MessageCircle, telegram: Send };

  return (
    <VaultSectionPage title="Banned" description="Everything currently flagged as banned across the Vault" icon={Ban}>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
      ) : total === 0 ? (
        <VaultSectionEmptyState
          icon={Ban}
          title="Nothing banned"
          note="Ban an entity, local account, KYC entity, or an individual linked platform account and it'll show up here."
        />
      ) : (
        <div className="space-y-5">
          {bannedEntities.length > 0 && (
            <div className="space-y-2">
              <SectionHeader label="Entities" count={bannedEntities.length} />
              {bannedEntities.map(e => (
                <BannedRow
                  key={`entity-${e.id}`}
                  icon={Shield}
                  title={e.projectName || `Entity #${e.id}`}
                  subtitle={`${e.category}${e.entitySerial ? ` · ${e.entitySerial}` : ""}`}
                  onClick={() => navigate(`/vault/entity/${e.id}`)}
                />
              ))}
            </div>
          )}

          {platformBans.length > 0 && (
            <div className="space-y-2">
              <SectionHeader label="Linked Platform Accounts" count={platformBans.length} />
              {platformBans.map((pb, i) => (
                <BannedRow
                  key={`platform-${pb.entity.id}-${pb.platform}-${i}`}
                  icon={PLATFORM_ICON[pb.platform] ?? Shield}
                  title={`${pb.platform[0].toUpperCase()}${pb.platform.slice(1)} · ${pb.handle}`}
                  subtitle={`On entity: ${pb.entity.projectName || `#${pb.entity.id}`}`}
                  onClick={() => navigate(`/vault/entity/${pb.entity.id}`)}
                />
              ))}
            </div>
          )}

          {otherBans.length > 0 && (
            <div className="space-y-2">
              <SectionHeader label="Other Linked Accounts" count={otherBans.length} />
              {otherBans.map((ob, i) => (
                <BannedRow
                  key={`other-${ob.entity.id}-${i}`}
                  icon={Shield}
                  title={ob.platform}
                  subtitle={`On entity: ${ob.entity.projectName || `#${ob.entity.id}`}`}
                  onClick={() => navigate(`/vault/entity/${ob.entity.id}`)}
                />
              ))}
            </div>
          )}

          {bannedLocal.length > 0 && (
            <div className="space-y-2">
              <SectionHeader label="Local Accounts" count={bannedLocal.length} />
              {bannedLocal.map(a => (
                <BannedRow
                  key={`local-${a.id}`}
                  icon={User}
                  title={a.label || a.username || a.email || `Account #${a.id}`}
                  subtitle={a.category}
                  onClick={() => navigate(`/vault/local/${a.id}`)}
                />
              ))}
            </div>
          )}

          {bannedKyc.length > 0 && (
            <div className="space-y-2">
              <SectionHeader label="KYC Entities" count={bannedKyc.length} />
              {bannedKyc.map(k => (
                <BannedRow
                  key={`kyc-${k.id}`}
                  icon={ShieldCheck}
                  title={k.name || k.username || `KYC #${k.id}`}
                  subtitle={k.nid_number ? `NID: ${k.nid_number}` : k.category}
                  onClick={() => navigate("/vault?tab=kyc")}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </VaultSectionPage>
  );
}
