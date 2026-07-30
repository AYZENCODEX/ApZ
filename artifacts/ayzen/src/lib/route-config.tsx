/**
 * route-config.tsx
 * ─────────────────────────────────────────────
 * Single source of truth for ALL authenticated routes.
 * Adding a new page = one object here, nothing else.
 *
 * Drop this file at:
 *   artifacts/ayzen/src/lib/route-config.tsx
 */

import { lazy } from "react";
import type { LazyExoticComponent, ComponentType } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnyComponent = LazyExoticComponent<ComponentType<any>>;

export interface RouteConfig {
  path: string;
  component: AnyComponent;
  /** adminOnly=true  →  only 'admin' | 'dev' roles pass */
  adminOnly?: boolean;
  /** allowedRoles overrides adminOnly when present */
  allowedRoles?: string[];
}

// ─── Admin lazy imports ───────────────────────────────────────────────────────

const AdminDashboard     = lazy(() => import("@/pages/admin/dashboard"));
const AdminUsers         = lazy(() => import("@/pages/admin/users"));
const AdminProjects      = lazy(() => import("@/pages/admin/projects"));
const AdminProjectDetail = lazy(() => import("@/pages/admin/project-detail"));
const AdminTasks         = lazy(() => import("@/pages/admin/tasks"));
const AdminGas           = lazy(() => import("@/pages/admin/tools/gas"));
const AdminWallet        = lazy(() => import("@/pages/admin/tools/wallet"));
const AdminRevenue       = lazy(() => import("@/pages/admin/revenue"));
const AdminStreak        = lazy(() => import("@/pages/admin/tools/streak"));
const AdminNetworks      = lazy(() => import("@/pages/admin/tools/networks"));
const AdminBroadcast     = lazy(() => import("@/pages/admin/broadcast"));
const AdminLeaderboard   = lazy(() => import("@/pages/admin/leaderboard"));
const AdminVault         = lazy(() => import("@/pages/admin/vault"));
const AdminPlugins       = lazy(() => import("@/pages/admin/plugins"));
const AdminSettings      = lazy(() => import("@/pages/admin/settings"));
const AdminDeveloper     = lazy(() => import("@/pages/admin/developer"));
const AdminSupport       = lazy(() => import("@/pages/admin/support"));
const AdminReferrals     = lazy(() => import("@/pages/admin/referrals"));
const AdminCreditsPage   = lazy(() => import("@/pages/admin/credits"));
const AdminSubscriptions = lazy(() => import("@/pages/admin/subscriptions"));
const AdminActivity      = lazy(() => import("@/pages/admin/activity"));
const AdminCategories    = lazy(() => import("@/pages/admin/categories"));
const AdminHealthRules   = lazy(() => import("@/pages/admin/health-rules"));
const AdminTeams         = lazy(() => import("@/pages/admin/teams"));
const AdminTeamVault     = lazy(() => import("@/pages/admin/team-vault"));
const AdminMarketplace   = lazy(() => import("@/pages/admin/marketplace"));
const AdminAiAgent       = lazy(() => import("@/pages/admin/ai-agent"));
const AdminMcpAgents     = lazy(() => import("@/pages/admin/mcp-agents"));
const AdminKeyManager    = lazy(() => import("@/pages/admin/key-manager"));
const AdminDevNavBuilder = lazy(() => import("@/pages/admin/dev-nav-builder"));
const AdminMarketplaceCategories = lazy(() => import("@/pages/admin/marketplace-categories"));
const AdminMarketplaceMarketConfig = lazy(() => import("@/pages/admin/marketplace-market-config"));
const AdminConfigManager = lazy(() => import("@/pages/admin/config-manager"));
const AdminLayoutBuilder = lazy(() => import("@/pages/admin/layout-builder"));
const AdminThemeStudio   = lazy(() => import("@/pages/admin/theme-studio"));
const AdminCustomButtons = lazy(() => import("@/pages/admin/custom-buttons"));
const AdminOperatorProgress = lazy(() => import("@/pages/admin/operator-progress"));

// ─── Dev lazy imports ────────────────────────────────────────────────────────

