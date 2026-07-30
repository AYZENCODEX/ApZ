import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePlugins } from "@/hooks/use-plugins";
import { useNavConfig, type DevNavTreeLeaf, type NavType } from "@/hooks/use-dev-nav";
import { resolveDevNavIcon } from "@/lib/dev-nav-icons";
import {
  LayoutDashboard, Users, FolderGit2, CheckSquare, Fuel, Wallet,
  Trophy, Settings, Settings2, Terminal, LogOut, LayoutPanelTop,
  Vault, ShieldCheck, ChevronDown, ChevronRight,
  Radio, Code2, Database, AtSign, UserCircle, Mail, Inbox, HelpCircle, Share2, Puzzle,
  Bot, Send, Loader2, X, ChevronUp, Star, Coins, MessageCircle, History,
  DollarSign, Link2, Sun, Moon, Search, Keyboard, Smartphone, QrCode, Shield,
  ArrowLeftRight, Zap, Globe, FlaskConical, Timer, LayoutList, User,
  Store, Swords, ListTodo, BarChart2, MessageSquare, Flame, Bookmark, Image, Key,
  Bot as BotIcon, Cpu, Activity, RefreshCw as RefreshCwIcon, XCircle, TerminalSquare, Server,
  // Season 1 / Phase 1 sidebar restructure — new icons for the 3rd nesting level
  Home, Boxes, MoreHorizontal, Network, Rss, Cast, ClipboardList, Rocket,
  Handshake, LineChart, PlayCircle, AppWindow, Megaphone, Building2,
  Gamepad2, Palette,
  TrendingUp,
  Lock,
  // Phase 4 — Exchange sidebar sub-type expansion
  Gift, Package, BarChart3, Sparkles, Gem,
  // Phase 4 — Vault Sidebar Restructure (Enroll / Security / Backup / Shared)
  HardDrive, UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface AppSidebarProps { onNavigate?: () => void; }

// Sidebar supports deep, arbitrarily nested levels — Category (NavGroup,
// level 1) → a chain of Section-or-link (NavEntry, level 2+). A NavSection's
// children are themselves NavEntry, so sections can nest inside sections;
// recursion bottoms out whenever a NavLeaf (a direct link) is reached.
// Protocols currently goes 6 levels deep at its deepest branch (Protocols →
// Category → Exchange → Binance → Instant → leaf) — see the Protocols block
// below for the full rationale.
interface NavLeaf { href: string; label: string; icon: React.ElementType; pluginSlug?: string; }
interface NavSection { label: string; icon: React.ElementType; children: NavEntry[]; }
type NavEntry = NavLeaf | NavSection;
interface NavGroup { label: string; icon: React.ElementType; items: NavEntry[]; }

function isSection(entry: NavEntry): entry is NavSection {
  return (entry as NavSection).children !== undefined;
}

const ADMIN_NAV: NavGroup[] = [
  {
    label: "Platform", icon: LayoutDashboard,
    items: [{ href: "/admin/dashboard", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Operators", icon: Users,
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/vault", label: "Entities", icon: Database, pluginSlug: "vault" },
    ],
  },
  {
    label: "Protocols", icon: FolderGit2,
    items: [
      { href: "/admin/projects", label: "Projects", icon: FolderGit2, pluginSlug: "projects" },
      { href: "/admin/operator-progress", label: "Operator Progress", icon: BarChart2, pluginSlug: "projects" },
      { href: "/admin/tasks", label: "Tasks", icon: CheckSquare, pluginSlug: "tasks" },
    ],
  },
  {
    label: "Tools", icon: Fuel,
    items: [
      { href: "/admin/tools/gas", label: "Gas Tracker", icon: Fuel },
      { href: "/admin/tools/wallet", label: "Wallet Analysis", icon: Wallet },
      { href: "/admin/tools/streak", label: "Streak & Spam", icon: CheckSquare },
    ],
  },
  {
    label: "Team", icon: Users,
    items: [
      { href: "/admin/teams", label: "Overview", icon: Users },
      { href: "/admin/team-vault", label: "Team Vault", icon: Vault },
    ],
  },
  {
    label: "Community", icon: Radio,
    items: [
      { href: "/admin/broadcast", label: "Broadcast", icon: Radio, pluginSlug: "broadcast" },
      { href: "/admin/referrals", label: "Referrals", icon: Share2, pluginSlug: "referrals" },
      { href: "/admin/leaderboard", label: "Leaderboard", icon: Trophy, pluginSlug: "leaderboard" },
      { href: "/admin/support", label: "Support", icon: HelpCircle, pluginSlug: "support" },
    ],
  },
  {
    label: "Finance", icon: Coins,
    items: [
      { href: "/admin/credits", label: "Credit Approvals", icon: Coins },
      { href: "/admin/subscriptions", label: "Subscriptions", icon: Star },
      { href: "/admin/marketplace", label: "P2P Marketplace", icon: Store },
      { href: "/admin/revenue", label: "Admin Wallet", icon: Wallet },
    ],
  },
  {
    label: "Monitoring", icon: History,
    items: [
      { href: "/admin/activity", label: "Activity Log", icon: History },
      { href: "/admin/health-rules", label: "Health Rules", icon: ShieldCheck },
    ],
  },
  {
    label: "Config", icon: Settings,
    items: [
      { href: "/admin/categories",   label: "Categories",   icon: Database },
      { href: "/admin/tools/networks",label: "Networks",    icon: Radio },
      { href: "/admin/plugins",      label: "Plugins",      icon: Puzzle },
      { href: "/admin/key-manager",  label: "Key Manager",  icon: Key },
      { href: "/admin/config-manager", label: "Config Manager", icon: Settings2 },
      { href: "/admin/settings",     label: "Settings",     icon: Settings },
    ],
  },
  {
    label: "Developer", icon: Code2,
    items: [
      { href: "/admin/developer?tab=console",   label: "Live Console", icon: Terminal },
      { href: "/admin/developer?tab=telemetry", label: "Telemetry",    icon: Activity },
      { href: "/admin/developer?tab=ping",      label: "Ping Test",    icon: RefreshCwIcon },
      { href: "/admin/developer?tab=functions", label: "Functions",    icon: Server },
      { href: "/admin/developer?tab=errors",    label: "Error Log",    icon: XCircle },
      { href: "/admin/developer?tab=shell",     label: "Shell",        icon: TerminalSquare },
      { href: "/admin/developer?tab=db",        label: "Database",     icon: Database },
    ],
  },
];

// Pinned above the dynamic groups so Appearance tooling is always reachable,
// even if every dynamic category gets disabled or removed — this is the one
// place Layout Builder, Theme Studio, and the Sidebar Builder itself live.
const DEV_NAV_PINNED: NavGroup = {
  label: "Appearance", icon: Palette,
  items: [
    { href: "/admin/layout-builder", label: "Layout Builder", icon: LayoutPanelTop },
    { href: "/admin/theme-studio", label: "Theme Studio", icon: Palette },
    { href: "/admin/dev-nav-builder", label: "Sidebar Builder", icon: LayoutList },
  ],
};

function navTreeToGroups(tree: DevNavTreeLeaf[]): NavGroup[] {
  const toEntry = (node: DevNavTreeLeaf): NavEntry => {
    const icon = resolveDevNavIcon(node.icon);
    const enabledChildren = node.children.filter(c => c.enabled);
    if (enabledChildren.length > 0) {
      return { label: node.label, icon, children: enabledChildren.map(toEntry) };
    }
    return { href: node.href ?? "#", label: node.label, icon };
  };
  return tree
    .filter(group => group.enabled)
    .map(group => ({
      label: group.label,
      icon: resolveDevNavIcon(group.icon),
      items: group.children.filter(c => c.enabled).map(toEntry),
    }));
}

const DEV_NAV: NavGroup[] = [
  {
    label: "AI Agent", icon: BotIcon,
    items: [
      { href: "/admin/ai-agent",              label: "Assistant", icon: BotIcon },
      { href: "/admin/ai-agent?tab=agents",   label: "Agent",     icon: Users },
      { href: "/admin/ai-agent?tab=models",   label: "Model",     icon: Cpu },
      { href: "/admin/ai-agent?tab=mcp",      label: "Skill",     icon: Puzzle },
      { href: "/admin/ai-agent?tab=settings", label: "Settings",  icon: Settings },
    ],
  },
  {
    label: "NFT System", icon: Image,
    items: [
      { href: "/admin/marketplace?tab=nft", label: "NFT Admin", icon: Image },
    ],
  },
  {
    label: "AZN Tools", icon: Coins,
    items: [
      { href: "/dev/azn-deploy", label: "AZN Deploy", icon: DollarSign },
    ],
  },
  {
    label: "Overview", icon: LayoutDashboard,
    items: [
      { href: "/admin/dashboard", label: "Global Dashboard", icon: LayoutDashboard },
    ],
  },
];

const MODERATOR_NAV: NavGroup[] = [
  {
    label: "Command", icon: LayoutDashboard,
    items: [
      { href: "/dashboard", label: "Home", icon: Home },
      {
        label: "Overview", icon: LayoutDashboard,
        children: [
          { href: "/checkin",   label: "Daily Check-in", icon: Flame },
          { href: "/history",   label: "Activity Log",   icon: History },
          { href: "/dashboard", label: "Dashboard",      icon: LayoutDashboard },
        ],
      },
    ],
  },
  {
    // Protocols restructure (round 2) — kept in sync with USER_NAV's
    // Protocols block above (see the comment there for the full rationale).
    label: "Protocols", icon: FolderGit2,
    items: [
      { href: "/projects", label: "Project", icon: FolderGit2, pluginSlug: "projects" },
      {
        label: "Category", icon: LayoutList,
        children: [
          {
            label: "Exchange", icon: ArrowLeftRight,
            children: [
              { href: "/projects?rollup=Exchange", label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              {
                label: "Binance", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Binance", label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                  {
                    label: "Trading", icon: TrendingUp,
                    children: [
                      { href: "/projects?type=binance-trading",         label: "Overview",    icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-volume",      label: "Volume",      icon: BarChart3, pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-competition", label: "Competition", icon: Trophy,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-alpha",       label: "Alpha",       icon: Sparkles,  pluginSlug: "projects" },
                    ],
                  },
                  {
                    label: "Instant", icon: Zap,
                    children: [
                      { href: "/projects?type=binance-instant",            label: "Overview",      icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-rewardhub",  label: "Reward Hub",    icon: Gift,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-redpacket",  label: "Red Packet",    icon: Package, pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-live",       label: "Live",          icon: Radio,   pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-learn2earn", label: "Learn to Earn", icon: Rocket,  pluginSlug: "projects" },
                    ],
                  },
                  {
                    label: "Web3", icon: Globe,
                    children: [
                      { href: "/projects?type=binance-web3",         label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-web3-booster", label: "Booster",  icon: Rocket,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-web3-alpha",   label: "Alpha",    icon: Sparkles,  pluginSlug: "projects" },
                    ],
                  },
                  { href: "/projects?type=binance-refer",      label: "Refer",    icon: Share2,           pluginSlug: "projects" },
                  { href: "/projects?type=binance-other",      label: "Other",    icon: MoreHorizontal,   pluginSlug: "projects" },
                ],
              },
              {
                label: "Bitget", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Bitget",  label: "Overview",     icon: LayoutDashboard, pluginSlug: "projects" },
                  { href: "/projects?type=bitget-candybomb",   label: "CandyBomb",    icon: Zap,             pluginSlug: "projects" },
                  { href: "/projects?type=bitget-hold",        label: "Hold",         icon: Lock,            pluginSlug: "projects" },
                  { href: "/projects?type=bitget-refer",       label: "Refer",        icon: Share2,          pluginSlug: "projects" },
                  { href: "/projects?type=bitget-other",       label: "Other",        icon: MoreHorizontal,  pluginSlug: "projects" },
                  { href: "/projects?type=bitget-mysterybox",  label: "Mystery Box",  icon: Gamepad2,        pluginSlug: "projects" },
                ],
              },
              {
                label: "Kucoin", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Kucoin",  label: "Overview",       icon: LayoutDashboard, pluginSlug: "projects" },
                  {
                    label: "Trading", icon: TrendingUp,
                    children: [
                      { href: "/projects?type=kucoin-trading",        label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-gempool", label: "Gempool", icon: Gem,       pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-volume",  label: "Volume",  icon: BarChart3, pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-pnl",     label: "PnL",     icon: LineChart, pluginSlug: "projects" },
                    ],
                  },
                  { href: "/projects?type=kucoin-refer",       label: "Refer",          icon: Share2,          pluginSlug: "projects" },
                  { href: "/projects?type=kucoin-learn2earn",  label: "Learn to Earn",  icon: Rocket,          pluginSlug: "projects" },
                  { href: "/projects?type=kucoin-other",       label: "Other",          icon: MoreHorizontal,  pluginSlug: "projects" },
                ],
              },
              {
                label: "Bybit", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Bybit",  label: "Overview",   icon: LayoutDashboard, pluginSlug: "projects" },
                  { href: "/projects?type=bybit-hold",        label: "Hold",       icon: Lock,             pluginSlug: "projects" },
                  { href: "/projects?type=bybit-wednesday",   label: "Wednesday",  icon: Timer,            pluginSlug: "projects" },
                  { href: "/projects?type=bybit-refer",       label: "Refer",      icon: Share2,           pluginSlug: "projects" },
                  { href: "/projects?type=bybit-other",       label: "Other",      icon: MoreHorizontal,   pluginSlug: "projects" },
                ],
              },
              { href: "/projects?type=exchange-other", label: "Other", icon: MoreHorizontal, pluginSlug: "projects" },
            ],
          },
          {
            label: "Web3", icon: Globe,
            children: [
              { href: "/projects?rollup=Web3",   label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=web3-dex", label: "Dex",      icon: ArrowLeftRight,  pluginSlug: "projects" },
              { href: "/projects?type=web3-dapp",label: "Dapp",     icon: AppWindow,       pluginSlug: "projects" },
              { href: "/projects?type=web3-other", label: "Other",  icon: MoreHorizontal,  pluginSlug: "projects" },
            ],
          },
          {
            label: "Instant", icon: Zap,
            children: [
              { href: "/projects?type=binance-instant",            label: "Overview",      icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-rewardhub",  label: "Reward Hub",    icon: Gift,    pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-redpacket",  label: "Red Packet",    icon: Package, pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-live",       label: "Live",          icon: Radio,   pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-learn2earn", label: "Learn to Earn", icon: Rocket,  pluginSlug: "projects" },
            ],
          },
          {
            label: "Other", icon: MoreHorizontal,
            children: [
              { href: "/projects?type=exchange-other", label: "Exchange", icon: ArrowLeftRight, pluginSlug: "projects" },
              { href: "/projects?type=web3-other",     label: "Web3",     icon: Globe,           pluginSlug: "projects" },
            ],
          },
          {
            label: "Social", icon: Megaphone,
            children: [
              { href: "/projects?rollup=Social",       label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=social-twitter", label: "Twitter",  icon: Rss,             pluginSlug: "projects" },
              { href: "/projects?type=social-warpcast",label: "Warpcast", icon: Cast,            pluginSlug: "projects" },
            ],
          },
          {
            label: "Onchain", icon: Boxes,
            children: [
              { href: "/projects?rollup=Onchain",        label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=onchain-mainnet",  label: "Mainnet",  icon: Network,          pluginSlug: "projects" },
              { href: "/projects?type=onchain-testnet",  label: "Testnet",  icon: FlaskConical,     pluginSlug: "projects" },
            ],
          },
          {
            label: "App", icon: AppWindow,
            children: [
              { href: "/projects?rollup=App",     label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=app-wallet",label: "Wallet",   icon: Wallet,          pluginSlug: "projects" },
              { href: "/projects?type=app-mining",label: "Mining",   icon: Cpu,             pluginSlug: "projects" },
              { href: "/projects?type=app-refer", label: "Refer",    icon: Share2,          pluginSlug: "projects" },
            ],
          },
          { href: "/tasks", label: "Task", icon: CheckSquare, pluginSlug: "tasks" },
        ],
      },
      { href: "/content", label: "Content", icon: Bot },
    ],
  },
  {
    label: "Vault", icon: Vault,
    items: [
      {
        label: "Account", icon: UserCircle,
        children: [
          { href: "/vault?tab=entity",  label: "Entity",     icon: Shield,      pluginSlug: "vault" },
          { href: "/vault?tab=local",   label: "Local",      icon: Smartphone,  pluginSlug: "vault" },
          { href: "/vault?tab=kyc",     label: "KYC",        icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault?tab=game",    label: "Game",       icon: Gamepad2,    pluginSlug: "vault" },
        ],
      },
      { href: "/vault?tab=wallet",  label: "Wallet",     icon: Wallet,      pluginSlug: "vault" },
      { href: "/vault/projects",    label: "Enrolled Entities", icon: ClipboardList, pluginSlug: "vault" },
      {
        label: "2FA Access", icon: QrCode,
        children: [
          { href: "/vault/2fa/kyc",    label: "KYC",    icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault/2fa/local",  label: "Local",  icon: Smartphone,  pluginSlug: "vault" },
          { href: "/vault/2fa/entity", label: "Entity", icon: Shield,      pluginSlug: "vault" },
          { href: "/vault/2fa/game",   label: "Game",   icon: Gamepad2,    pluginSlug: "vault" },
          { href: "/vault/2fa/other",  label: "Other",  icon: QrCode,      pluginSlug: "vault" },
        ],
      },
      {
        label: "Mail Hub", icon: Mail,
        children: [
          { href: "/vault?tab=mail&view=overview", label: "Overview", icon: LayoutDashboard, pluginSlug: "vault" },
          {
            label: "Mail", icon: Inbox,
            children: [
              { href: "/vault/mail-hub/kyc",    label: "KYC",    icon: ShieldCheck, pluginSlug: "vault" },
              { href: "/vault/mail-hub/local",  label: "Local",  icon: Smartphone,  pluginSlug: "vault" },
              { href: "/vault/mail-hub/entity", label: "Entity", icon: Shield,      pluginSlug: "vault" },
              { href: "/vault/mail-hub/game",   label: "Game",   icon: Gamepad2,    pluginSlug: "vault" },
            ],
          },
          { href: "/vault?tab=mail&view=settings", label: "Settings", icon: Settings, pluginSlug: "vault" },
        ],
      },
      {
        // Phase 4 — Vault Sidebar Restructure: entities enrolled into Vault,
        // vault-level PIN security, backup-code recovery, and sharing —
        // each is its own /vault/<section> route with a dedicated left-hand
        // sidebar (see components/layout/vault-sidebar.tsx).
        label: "Manage", icon: ShieldCheck,
        children: [
          { href: "/vault/enroll",   label: "Enroll",   icon: UserPlus,    pluginSlug: "vault" },
          { href: "/vault/security", label: "Security", icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault/backup",   label: "Backup",   icon: HardDrive,   pluginSlug: "vault" },
          { href: "/vault/shared",   label: "Shared",   icon: Share2,      pluginSlug: "vault" },
        ],
      },
    ],
  },
  {
    label: "Market", icon: Store,
    items: [
      { href: "/marketplace/wallet", label: "Market Wallet", icon: Wallet },
      { href: "/marketplace/spot",   label: "Spot Trading",  icon: TrendingUp },
      { href: "/marketplace/staking",label: "Staking",       icon: Lock },
      { href: "/marketplace/p2p",    label: "P2P Market",    icon: Handshake },
      { href: "/marketplace/nft",    label: "NFT Market",    icon: Image },
      { href: "/marketplace/vault",  label: "Vault Market",  icon: Vault, pluginSlug: "vault" },
      { href: "/marketplace/game",   label: "Game Market",   icon: Gamepad2 },
      {
        label: "Polymarket", icon: LineChart,
        children: [
          { href: "/marketplace/polymarket?tab=wallet",        label: "Wallet",       icon: Wallet },
          { href: "/marketplace/polymarket?tab=overview",      label: "Overview",     icon: LayoutDashboard },
          { href: "/marketplace/polymarket?tab=ai-agent",      label: "AI Agent",     icon: BotIcon },
          { href: "/marketplace/polymarket?tab=market",        label: "Market",       icon: Store },
          { href: "/marketplace/polymarket?tab=order-history", label: "Order History",icon: History },
        ],
      },
      { href: "/marketplace/order-history", label: "Order History", icon: History },
    ],
  },
  {
    label: "Teams", icon: Users,
    items: [
      { href: "/teams",                 label: "Overview",     icon: LayoutDashboard },
      { href: "/teams?tab=members",     label: "Members",      icon: Users },
      { href: "/teams?tab=chat",        label: "Chat",         icon: MessageSquare },
      { href: "/teams?tab=tasks",       label: "Tasks",        icon: ListTodo },
      { href: "/teams?tab=missions",    label: "Missions",     icon: Swords },
      { href: "/teams?tab=browse",      label: "Browse Teams", icon: Search },
      { href: "/teams?tab=invite",      label: "Invite Link",  icon: Link2 },
    ],
  },
  {
    label: "Earn", icon: DollarSign,
    items: [
      {
        label: "Earn Center", icon: DollarSign,
        children: [
          { href: "/earn?tab=link-to-earn", label: "Link to Earn", icon: Link2 },
          { href: "/earn?tab=watch-ads",    label: "Watch Ads",    icon: PlayCircle },
        ],
      },
      { href: "/referrals", label: "Referral", icon: Share2, pluginSlug: "referrals" },
    ],
  },
  {
    label: "Social", icon: MessageCircle,
    items: [
      { href: "/inbox",      label: "Message",   icon: MessageCircle },
      { href: "/leaderboard",label: "Operators",  icon: Trophy, pluginSlug: "leaderboard" },
      { href: "/profile",    label: "Profile",    icon: UserCircle },
      { href: "/support",    label: "Support",    icon: HelpCircle, pluginSlug: "support" },
    ],
  },
  {
    label: "System", icon: Settings,
    items: [
      { href: "/settings",  label: "Settings",  icon: Settings },
      { href: "/security",  label: "Security",  icon: ShieldCheck },
    ],
  },
];

const TEAM_LEADER_NAV: NavGroup[] = [
  {
    label: "Command", icon: LayoutDashboard,
    items: [
      { href: "/dashboard",       label: "Dashboard",      icon: LayoutDashboard },
      { href: "/checkin",         label: "Daily Check-in",  icon: Flame },
      { href: "/history",         label: "Activity Log",    icon: History },
      { href: "/teams?tab=panel", label: "Team Settings",   icon: Settings },
    ],
  },
  {
    // Team sidebar restructure — the 4 separate flat top-level groups
    // (Team Overview / Team Progress / Team Finance / Team Panel) are now
    // nested sections under a single "Team" entry: Team (level 1) →
    // Overview/Progress/Finance/Panel (level 2, 4 groups) → leaves (level 3).
    label: "Team", icon: Users,
    items: [
      {
        label: "Overview", icon: Users,
        children: [
          { href: "/teams",                label: "Team Home",    icon: LayoutDashboard },
          { href: "/teams?tab=members",    label: "Members",      icon: Users },
          { href: "/teams?tab=chat",       label: "Chat",         icon: MessageSquare },
          { href: "/teams?tab=browse",     label: "Browse Teams", icon: Search },
          { href: "/teams?tab=invite",     label: "Invite Link",  icon: Link2 },
        ],
      },
      {
        label: "Progress", icon: BarChart2,
        children: [
          { href: "/teams?tab=tasks",      label: "Task Progress",    icon: ListTodo },
          { href: "/teams?tab=missions",   label: "Missions",         icon: Swords },
          { href: "/teams?tab=leaderboard",label: "Leaderboard",      icon: Trophy },
          { href: "/teams?tab=projects",   label: "Projects",         icon: FolderGit2 },
        ],
      },
      {
        label: "Finance", icon: Coins,
        children: [
          { href: "/teams?tab=vault",    label: "Team Vault",    icon: Vault },
          { href: "/credits",            label: "AZN & Credits", icon: Coins },
        ],
      },
      {
        label: "Panel", icon: Settings,
        children: [
          { href: "/teams?tab=panel",    label: "Team Settings", icon: Settings },
        ],
      },
    ],
  },
  {
    // Protocols restructure (round 2) — kept in sync with USER_NAV's
    // Protocols block above (see the comment there for the full rationale).
    label: "Protocols", icon: FolderGit2,
    items: [
      { href: "/projects", label: "Project", icon: FolderGit2, pluginSlug: "projects" },
      {
        label: "Category", icon: LayoutList,
        children: [
          {
            label: "Exchange", icon: ArrowLeftRight,
            children: [
              { href: "/projects?rollup=Exchange", label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              {
                label: "Binance", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Binance", label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                  {
                    label: "Trading", icon: TrendingUp,
                    children: [
                      { href: "/projects?type=binance-trading",         label: "Overview",    icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-volume",      label: "Volume",      icon: BarChart3, pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-competition", label: "Competition", icon: Trophy,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-alpha",       label: "Alpha",       icon: Sparkles,  pluginSlug: "projects" },
                    ],
                  },
                  {
                    label: "Instant", icon: Zap,
                    children: [
                      { href: "/projects?type=binance-instant",            label: "Overview",      icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-rewardhub",  label: "Reward Hub",    icon: Gift,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-redpacket",  label: "Red Packet",    icon: Package, pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-live",       label: "Live",          icon: Radio,   pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-learn2earn", label: "Learn to Earn", icon: Rocket,  pluginSlug: "projects" },
                    ],
                  },
                  {
                    label: "Web3", icon: Globe,
                    children: [
                      { href: "/projects?type=binance-web3",         label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-web3-booster", label: "Booster",  icon: Rocket,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-web3-alpha",   label: "Alpha",    icon: Sparkles,  pluginSlug: "projects" },
                    ],
                  },
                  { href: "/projects?type=binance-refer",      label: "Refer",    icon: Share2,           pluginSlug: "projects" },
                  { href: "/projects?type=binance-other",      label: "Other",    icon: MoreHorizontal,   pluginSlug: "projects" },
                ],
              },
              {
                label: "Bitget", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Bitget",  label: "Overview",     icon: LayoutDashboard, pluginSlug: "projects" },
                  { href: "/projects?type=bitget-candybomb",   label: "CandyBomb",    icon: Zap,             pluginSlug: "projects" },
                  { href: "/projects?type=bitget-hold",        label: "Hold",         icon: Lock,            pluginSlug: "projects" },
                  { href: "/projects?type=bitget-refer",       label: "Refer",        icon: Share2,          pluginSlug: "projects" },
                  { href: "/projects?type=bitget-other",       label: "Other",        icon: MoreHorizontal,  pluginSlug: "projects" },
                  { href: "/projects?type=bitget-mysterybox",  label: "Mystery Box",  icon: Gamepad2,        pluginSlug: "projects" },
                ],
              },
              {
                label: "Kucoin", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Kucoin",  label: "Overview",       icon: LayoutDashboard, pluginSlug: "projects" },
                  {
                    label: "Trading", icon: TrendingUp,
                    children: [
                      { href: "/projects?type=kucoin-trading",        label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-gempool", label: "Gempool", icon: Gem,       pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-volume",  label: "Volume",  icon: BarChart3, pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-pnl",     label: "PnL",     icon: LineChart, pluginSlug: "projects" },
                    ],
                  },
                  { href: "/projects?type=kucoin-refer",       label: "Refer",          icon: Share2,          pluginSlug: "projects" },
                  { href: "/projects?type=kucoin-learn2earn",  label: "Learn to Earn",  icon: Rocket,          pluginSlug: "projects" },
                  { href: "/projects?type=kucoin-other",       label: "Other",          icon: MoreHorizontal,  pluginSlug: "projects" },
                ],
              },
              {
                label: "Bybit", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Bybit",  label: "Overview",   icon: LayoutDashboard, pluginSlug: "projects" },
                  { href: "/projects?type=bybit-hold",        label: "Hold",       icon: Lock,             pluginSlug: "projects" },
                  { href: "/projects?type=bybit-wednesday",   label: "Wednesday",  icon: Timer,            pluginSlug: "projects" },
                  { href: "/projects?type=bybit-refer",       label: "Refer",      icon: Share2,           pluginSlug: "projects" },
                  { href: "/projects?type=bybit-other",       label: "Other",      icon: MoreHorizontal,   pluginSlug: "projects" },
                ],
              },
              { href: "/projects?type=exchange-other", label: "Other", icon: MoreHorizontal, pluginSlug: "projects" },
            ],
          },
          {
            label: "Web3", icon: Globe,
            children: [
              { href: "/projects?rollup=Web3",   label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=web3-dex", label: "Dex",      icon: ArrowLeftRight,  pluginSlug: "projects" },
              { href: "/projects?type=web3-dapp",label: "Dapp",     icon: AppWindow,       pluginSlug: "projects" },
              { href: "/projects?type=web3-other", label: "Other",  icon: MoreHorizontal,  pluginSlug: "projects" },
            ],
          },
          {
            label: "Instant", icon: Zap,
            children: [
              { href: "/projects?type=binance-instant",            label: "Overview",      icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-rewardhub",  label: "Reward Hub",    icon: Gift,    pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-redpacket",  label: "Red Packet",    icon: Package, pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-live",       label: "Live",          icon: Radio,   pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-learn2earn", label: "Learn to Earn", icon: Rocket,  pluginSlug: "projects" },
            ],
          },
          {
            label: "Other", icon: MoreHorizontal,
            children: [
              { href: "/projects?type=exchange-other", label: "Exchange", icon: ArrowLeftRight, pluginSlug: "projects" },
              { href: "/projects?type=web3-other",     label: "Web3",     icon: Globe,           pluginSlug: "projects" },
            ],
          },
          {
            label: "Social", icon: Megaphone,
            children: [
              { href: "/projects?rollup=Social",       label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=social-twitter", label: "Twitter",  icon: Rss,             pluginSlug: "projects" },
              { href: "/projects?type=social-warpcast",label: "Warpcast", icon: Cast,            pluginSlug: "projects" },
            ],
          },
          {
            label: "Onchain", icon: Boxes,
            children: [
              { href: "/projects?rollup=Onchain",        label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=onchain-mainnet",  label: "Mainnet",  icon: Network,          pluginSlug: "projects" },
              { href: "/projects?type=onchain-testnet",  label: "Testnet",  icon: FlaskConical,     pluginSlug: "projects" },
            ],
          },
          {
            label: "App", icon: AppWindow,
            children: [
              { href: "/projects?rollup=App",     label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=app-wallet",label: "Wallet",   icon: Wallet,          pluginSlug: "projects" },
              { href: "/projects?type=app-mining",label: "Mining",   icon: Cpu,             pluginSlug: "projects" },
              { href: "/projects?type=app-refer", label: "Refer",    icon: Share2,          pluginSlug: "projects" },
            ],
          },
          { href: "/tasks", label: "Task", icon: CheckSquare, pluginSlug: "tasks" },
        ],
      },
      { href: "/content", label: "Content", icon: Bot },
    ],
  },
  {
    label: "Vault", icon: Vault,
    items: [
      {
        label: "Account", icon: UserCircle,
        children: [
          { href: "/vault?tab=entity",  label: "Entity",     icon: Shield,      pluginSlug: "vault" },
          { href: "/vault?tab=local",   label: "Local",      icon: Smartphone,  pluginSlug: "vault" },
          { href: "/vault?tab=kyc",     label: "KYC",        icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault?tab=game",    label: "Game",       icon: Gamepad2,    pluginSlug: "vault" },
        ],
      },
      { href: "/vault?tab=wallet",  label: "Wallet",     icon: Wallet,      pluginSlug: "vault" },
      { href: "/vault/projects",    label: "Enrolled Entities", icon: ClipboardList, pluginSlug: "vault" },
      {
        label: "2FA Access", icon: QrCode,
        children: [
          { href: "/vault/2fa/kyc",    label: "KYC",    icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault/2fa/local",  label: "Local",  icon: Smartphone,  pluginSlug: "vault" },
          { href: "/vault/2fa/entity", label: "Entity", icon: Shield,      pluginSlug: "vault" },
          { href: "/vault/2fa/game",   label: "Game",   icon: Gamepad2,    pluginSlug: "vault" },
          { href: "/vault/2fa/other",  label: "Other",  icon: QrCode,      pluginSlug: "vault" },
        ],
      },
      {
        label: "Mail Hub", icon: Mail,
        children: [
          { href: "/vault?tab=mail&view=overview", label: "Overview", icon: LayoutDashboard, pluginSlug: "vault" },
          {
            label: "Mail", icon: Inbox,
            children: [
              { href: "/vault/mail-hub/kyc",    label: "KYC",    icon: ShieldCheck, pluginSlug: "vault" },
              { href: "/vault/mail-hub/local",  label: "Local",  icon: Smartphone,  pluginSlug: "vault" },
              { href: "/vault/mail-hub/entity", label: "Entity", icon: Shield,      pluginSlug: "vault" },
              { href: "/vault/mail-hub/game",   label: "Game",   icon: Gamepad2,    pluginSlug: "vault" },
            ],
          },
          { href: "/vault?tab=mail&view=settings", label: "Settings", icon: Settings, pluginSlug: "vault" },
        ],
      },
      {
        // Phase 4 — Vault Sidebar Restructure: entities enrolled into Vault,
        // vault-level PIN security, backup-code recovery, and sharing —
        // each is its own /vault/<section> route with a dedicated left-hand
        // sidebar (see components/layout/vault-sidebar.tsx).
        label: "Manage", icon: ShieldCheck,
        children: [
          { href: "/vault/enroll",   label: "Enroll",   icon: UserPlus,    pluginSlug: "vault" },
          { href: "/vault/security", label: "Security", icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault/backup",   label: "Backup",   icon: HardDrive,   pluginSlug: "vault" },
          { href: "/vault/shared",   label: "Shared",   icon: Share2,      pluginSlug: "vault" },
        ],
      },
    ],
  },
  {
    label: "Market", icon: Store,
    items: [
      { href: "/marketplace/p2p",   label: "P2P Market",  icon: Handshake },
      { href: "/marketplace/nft",   label: "NFT Market",  icon: Image },
      { href: "/marketplace/vault", label: "Vault Market", icon: Vault, pluginSlug: "vault" },
      { href: "/marketplace/game",  label: "Game Market",  icon: Gamepad2 },
    ],
  },
  {
    label: "Earn", icon: DollarSign,
    items: [
      { href: "/earn",       label: "Earn Center",  icon: DollarSign },
      { href: "/leaderboard",label: "Operators",    icon: Trophy,  pluginSlug: "leaderboard" },
      { href: "/referrals",  label: "Referrals",    icon: Share2,  pluginSlug: "referrals" },
    ],
  },
  {
    label: "Social", icon: MessageCircle,
    items: [
      { href: "/inbox",   label: "Messages",   icon: MessageCircle },
      { href: "/profile", label: "My Profile", icon: UserCircle },
      { href: "/support", label: "Support",    icon: HelpCircle, pluginSlug: "support" },
    ],
  },
  {
    label: "System", icon: Settings,
    items: [
      { href: "/subscription", label: "Subscription", icon: Star },
      { href: "/wallet",       label: "My Wallet",    icon: Wallet },
      { href: "/settings",     label: "Settings",     icon: Settings },
      { href: "/security",     label: "Security",     icon: ShieldCheck },
    ],
  },
];

const USER_NAV: NavGroup[] = [
  {
    label: "Command", icon: LayoutDashboard,
    items: [
      { href: "/dashboard", label: "Home", icon: Home },
      {
        label: "Overview", icon: LayoutDashboard,
        children: [
          { href: "/checkin",   label: "Daily Check-in", icon: Flame },
          { href: "/history",   label: "Activity Log",   icon: History },
          { href: "/dashboard", label: "Dashboard",      icon: LayoutDashboard },
        ],
      },
    ],
  },
  {
    // Protocols restructure (round 2) — one more wrapping level than before.
    // Protocols now shows exactly 3 top-level entries: "Project" (root
    // rollup, no filter), "Category" (this section — everything that used
    // to hang directly off Protocols now lives here instead: Exchange,
    // Web3, Instant, Other, Social, Onchain, App, Task), and "Content".
    // Category is 6 levels deep at its deepest branch: Protocols → Category
    // → Exchange → Binance → Instant → leaf. Every Category/Subcategory/
    // Platform still gets its own "Overview" leaf that rolls up every
    // project nested under it (see getRollupTypes in @/config/projects.ts).
    // Kept in sync across MODERATOR_NAV, TEAM_LEADER_NAV and USER_NAV.
    label: "Protocols", icon: FolderGit2,
    items: [
      { href: "/projects", label: "Project", icon: FolderGit2, pluginSlug: "projects" },
      {
        label: "Category", icon: LayoutList,
        children: [
          {
            label: "Exchange", icon: ArrowLeftRight,
            children: [
              { href: "/projects?rollup=Exchange", label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              {
                label: "Binance", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Binance", label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                  {
                    label: "Trading", icon: TrendingUp,
                    children: [
                      { href: "/projects?type=binance-trading",         label: "Overview",    icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-volume",      label: "Volume",      icon: BarChart3, pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-competition", label: "Competition", icon: Trophy,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-trading-alpha",       label: "Alpha",       icon: Sparkles,  pluginSlug: "projects" },
                    ],
                  },
                  {
                    label: "Instant", icon: Zap,
                    children: [
                      { href: "/projects?type=binance-instant",            label: "Overview",      icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-rewardhub",  label: "Reward Hub",    icon: Gift,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-redpacket",  label: "Red Packet",    icon: Package, pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-live",       label: "Live",          icon: Radio,   pluginSlug: "projects" },
                      { href: "/projects?type=binance-instant-learn2earn", label: "Learn to Earn", icon: Rocket,  pluginSlug: "projects" },
                    ],
                  },
                  {
                    label: "Web3", icon: Globe,
                    children: [
                      { href: "/projects?type=binance-web3",         label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=binance-web3-booster", label: "Booster",  icon: Rocket,    pluginSlug: "projects" },
                      { href: "/projects?type=binance-web3-alpha",   label: "Alpha",    icon: Sparkles,  pluginSlug: "projects" },
                    ],
                  },
                  { href: "/projects?type=binance-refer",      label: "Refer",    icon: Share2,           pluginSlug: "projects" },
                  { href: "/projects?type=binance-other",      label: "Other",    icon: MoreHorizontal,   pluginSlug: "projects" },
                ],
              },
              {
                label: "Bitget", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Bitget",  label: "Overview",     icon: LayoutDashboard, pluginSlug: "projects" },
                  { href: "/projects?type=bitget-candybomb",   label: "CandyBomb",    icon: Zap,             pluginSlug: "projects" },
                  { href: "/projects?type=bitget-hold",        label: "Hold",         icon: Lock,            pluginSlug: "projects" },
                  { href: "/projects?type=bitget-refer",       label: "Refer",        icon: Share2,          pluginSlug: "projects" },
                  { href: "/projects?type=bitget-other",       label: "Other",        icon: MoreHorizontal,  pluginSlug: "projects" },
                  { href: "/projects?type=bitget-mysterybox",  label: "Mystery Box",  icon: Gamepad2,        pluginSlug: "projects" },
                ],
              },
              {
                label: "Kucoin", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Kucoin",  label: "Overview",       icon: LayoutDashboard, pluginSlug: "projects" },
                  {
                    label: "Trading", icon: TrendingUp,
                    children: [
                      { href: "/projects?type=kucoin-trading",        label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-gempool", label: "Gempool", icon: Gem,       pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-volume",  label: "Volume",  icon: BarChart3, pluginSlug: "projects" },
                      { href: "/projects?type=kucoin-trading-pnl",     label: "PnL",     icon: LineChart, pluginSlug: "projects" },
                    ],
                  },
                  { href: "/projects?type=kucoin-refer",       label: "Refer",          icon: Share2,          pluginSlug: "projects" },
                  { href: "/projects?type=kucoin-learn2earn",  label: "Learn to Earn",  icon: Rocket,          pluginSlug: "projects" },
                  { href: "/projects?type=kucoin-other",       label: "Other",          icon: MoreHorizontal,  pluginSlug: "projects" },
                ],
              },
              {
                label: "Bybit", icon: Building2,
                children: [
                  { href: "/projects?rollup=Exchange:Bybit",  label: "Overview",   icon: LayoutDashboard, pluginSlug: "projects" },
                  { href: "/projects?type=bybit-hold",        label: "Hold",       icon: Lock,             pluginSlug: "projects" },
                  { href: "/projects?type=bybit-wednesday",   label: "Wednesday",  icon: Timer,            pluginSlug: "projects" },
                  { href: "/projects?type=bybit-refer",       label: "Refer",      icon: Share2,           pluginSlug: "projects" },
                  { href: "/projects?type=bybit-other",       label: "Other",      icon: MoreHorizontal,   pluginSlug: "projects" },
                ],
              },
              { href: "/projects?type=exchange-other", label: "Other", icon: MoreHorizontal, pluginSlug: "projects" },
            ],
          },
          {
            label: "Web3", icon: Globe,
            children: [
              { href: "/projects?rollup=Web3",   label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=web3-dex", label: "Dex",      icon: ArrowLeftRight,  pluginSlug: "projects" },
              { href: "/projects?type=web3-dapp",label: "Dapp",     icon: AppWindow,       pluginSlug: "projects" },
              { href: "/projects?type=web3-other", label: "Other",  icon: MoreHorizontal,  pluginSlug: "projects" },
            ],
          },
          {
            label: "Instant", icon: Zap,
            children: [
              { href: "/projects?type=binance-instant",            label: "Overview",      icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-rewardhub",  label: "Reward Hub",    icon: Gift,    pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-redpacket",  label: "Red Packet",    icon: Package, pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-live",       label: "Live",          icon: Radio,   pluginSlug: "projects" },
              { href: "/projects?type=binance-instant-learn2earn", label: "Learn to Earn", icon: Rocket,  pluginSlug: "projects" },
            ],
          },
          {
            label: "Other", icon: MoreHorizontal,
            children: [
              { href: "/projects?type=exchange-other", label: "Exchange", icon: ArrowLeftRight, pluginSlug: "projects" },
              { href: "/projects?type=web3-other",     label: "Web3",     icon: Globe,           pluginSlug: "projects" },
            ],
          },
          {
            label: "Social", icon: Megaphone,
            children: [
              { href: "/projects?rollup=Social",       label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=social-twitter", label: "Twitter",  icon: Rss,             pluginSlug: "projects" },
              { href: "/projects?type=social-warpcast",label: "Warpcast", icon: Cast,            pluginSlug: "projects" },
            ],
          },
          {
            label: "Onchain", icon: Boxes,
            children: [
              { href: "/projects?rollup=Onchain",        label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=onchain-mainnet",  label: "Mainnet",  icon: Network,          pluginSlug: "projects" },
              { href: "/projects?type=onchain-testnet",  label: "Testnet",  icon: FlaskConical,     pluginSlug: "projects" },
            ],
          },
          {
            label: "App", icon: AppWindow,
            children: [
              { href: "/projects?rollup=App",     label: "Overview", icon: LayoutDashboard, pluginSlug: "projects" },
              { href: "/projects?type=app-wallet",label: "Wallet",   icon: Wallet,          pluginSlug: "projects" },
              { href: "/projects?type=app-mining",label: "Mining",   icon: Cpu,             pluginSlug: "projects" },
              { href: "/projects?type=app-refer", label: "Refer",    icon: Share2,          pluginSlug: "projects" },
            ],
          },
          { href: "/tasks", label: "Task", icon: CheckSquare, pluginSlug: "tasks" },
        ],
      },
      { href: "/content", label: "Content", icon: Bot },
    ],
  },
  {
    label: "Teams", icon: Users,
    items: [
      { href: "/teams",                 label: "Overview",     icon: LayoutDashboard },
      { href: "/teams?tab=members",     label: "Members",      icon: Users },
      { href: "/teams?tab=chat",        label: "Chat",         icon: MessageSquare },
      { href: "/teams?tab=vault",       label: "Vault",        icon: Vault },
      { href: "/teams?tab=tasks",       label: "Tasks",        icon: ListTodo },
      { href: "/teams?tab=missions",    label: "Missions",     icon: Swords },
      { href: "/teams?tab=leaderboard", label: "Leaderboard",  icon: Trophy },
      { href: "/teams?tab=projects",    label: "Projects",     icon: FolderGit2 },
      { href: "/teams?tab=browse",      label: "Browse Teams", icon: Search },
      { href: "/teams?tab=invite",      label: "Invite Link",  icon: Link2 },
      { href: "/teams?tab=panel",       label: "Panel",        icon: Settings },
    ],
  },
  {
    label: "Vault", icon: Vault,
    items: [
      {
        label: "Account", icon: UserCircle,
        children: [
          { href: "/vault?tab=entity",  label: "Entity",     icon: Shield,      pluginSlug: "vault" },
          { href: "/vault?tab=local",   label: "Local",      icon: Smartphone,  pluginSlug: "vault" },
          { href: "/vault?tab=kyc",     label: "KYC",        icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault?tab=game",    label: "Game",       icon: Gamepad2,    pluginSlug: "vault" },
        ],
      },
      { href: "/vault?tab=wallet",  label: "Wallet",     icon: Wallet,      pluginSlug: "vault" },
      {
        label: "2FA Access", icon: QrCode,
        children: [
          { href: "/vault/2fa/kyc",    label: "KYC",    icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault/2fa/local",  label: "Local",  icon: Smartphone,  pluginSlug: "vault" },
          { href: "/vault/2fa/entity", label: "Entity", icon: Shield,      pluginSlug: "vault" },
          { href: "/vault/2fa/game",   label: "Game",   icon: Gamepad2,    pluginSlug: "vault" },
          { href: "/vault/2fa/other",  label: "Other",  icon: QrCode,      pluginSlug: "vault" },
        ],
      },
      {
        label: "Mail Hub", icon: Mail,
        children: [
          { href: "/vault?tab=mail&view=overview", label: "Overview", icon: LayoutDashboard, pluginSlug: "vault" },
          {
            label: "Mail", icon: Inbox,
            children: [
              { href: "/vault/mail-hub/kyc",    label: "KYC",    icon: ShieldCheck, pluginSlug: "vault" },
              { href: "/vault/mail-hub/local",  label: "Local",  icon: Smartphone,  pluginSlug: "vault" },
              { href: "/vault/mail-hub/entity", label: "Entity", icon: Shield,      pluginSlug: "vault" },
              { href: "/vault/mail-hub/game",   label: "Game",   icon: Gamepad2,    pluginSlug: "vault" },
            ],
          },
          { href: "/vault?tab=mail&view=settings", label: "Settings", icon: Settings, pluginSlug: "vault" },
        ],
      },
      {
        // Phase 4 — Vault Sidebar Restructure: entities enrolled into Vault,
        // vault-level PIN security, backup-code recovery, and sharing —
        // each is its own /vault/<section> route with a dedicated left-hand
        // sidebar (see components/layout/vault-sidebar.tsx).
        label: "Manage", icon: ShieldCheck,
        children: [
          { href: "/vault/enroll",   label: "Enroll",   icon: UserPlus,    pluginSlug: "vault" },
          { href: "/vault/security", label: "Security", icon: ShieldCheck, pluginSlug: "vault" },
          { href: "/vault/backup",   label: "Backup",   icon: HardDrive,   pluginSlug: "vault" },
          { href: "/vault/shared",   label: "Shared",   icon: Share2,      pluginSlug: "vault" },
        ],
      },
    ],
  },
  {
    // Phase 3 -- separate from the Protocols "Project" browse/rollup entry
    // above (lists all protocols) and from Vault's own Account>Entity list.
    // This is the enrollment-bridge surface: projects the user has enrolled
    // entities into, each showing that entity's project-scoped account
    // snapshot (captured at enroll time, see EnrollDialog).
    label: "Project", icon: ClipboardList,
    items: [
      { href: "/vault/projects", label: "Enrolled Entities", icon: ClipboardList },
    ],
  },
  {
    // Phase 9A — Enroll sidebar shell: a new top-level area (separate from
    // the "Project" group above and from Vault) with its own page-local
    // sidebar (components/layout/enroll-sidebar.tsx). Projects section has
    // an Overview (stat widgets/charts sourced from the Phase 4
    // activity_log) + Project list; Entities is a Phase 10 placeholder.
    label: "Enroll", icon: UserPlus,
    items: [
      { href: "/enroll/projects", label: "Projects", icon: FolderGit2 },
      { href: "/enroll/entities", label: "Entities",  icon: Users },
    ],
  },
  {
    label: "Market", icon: Store,
    items: [
      { href: "/marketplace/wallet", label: "Market Wallet", icon: Wallet },
      { href: "/marketplace/spot",   label: "Spot Trading",  icon: TrendingUp },
      { href: "/marketplace/staking",label: "Staking",       icon: Lock },
      { href: "/marketplace/p2p",    label: "P2P Market",    icon: Handshake },
      { href: "/marketplace/nft",    label: "NFT Market",    icon: Image },
      { href: "/marketplace/vault",  label: "Vault Market",  icon: Vault, pluginSlug: "vault" },
      { href: "/marketplace/game",   label: "Game Market",   icon: Gamepad2 },
      {
        label: "Polymarket", icon: LineChart,
        children: [
          { href: "/marketplace/polymarket?tab=wallet",        label: "Wallet",        icon: Wallet },
          { href: "/marketplace/polymarket?tab=overview",      label: "Overview",      icon: LayoutDashboard },
          { href: "/marketplace/polymarket?tab=ai-agent",      label: "AI Agent",      icon: BotIcon },
          { href: "/marketplace/polymarket?tab=market",        label: "Market",        icon: Store },
          { href: "/marketplace/polymarket?tab=order-history", label: "Order History", icon: History },
        ],
      },
      { href: "/marketplace/order-history", label: "Order History", icon: History },
    ],
  },
  {
    label: "Wallet", icon: Wallet,
    items: [
      { href: "/wallet", label: "My Wallet", icon: Wallet },
      { href: "/credits", label: "AZN & Credits", icon: Coins },
    ],
  },
  {
    label: "Earn", icon: DollarSign,
    items: [
      {
        label: "Earn Center", icon: DollarSign,
        children: [
          { href: "/earn?tab=link-to-earn", label: "Link to Earn", icon: Link2 },
          { href: "/earn?tab=watch-ads",    label: "Watch Ads",    icon: PlayCircle },
        ],
      },
      { href: "/referrals", label: "Referral", icon: Share2, pluginSlug: "referrals" },
    ],
  },
  {
    label: "Social", icon: MessageCircle,
    items: [
      { href: "/inbox",       label: "Message",   icon: MessageCircle },
      { href: "/leaderboard", label: "Operators",  icon: Trophy, pluginSlug: "leaderboard" },
      { href: "/profile",     label: "Profile",    icon: UserCircle },
      { href: "/support",     label: "Support",    icon: HelpCircle, pluginSlug: "support" },
    ],
  },
  {
    label: "System", icon: Settings,
    items: [
      { href: "/subscription",  label: "Subscription",  icon: Star },
      { href: "/settings",      label: "Settings",      icon: Settings },
      { href: "/security",      label: "Security",      icon: ShieldCheck },
    ],
  },
];

interface Message { role: "user" | "assistant"; content: string; }

import { getApiBase } from "@/lib/api-base";
const BASE = getApiBase();

function SidebarAiPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const userMsg: Message = { role: "user", content };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);
    try {
      const token = localStorage.getItem("ayzen_token") ?? "";
      const res = await fetch(`${BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: newMsgs, model: "llama-3.3-70b-versatile" }),
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content ?? "Sorry, I couldn't respond right now.";
      setMessages(m => [...m, { role: "assistant", content: reply }]);
    } catch {
      setMessages(m => [...m, { role: "assistant", content: "Connection error." }]);
    }
    setLoading(false);
  };

  return (
    <div className="border-t border-sidebar-border">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-sidebar-accent transition-colors"
      >
        <div className="relative">
          <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full border border-sidebar" />
        </div>
        <span className="flex-1 text-left font-mono text-xs font-bold text-primary tracking-wider">AYZEN AI</span>
        {open ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-sidebar-border flex flex-col" style={{ height: "280px" }}>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <Bot className="w-6 h-6 text-primary/30" />
                <div className="text-[10px] font-mono text-muted-foreground/40 text-center">
                  Ask about airdrops, vault, wallets...
                </div>
                <div className="flex flex-col gap-1 w-full">
                  {["Best L2 airdrops?", "Check my vault"].map(q => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-[9px] font-mono text-left px-2 py-1.5 rounded border border-border/50 hover:border-primary/30 hover:text-primary text-muted-foreground/50 transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-1.5 animate-fade-up", m.role === "user" ? "flex-row-reverse" : "flex-row")}>
                {m.role === "assistant" && (
                  <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-2.5 h-2.5 text-primary" />
                  </div>
                )}
                <div className={cn(
                  "max-w-[85%] text-[10px] font-mono p-2 rounded-lg leading-relaxed",
                  m.role === "user"
                    ? "bg-primary/15 text-foreground border border-primary/20 rounded-tr-sm"
                    : "bg-muted/60 text-foreground border border-border rounded-tl-sm"
                )}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-1.5 animate-fade-up">
                <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-2.5 h-2.5 text-primary" />
                </div>
                <div className="bg-muted/60 border border-border text-[10px] font-mono p-2 rounded-lg rounded-tl-sm flex items-center gap-1.5">
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />
                  <span className="text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="px-2 py-2 border-t border-sidebar-border flex gap-1.5">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="Ask AYZEN AI…"
              disabled={loading}
              className="flex-1 bg-input border border-border rounded px-2 py-1.5 text-[10px] font-mono focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground"
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="text-primary hover:text-primary/80 disabled:opacity-30 transition-colors p-1.5 hover:bg-primary/10 rounded"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Dynamic project list for admin Protocols sidebar —
// shows project names as clickable items that navigate to /admin/projects/:id
// and also show per-project operator count.
function AdminProjectsSidebarSection({ onNavigate, location }: {
  onNavigate?: () => void;
  location: string;
}) {
  const [projects, setProjects] = useState<{ id: number; name: string; activeUserCount: number; projectType: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("ayzen_token") ?? "";
    fetch(`${BASE}/api/projects?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.projects) setProjects(d.projects.map((p: any) => ({
          id: p.id,
          name: p.name,
          activeUserCount: p.activeUserCount ?? 0,
          projectType: p.projectType ?? p.project_type ?? "protocol",
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="border-t border-sidebar-border">
      {/* Section header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <FolderGit2 className="w-3 h-3" />
        <span className="flex-1 text-left">Projects</span>
        <span className="text-[9px] text-muted-foreground/30">{projects.length}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      <div
        className="grid"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 260ms ease",
        }}
      >
        <div className="overflow-hidden">
          <div className="px-2 pb-2 space-y-0.5 max-h-64 overflow-y-auto">
            {loading ? (
              <div className="px-2 py-2 font-mono text-[9px] text-muted-foreground/30 animate-pulse">Loading...</div>
            ) : projects.length === 0 ? (
              <div className="px-2 py-2 font-mono text-[9px] text-muted-foreground/30">No projects yet</div>
            ) : (
              projects.map(p => {
                const isActive = location === `/admin/projects/${p.id}`;
                return (
                  <Link key={p.id} href={`/admin/projects/${p.id}`} onClick={onNavigate}>
                    <div className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer border",
                      isActive
                        ? "bg-primary/10 text-primary border-primary/25"
                        : "text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground border-transparent hover:border-border/30"
                    )}>
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                        isActive ? "bg-primary" : "bg-muted-foreground/30"
                      )} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-[9px] text-muted-foreground/30 flex-shrink-0">{p.activeUserCount}</span>
                    </div>
                  </Link>
                );
              })
            )}
            {/* Quick link to operator progress */}
            <Link href="/admin/operator-progress" onClick={onNavigate}>
              <div className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer border mt-1",
                location === "/admin/operator-progress"
                  ? "bg-primary/10 text-primary border-primary/25"
                  : "text-primary/50 hover:bg-primary/5 hover:text-primary border-primary/10 hover:border-primary/20"
              )}>
                <BarChart2 className="w-3 h-3 flex-shrink-0" />
                <span className="flex-1">All Operator Progress</span>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// Shared active-route check, used at all 3 nav levels (category direct links,
// section children, and — for the "has an active descendant" check — sections themselves).
function isNavActive(href: string, location: string, search: string): boolean {
  // Phase 16C: teams.tsx's sidebar now writes URLs shaped
  // /teams?section=...&tab=..., but these nav links still use the
  // legacy /teams?tab=... shape (and stay correct — teams.tsx derives the
  // section from `tab` when `section` is absent). Match on `tab` alone so a
  // link is highlighted active regardless of which shape produced the URL.
  if (href === "/teams" || href.startsWith("/teams?")) {
    const linkTab = href.includes("?") ? (new URLSearchParams(href.split("?")[1]).get("tab") ?? "dashboard") : "dashboard";
    const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const currentTab = sp.get("tab") ?? "dashboard";
    return location === "/teams" && currentTab === linkTab;
  }
  if (href.includes("?")) {
    const [path, qs] = href.split("?");
    return location === path && search === `?${qs}`;
  }
  if (href === "/projects") {
    const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const t = sp.get("type");
    return location === "/projects" && (!t || t === "protocol");
  }
  return location === href || location.startsWith(href + "/");
}

function NavLeafLink({ item, active, indent, onNavigate }: {
  item: NavLeaf; active: boolean; indent?: boolean; onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link href={item.href} onClick={onNavigate}>
      <div
        style={{ paddingTop: "var(--sidebar-row-py, 0.5rem)", paddingBottom: "var(--sidebar-row-py, 0.5rem)" }}
        className={cn(
          "flex items-center gap-2.5 px-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer font-mono group",
          active
            ? "bg-primary/10 text-primary border border-primary/25 shadow-[inset_0_1px_0_rgba(34,211,238,0.1)]"
            : "text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground border border-transparent hover:border-border/30"
        )}
      >
        <div className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-all",
          active
            ? "bg-primary/20 border border-primary/30"
            : "bg-muted/30 border border-transparent group-hover:bg-muted/60 group-hover:border-border/30"
        )}>
          <Icon className={cn("w-3.5 h-3.5", active ? "text-primary" : "text-current")} />
        </div>
        <span className="truncate text-[11px]">{item.label}</span>
        {active && <span className="ml-auto w-1 h-1 rounded-full bg-primary flex-shrink-0" />}
      </div>
    </Link>
  );
}

// Recursively checks whether any leaf under this entry matches the current
// route — used to auto-expand the whole ancestor chain down to an active link.
function entryIsActive(entry: NavEntry, location: string, search: string): boolean {
  return isSection(entry)
    ? entry.children.some(c => entryIsActive(c, location, search))
    : isNavActive(entry.href, location, search);
}

// Recursively drops plugin-gated leaves anywhere in the tree, and any section
// left with zero children after filtering.
function filterEntry(entry: NavEntry, isEnabled: (slug: string) => boolean): NavEntry | null {
  if (isSection(entry)) {
    const children = entry.children
      .map(c => filterEntry(c, isEnabled))
      .filter((c): c is NavEntry => c !== null);
    return children.length > 0 ? { ...entry, children } : null;
  }
  return (!entry.pluginSlug || isEnabled(entry.pluginSlug)) ? entry : null;
}

// Level 2+: a section that expands to reveal its own sub-items — children can
// be plain links (NavLeaf) or further nested sections, recursing indefinitely.
function NavSectionComp({ section, location, search, onNavigate }: {
  section: NavSection;
  location: string;
  search: string;
  onNavigate?: () => void;
}) {
  const hasActiveChild = section.children.some(c => entryIsActive(c, location, search));
  const [open, setOpen] = useState(hasActiveChild);
  const SectionIcon = section.icon;

  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  if (section.children.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ paddingTop: "var(--sidebar-row-py, 0.5rem)", paddingBottom: "var(--sidebar-row-py, 0.5rem)" }}
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer font-mono group",
          "text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground border border-transparent hover:border-border/30"
        )}
      >
        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-muted/30 border border-transparent group-hover:bg-muted/60 group-hover:border-border/30 transition-all">
          <SectionIcon className="w-3.5 h-3.5 text-current" />
        </div>
        <span className="flex-1 text-left truncate text-[11px]">{section.label}</span>
        {open ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
      </button>
      <div
        className="grid"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows var(--sidebar-anim-duration, 260ms) ease, opacity var(--sidebar-anim-duration, 260ms) ease",
          opacity: open ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="ml-3 pl-2.5 border-l border-border/30 space-y-0.5 mt-0.5">
            {section.children.map(child =>
              isSection(child) ? (
                <NavSectionComp
                  key={child.label}
                  section={child}
                  location={location}
                  search={search}
                  onNavigate={onNavigate}
                />
              ) : (
                <NavLeafLink
                  key={child.href}
                  item={child}
                  active={isNavActive(child.href, location, search)}
                  onNavigate={onNavigate}
                />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Level 1: a category — mix of direct links and expandable (possibly nested) sections.
function NavGroupComp({ group, location, search, isEnabled, onNavigate }: {
  group: NavGroup;
  location: string;
  search: string;
  isEnabled: (slug: string) => boolean;
  onNavigate?: () => void;
}) {
  const visibleItems: NavEntry[] = group.items
    .map(entry => filterEntry(entry, isEnabled))
    .filter((e): e is NavEntry => e !== null);

  const hasActive = visibleItems.some(entry => entryIsActive(entry, location, search));
  const [open, setOpen] = useState(hasActive || visibleItems.length === 1);
  const GroupIcon = group.icon;

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  if (visibleItems.length === 0) return null;

  return (
    <div>
      {visibleItems.length > 1 ? (
        <button
          onClick={() => setOpen(o => !o)}
          style={{ paddingTop: "var(--sidebar-group-py, 0.375rem)", paddingBottom: "var(--sidebar-group-py, 0.375rem)" }}
          className="w-full flex items-center gap-2 px-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          <GroupIcon className="w-3 h-3" />
          <span className="flex-1 text-left">{group.label}</span>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
      ) : (
        <div className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/40">
          {group.label}
        </div>
      )}
      <div
        className="grid"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows var(--sidebar-anim-duration, 260ms) ease, opacity var(--sidebar-anim-duration, 260ms) ease",
          opacity: open ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <nav className="space-y-0.5 px-2 pb-1">
            {visibleItems.map(entry =>
              isSection(entry) ? (
                <NavSectionComp
                  key={entry.label}
                  section={entry}
                  location={location}
                  search={search}
                  onNavigate={onNavigate}
                />
              ) : (
                <NavLeafLink
                  key={entry.href}
                  item={entry}
                  active={isNavActive(entry.href, location, search)}
                  onNavigate={onNavigate}
                />
              )
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}

function useThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.documentElement.classList.contains("dark");
  });
  const toggle = useCallback(() => {
    const next = !isDark;
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("ayzen_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("ayzen_theme", "light");
    }
    setIsDark(next);
  }, [isDark]);
  return { isDark, toggle };
}

function ProfileQuickAccess({ user, logout, navigate, onNavigate }: {
  user: any; logout: () => void; navigate: (href: string) => void; onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const go = (href: string) => { navigate(href); onNavigate?.(); setOpen(false); };
  return (
    <div className="border-b border-sidebar-border">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-sidebar-accent/50 transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center font-bold text-[11px] uppercase text-primary flex-shrink-0">
          {user?.username?.[0] || 'U'}
        </div>
        <div className="flex-1 overflow-hidden min-w-0 text-left">
          <div className="text-[11px] font-mono font-semibold truncate leading-tight">{user?.username}</div>
          <div className="text-[9px] text-sidebar-foreground/40 truncate font-mono">{user?.email}</div>
        </div>
        {open ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && (
        <div className="pb-2 px-2 space-y-0.5 animate-fade-up">
          {[
            { href: "/profile",      label: "My Profile",    icon: UserCircle },
            { href: "/settings",     label: "Settings",      icon: Settings },
            { href: "/security",     label: "Security",      icon: ShieldCheck },
            { href: "/subscription", label: "Subscription",  icon: Star },
          ].map(({ href, label, icon: Icon }) => (
            <button
              key={href}
              onClick={() => go(href)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground border border-transparent hover:border-border/30 transition-all"
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
          <button
            onClick={() => { logout(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-red-400/70 hover:bg-red-500/10 hover:text-red-400 border border-transparent hover:border-red-500/20 transition-all"
          >
            <LogOut className="w-3.5 h-3.5" /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function AppSidebar({ onNavigate }: AppSidebarProps = {}) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const { isAdmin, isDev, isModerator, isTeamLeader, logout, user } = useAuth();
  const { isEnabled } = usePlugins();
  const navType: NavType = isAdmin ? "admin" : isDev ? "dev" : isModerator ? "moderator" : isTeamLeader ? "team_leader" : "user";
  const { tree: navTree, isLoading: navLoading } = useNavConfig(navType);
  const { isDark, toggle: toggleTheme } = useThemeToggle();

  // Every role's sidebar is DB-driven (nav_type-scoped rows), seeded from
  // the original hardcoded arrays below so first load is non-destructive.
  // Those static arrays remain as the loading/empty-state fallback only.
  const STATIC_NAV: Record<NavType, NavGroup[]> = {
    admin: ADMIN_NAV, dev: DEV_NAV, moderator: MODERATOR_NAV,
    team_leader: TEAM_LEADER_NAV, user: USER_NAV,
  };
  const dynamicGroups = navLoading || navTree.length === 0
    ? STATIC_NAV[navType]
    : navTreeToGroups(navTree);
  const groups = navType === "dev" ? [DEV_NAV_PINNED, ...dynamicGroups] : dynamicGroups;

  const openSearch = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  const openShortcuts = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));

  return (
    <div className="flex h-full flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground" style={{ width: "var(--sidebar-w, 16rem)" }}>
      {/* Logo bar */}
      <div className="p-4 flex items-center gap-2 font-mono text-xl font-bold tracking-tighter text-primary border-b border-sidebar-border">
        <Terminal className="w-5 h-5" />
        <span className="flex-1">AYZEN</span>
        <div className="flex items-center gap-1">
          <button onClick={() => { navigate("/vault?tab=mail&view=overview"); onNavigate?.(); }} className="p-1 rounded text-muted-foreground/40 hover:text-primary transition-colors" title="AYZEN Mail">
            <AtSign className="w-3.5 h-3.5" />
          </button>
          <button onClick={openSearch} className="p-1 rounded text-muted-foreground/40 hover:text-primary transition-colors" title="Search (⌘K)">
            <Search className="w-3.5 h-3.5" />
          </button>
          <button onClick={openShortcuts} className="p-1 rounded text-muted-foreground/40 hover:text-primary transition-colors" title="Keyboard shortcuts (?)">
            <Keyboard className="w-3.5 h-3.5" />
          </button>
          <button onClick={toggleTheme} className="p-1 rounded text-muted-foreground/40 hover:text-primary transition-colors" title="Toggle theme">
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Profile quick-access at top — click to expand settings/system links */}
      <ProfileQuickAccess user={user} logout={logout} navigate={navigate} onNavigate={onNavigate} />

      {/* Nav groups */}
      <div className="flex-1 overflow-y-auto py-2 space-y-1">
        {groups.map(group => (
          <NavGroupComp key={group.label} group={group} location={location} search={search} isEnabled={isEnabled} onNavigate={onNavigate} />
        ))}

        {/* Admin-only: dynamic project list sidebar section */}
        {(isAdmin || isDev) && (
          <AdminProjectsSidebarSection onNavigate={onNavigate} location={location} />
        )}

      </div>

      <SidebarAiPanel />
    </div>
  );
}
