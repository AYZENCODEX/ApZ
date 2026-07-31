/**
 * vault-sidebar.tsx
 * ─────────────────────────────────────────────
 * Second, page-local sidebar for the Vault section — distinct from the
 * top-level app sidebar. Structured into three groups:
 *
 *   ACCESS     — Wallet, 2FA, Mail Hub, Backup Code
 *   ENROLLMENT — Overview (roll-up), Project (drill-down), Linked (graph)
 *   OTHER      — Security, Shared, Banned
 */
import { Link, useLocation } from "wouter";
import {
  Wallet, ShieldCheck, Mail, BookKey,
  LayoutDashboard, FolderGit2, Link2,
  Share2, Ban, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── ACCESS — wallet / security tools ─────────────────────────────────────────
const ACCESS_ITEMS = [
  { href: "/vault?tab=wallet",        label: "Wallet",      icon: Wallet },
  { href: "/vault/2fa/account",        label: "2FA",         icon: ShieldCheck },
  { href: "/vault/mail-hub/account",   label: "Mail Hub",    icon: Mail },
  { href: "/vault/backup",             label: "Backup Code", icon: BookKey },
] as const;

// ── ENROLLMENT — enroll management hierarchy ─────────────────────────────────
const ENROLL_ITEMS = [
  { href: "/vault/enrollment/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/vault/enrollment/project",  label: "Project",  icon: FolderGit2 },
  { href: "/vault/enrollment/linked",   label: "Linked",   icon: Link2 },
] as const;

// ── OTHER — administrative pages ─────────────────────────────────────────────
const OTHER_ITEMS = [
  { href: "/vault/security", label: "Security", icon: Lock },
  { href: "/vault/shared",   label: "Shared",   icon: Share2 },
  { href: "/vault/banned",   label: "Banned",   icon: Ban },
] as const;

function SidebarItem({
  href, label, icon: Icon, active,
}: {
  href: string; label: string; icon: React.ElementType; active: boolean;
}) {
  return (
    <Link href={href}>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-2.5 rounded-lg font-mono text-xs uppercase tracking-wider transition-all cursor-pointer border group",
          active
            ? "bg-primary/10 text-primary border-primary/25 font-bold shadow-[inset_0_1px_0_rgba(34,211,238,0.1)]"
            : "text-muted-foreground/60 border-transparent hover:bg-muted/20 hover:text-foreground hover:border-border/30"
        )}
      >
        <div
          className={cn(
            "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-all",
            active
              ? "bg-primary/20 border border-primary/30"
              : "bg-muted/30 border border-transparent group-hover:bg-muted/60 group-hover:border-border/30"
          )}
        >
          <Icon className={cn("w-3.5 h-3.5", active ? "text-primary" : "text-current")} />
        </div>
        <span className="truncate">{label}</span>
        {active && <span className="ml-auto w-1 h-1 rounded-full bg-primary flex-shrink-0" />}
      </div>
    </Link>
  );
}

function SidebarGroup({
  label, items, location,
}: {
  label: string;
  items: readonly { href: string; label: string; icon: React.ElementType }[];
  location: string;
}) {
  const matchHref = (href: string) =>
    href.includes("?")
      ? location === href.split("?")[0]
      : location === href || location.startsWith(href + "/");

  return (
    <div className="space-y-1">
      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/40 px-3 pb-0.5">
        {label}
      </p>
      {items.map(item => (
        <SidebarItem
          key={item.href}
          {...item}
          active={matchHref(item.href)}
        />
      ))}
    </div>
  );
}

export function VaultSidebar() {
  const [location] = useLocation();

  return (
    <nav aria-label="Vault sections" className="w-full sm:w-52 flex-shrink-0 space-y-4">
      <SidebarGroup label="Access"      items={ACCESS_ITEMS}  location={location} />
      <SidebarGroup label="Enrollment"  items={ENROLL_ITEMS}  location={location} />
      <SidebarGroup label="Other"       items={OTHER_ITEMS}   location={location} />
    </nav>
  );
}

// ─── Shared page shell ────────────────────────────────────────────────────────
// Keeps header spacing, icon treatment, and the sidebar + content split
// consistent across all vault sidebar pages without repeating layout markup.
export function VaultSectionPage({
  title, description, icon: Icon, children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5 page-enter">
      <div>
        <h1 className="text-2xl font-bold font-mono tracking-tighter uppercase flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          {title}
        </h1>
        <p className="text-muted-foreground font-mono text-xs mt-1 pl-0.5">{description}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-5 min-h-0">
        <VaultSidebar />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}

// Generic empty state used by pages that haven't loaded real data yet.
export function VaultSectionEmptyState({
  icon: Icon, title, note,
}: {
  icon: React.ElementType;
  title: string;
  note: string;
}) {
  return (
    <div className="text-center py-20 space-y-3 border border-dashed border-border/40 rounded-xl">
      <div className="w-14 h-14 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mx-auto">
        <Icon className="w-6 h-6 text-primary/40" />
      </div>
      <p className="font-mono text-sm text-muted-foreground/60">{title}</p>
      <p className="font-mono text-[10px] text-muted-foreground/40 max-w-xs mx-auto leading-relaxed">{note}</p>
    </div>
  );
}