const DevAznDeploy = lazy(() => import("@/pages/dev/azn-deploy"));
const DevCustomPage = lazy(() => import("@/pages/dev/custom-page"));
// Same blank-page component, one navType-scoped wrapper each — see
// Sidebar Builder tabs (User/Admin/Moderator/Team Leader), mirrors Dev's.
const UserCustomPage = lazy(() => import("@/pages/user/custom-page"));
const AdminNavCustomPage = lazy(() => import("@/pages/admin/custom-page"));
const ModeratorCustomPage = lazy(() => import("@/pages/moderator/custom-page"));
const TeamLeaderCustomPage = lazy(() => import("@/pages/team-leader/custom-page"));

// ─── User lazy imports ────────────────────────────────────────────────────────

const UserHome          = lazy(() => import("@/pages/user/home"));
const UserDashboard     = lazy(() => import("@/pages/user/dashboard"));
const UserProjects      = lazy(() => import("@/pages/user/projects"));
const UserProjectCompare = lazy(() => import("@/pages/user/project-compare"));
const UserProjectDetail = lazy(() => import("@/pages/user/project-detail"));
const UserProjectEntities = lazy(() => import("@/pages/user/project-entities"));
const UserTasks         = lazy(() => import("@/pages/user/tasks"));
const UserVault         = lazy(() => import("@/pages/user/vault"));
const VaultEntityDetail = lazy(() => import("@/pages/user/vault-entity-detail"));
const VaultEntityAccess = lazy(() => import("@/pages/user/vault-entity-access"));
const VaultLocalDetail  = lazy(() => import("@/pages/user/vault-local-detail"));
const VaultKycDetail    = lazy(() => import("@/pages/user/vault-kyc-detail"));
const VaultMailInbox    = lazy(() => import("@/pages/user/vault-mail-inbox"));
const VaultMailMessage  = lazy(() => import("@/pages/user/vault-mail-message"));
const VaultTwoFaCategory     = lazy(() => import("@/pages/user/vault-2fa-category"));
const VaultTwoFaEntity       = lazy(() => import("@/pages/user/vault-2fa-entity"));
const VaultMailCategory      = lazy(() => import("@/pages/user/vault-mail-category"));
const VaultMailEntity        = lazy(() => import("@/pages/user/vault-mail-entity"));
const VaultMailMessageDetail = lazy(() => import("@/pages/user/vault-mail-message-detail"));
// Phase 4 — Vault Sidebar Restructure (Enroll / Security / Backup / Shared)
const VaultEnroll       = lazy(() => import("@/pages/user/vault-enroll"));
const VaultSecurity     = lazy(() => import("@/pages/user/vault-security"));
const VaultBackup       = lazy(() => import("@/pages/user/vault-backup"));
const VaultShared       = lazy(() => import("@/pages/user/vault-shared"));
const VaultBanned       = lazy(() => import("@/pages/user/vault-banned"));
// Phase 9A — Enroll sidebar shell (Projects Overview; Entities placeholder
// until Phase 10A wires it up)
const EnrollProjects    = lazy(() => import("@/pages/user/enroll-projects"));
const EnrollEntities    = lazy(() => import("@/pages/user/enroll-entities"));
// Phase 9B — per-project dedicated dashboard (own URL, deep-linkable,
// separate from the submission-flow UserProjectDetail above)
const ProjectDashboard  = lazy(() => import("@/pages/user/project-dashboard"));
// Phase 10B — per-entity dedicated dashboard, reusing EntityDashboardTabs
const EntityDashboard   = lazy(() => import("@/pages/user/entity-dashboard"));
const UserLeaderboard   = lazy(() => import("@/pages/user/leaderboard"));
const UserInbox         = lazy(() => import("@/pages/user/inbox"));
const Authenticator     = lazy(() => import("@/pages/user/authenticator"));
const AyzenEmail        = lazy(() => import("@/pages/user/ayzen-email"));
const UserProfile       = lazy(() => import("@/pages/user/profile"));
const EmailAccounts     = lazy(() => import("@/pages/user/email-accounts"));
const UserSupport       = lazy(() => import("@/pages/user/support"));
const UserReferrals     = lazy(() => import("@/pages/user/referrals"));
const UserSettings      = lazy(() => import("@/pages/user/settings"));
const UserSecurity      = lazy(() => import("@/pages/user/security"));
const UserWallets       = lazy(() => import("@/pages/user/wallets"));
const SubscriptionPage  = lazy(() => import("@/pages/user/subscription"));
const CreditsPage       = lazy(() => import("@/pages/user/credits"));
const UserHistory       = lazy(() => import("@/pages/user/history"));
const EarnPage          = lazy(() => import("@/pages/user/earn"));
const CalculatorPage    = lazy(() => import("@/pages/user/calculator"));
const TeamsPage         = lazy(() => import("@/pages/user/teams"));
const ContentPage       = lazy(() => import("@/pages/user/content"));
const WalletHub         = lazy(() => import("@/pages/user/wallet-hub"));
const Marketplace       = lazy(() => import("@/pages/user/marketplace"));
const MarketplaceAzn    = lazy(() => import("@/pages/user/marketplace-azn"));
const MarketplaceNft    = lazy(() => import("@/pages/user/marketplace-nft"));
const MarketplaceVault  = lazy(() => import("@/pages/user/marketplace-vault"));
const MarketplaceGame   = lazy(() => import("@/pages/user/marketplace-game"));
const MarketplaceWallet = lazy(() => import("@/pages/user/marketplace-wallet"));
const MarketplaceSpot   = lazy(() => import("@/pages/user/marketplace-spot"));
const MarketplaceStaking = lazy(() => import("@/pages/user/marketplace-staking"));
const MarketplacePolymarket = lazy(() => import("@/pages/user/marketplace-polymarket"));
const MarketplaceOrderHistory = lazy(() => import("@/pages/user/marketplace-order-history"));
const CheckinPage       = lazy(() => import("@/pages/user/checkin"));
const WatchlistPage     = lazy(() => import("@/pages/user/watchlist"));
const NftMarketplace    = lazy(() => import("@/pages/user/nft-marketplace"));

// ─── Route config arrays ──────────────────────────────────────────────────────

export const ADMIN_ROUTES: RouteConfig[] = [
  { path: "/admin/dashboard",       component: AdminDashboard,     adminOnly: true },
  { path: "/admin/users",           component: AdminUsers,         adminOnly: true },
  { path: "/admin/projects",              component: AdminProjects,        allowedRoles: ["admin", "dev", "moderator"] },
  { path: "/admin/projects/:id",         component: AdminProjectDetail,   adminOnly: true },
  { path: "/admin/operator-progress",    component: AdminOperatorProgress, adminOnly: true },
  { path: "/admin/tasks",           component: AdminTasks,         allowedRoles: ["admin", "dev", "moderator"] },
  { path: "/admin/tools/gas",       component: AdminGas,           adminOnly: true },
  { path: "/admin/tools/wallet",    component: AdminWallet,        adminOnly: true },
  { path: "/admin/revenue",         component: AdminRevenue,       adminOnly: true },
  { path: "/admin/tools/streak",    component: AdminStreak,        adminOnly: true },
  { path: "/admin/tools/networks",  component: AdminNetworks,      adminOnly: true },
  { path: "/admin/broadcast",       component: AdminBroadcast,     adminOnly: true },
  { path: "/admin/leaderboard",     component: AdminLeaderboard,   adminOnly: true },
  { path: "/admin/vault",           component: AdminVault,         adminOnly: true },
  { path: "/admin/plugins",         component: AdminPlugins,       adminOnly: true },
  { path: "/admin/settings",        component: AdminSettings,      adminOnly: true },
  { path: "/admin/developer",       component: AdminDeveloper,     allowedRoles: ["admin", "dev"] },
  { path: "/admin/support",         component: AdminSupport,       adminOnly: true },
  { path: "/admin/referrals",       component: AdminReferrals,     adminOnly: true },
  { path: "/admin/credits",         component: AdminCreditsPage,   adminOnly: true },
  { path: "/admin/subscriptions",   component: AdminSubscriptions, adminOnly: true },
  { path: "/admin/activity",        component: AdminActivity,      adminOnly: true },
  { path: "/admin/categories",      component: AdminCategories,    adminOnly: true },
  { path: "/admin/health-rules",    component: AdminHealthRules,   adminOnly: true },
  { path: "/admin/teams",           component: AdminTeams,         allowedRoles: ["admin", "dev", "moderator"] },
  { path: "/admin/team-vault",      component: AdminTeamVault,     adminOnly: true },
  { path: "/admin/marketplace",     component: AdminMarketplace,   allowedRoles: ["admin", "dev"] },
  { path: "/admin/ai-agent",        component: AdminAiAgent,       allowedRoles: ["dev"] },
  { path: "/admin/mcp-agents",      component: AdminMcpAgents,     allowedRoles: ["dev"] },
  { path: "/admin/key-manager",     component: AdminKeyManager,    allowedRoles: ["admin"] },
  { path: "/admin/dev-nav-builder", component: AdminDevNavBuilder, allowedRoles: ["dev", "admin"] },
  { path: "/admin/marketplace-categories", component: AdminMarketplaceCategories, allowedRoles: ["dev", "admin"] },
  { path: "/admin/marketplace-market-config", component: AdminMarketplaceMarketConfig, allowedRoles: ["dev", "admin"] },
  { path: "/admin/config-manager", component: AdminConfigManager, allowedRoles: ["dev", "admin"] },
  { path: "/admin/layout-builder", component: AdminLayoutBuilder, allowedRoles: ["dev", "admin"] },
  { path: "/admin/theme-studio",    component: AdminThemeStudio,   allowedRoles: ["dev", "admin"] },
  { path: "/admin/custom-buttons",  component: AdminCustomButtons, allowedRoles: ["dev", "admin"] },
  // Dev panel (grouped with admin for convenience)
  { path: "/dev/azn-deploy",        component: DevAznDeploy,       allowedRoles: ["dev", "admin"] },
  // Catch-all landing pages for sidebar entries added from the Sidebar
  // Builder that don't point at an existing route — keep these last.
  { path: "/dev/custom/:slug",         component: DevCustomPage,          allowedRoles: ["dev", "admin"] },
  { path: "/admin/custom/:slug",       component: AdminNavCustomPage,     allowedRoles: ["dev", "admin"] },
  { path: "/moderator/custom/:slug",   component: ModeratorCustomPage,    allowedRoles: ["dev", "admin", "moderator"] },
  { path: "/team_leader/custom/:slug", component: TeamLeaderCustomPage,   allowedRoles: ["dev", "admin", "team_leader"] },
];

export const USER_ROUTES: RouteConfig[] = [
  // Core
  { path: "/home",               component: UserHome },
  { path: "/dashboard",          component: UserDashboard },
  { path: "/profile",            component: UserProfile },
  { path: "/settings",           component: UserSettings },
  { path: "/security",           component: UserSecurity },
  // Tasks & Projects
  { path: "/projects",           component: UserProjects },
  // Phase 6 — must be registered before "/projects/:id" (wouter Switch is
  // first-match-wins, and ":id" would otherwise swallow "compare").
  { path: "/projects/compare",   component: UserProjectCompare },
  { path: "/projects/:id",       component: UserProjectDetail },
  { path: "/tasks",              component: UserTasks },
  // Gamification
  { path: "/leaderboard",        component: UserLeaderboard },
  { path: "/vault",              component: UserVault },
  // Phase 4 — Vault Sidebar Restructure (Enroll / Security / Backup / Shared)
  { path: "/vault/enroll",       component: VaultEnroll },
  { path: "/vault/security",     component: VaultSecurity },
  { path: "/vault/backup",       component: VaultBackup },
  { path: "/vault/shared",       component: VaultShared },
  { path: "/vault/banned",       component: VaultBanned },
  { path: "/vault/projects",     component: UserProjectEntities },
  { path: "/vault/entity/:id/access", component: VaultEntityAccess },
  { path: "/vault/entity/:id",   component: VaultEntityDetail },
  { path: "/vault/local/:id",    component: VaultLocalDetail },
  { path: "/vault/kyc/:id",      component: VaultKycDetail },
  { path: "/vault/2fa/:category/:id", component: VaultTwoFaEntity },
  { path: "/vault/2fa/:category",     component: VaultTwoFaCategory },
  { path: "/vault/mail-hub/:category/:id/mail/:msgId", component: VaultMailMessageDetail },
  { path: "/vault/mail-hub/:category/:id", component: VaultMailEntity },
  { path: "/vault/mail-hub/:category",     component: VaultMailCategory },
  { path: "/vault/mail/:accountId/:seqno", component: VaultMailMessage },
  { path: "/vault/mail/:accountId",        component: VaultMailInbox },
  // Phase 9A — Enroll sidebar shell (new area, separate from Vault's own
  // sidebar). "/enroll/projects" must come before nothing in particular here
  // since both are literal, single-segment-after-root paths — order is just
  // for readability, grouped with the rest of the enrollment surfaces above.
  { path: "/enroll/projects",    component: EnrollProjects },
  // Phase 9B — per-project dedicated dashboard, opened from the 9A project
  // list. Segment count differs from "/enroll/projects" above so match
  // order between the two doesn't matter, but kept adjacent for readability.
  { path: "/enroll/projects/:id", component: ProjectDashboard },
  { path: "/enroll/entities",    component: EnrollEntities },
  // Phase 10B — per-entity dedicated dashboard, opened from the 10A entity
  // list. Segment count differs from "/enroll/entities" above so match
  // order between the two doesn't matter, but kept adjacent for readability.
  { path: "/enroll/entities/:id", component: EntityDashboard },
  { path: "/checkin",            component: CheckinPage },
  { path: "/watchlist",          component: WatchlistPage },
  { path: "/earn",               component: EarnPage },
  { path: "/calculator",         component: CalculatorPage },
  { path: "/history",            component: UserHistory },
  // Social
  { path: "/teams",              component: TeamsPage },
  { path: "/inbox",              component: UserInbox },
  { path: "/content",            component: ContentPage },
  // Finance
  { path: "/wallet",             component: WalletHub },
  { path: "/wallets",            component: UserWallets },
  { path: "/credits",            component: CreditsPage },
  { path: "/subscription",       component: SubscriptionPage },
  { path: "/referrals",          component: UserReferrals },
  // Marketplace
  { path: "/marketplace/p2p",           component: MarketplaceAzn },
  { path: "/marketplace/vault",         component: MarketplaceVault },
  { path: "/marketplace/game",          component: MarketplaceGame },
  { path: "/marketplace/wallet",        component: MarketplaceWallet },
  { path: "/marketplace/spot",          component: MarketplaceSpot },
  { path: "/marketplace/staking",       component: MarketplaceStaking },
  { path: "/marketplace/polymarket",    component: MarketplacePolymarket },
  { path: "/marketplace/order-history", component: MarketplaceOrderHistory },
  { path: "/marketplace",               component: Marketplace },           // keep last (catch-all)
  // Tools & Email
  { path: "/authenticator",      component: Authenticator },
  { path: "/ayzen-email",        component: AyzenEmail },
  { path: "/email-accounts",     component: EmailAccounts },
  // Support
  { path: "/support",            component: UserSupport },
  // Catch-all landing page for sidebar entries added from the User tab of
  // the Sidebar Builder that don't point at an existing route — keep last.
  { path: "/user/custom/:slug",  component: UserCustomPage },
];

// ─── Page list for the per-page theme/layout override picker ──────────────────
// Derived from the same ADMIN_ROUTES/USER_ROUTES arrays used for routing, so
// this list can never drift out of sync with the actual pages in the app.

export interface PageListEntry { path: string; label: string; group: "admin" | "user" }

function labelFromPath(path: string): string {
  const segs = path.split("/").filter(Boolean).filter(s => !s.startsWith(":"));
  if (segs.length === 0) return "Home";
  return segs.map(s => s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(" › ");
}

export const PAGE_LIST: PageListEntry[] = [
  ...ADMIN_ROUTES.map(r => ({ path: r.path, label: labelFromPath(r.path), group: "admin" as const })),
  ...USER_ROUTES.map(r => ({ path: r.path, label: labelFromPath(r.path), group: "user" as const })),
];

/** Matches a concrete pathname (e.g. "/projects/42") against a route pattern
 *  (e.g. "/projects/:id") — same segment count, literal segments must match
 *  exactly, ":param" segments match anything. */
export function matchesPagePattern(pattern: string, pathname: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const a = pathname.split("/").filter(Boolean);
  if (p.length !== a.length) return false;
  return p.every((seg, i) => seg.startsWith(":") || seg === a[i]);
}

/** Picks the best-matching override page key for a pathname. Exact literal
 *  matches win over dynamic (":id") ones so "/vault" isn't shadowed by a
 *  looser pattern, then falls back to the first dynamic match. */
export function findBestPageMatch(pageKeys: string[], pathname: string): string | null {
  const candidates = pageKeys.filter(k => matchesPagePattern(k, pathname));
  if (candidates.length === 0) return null;
  const exact = candidates.find(k => !k.includes(":"));
  return exact ?? candidates[0];
}
