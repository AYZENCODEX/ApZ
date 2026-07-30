/**
 * App.tsx
 * ─────────────────────────────────────────────
 * Drop this at: artifacts/ayzen/src/App.tsx
 *
 * Router() is now driven by ADMIN_ROUTES / USER_ROUTES arrays.
 * To add a new page: edit lib/route-config.tsx only — this file stays clean.
 */

import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { PluginsProvider } from "@/hooks/use-plugins";
import { DevNavProvider } from "@/hooks/use-dev-nav";
import { UiThemeProvider, ThemeRouteSync } from "@/hooks/use-ui-theme";
import { CustomButtonsProvider } from "@/hooks/use-custom-buttons";
import { AppLayout } from "@/components/layout/app-layout";
import { VaultUnlockGate } from "@/components/vault/vault-unlock-gate";
import { useRealtime } from "@/hooks/use-realtime";
import { ScrollToTop } from "@/components/scroll-to-top";
import { ErrorBoundary } from "@/components/error-boundary";
import { ADMIN_ROUTES, USER_ROUTES } from "@/lib/route-config";
import type { RouteConfig } from "@/lib/route-config";

// ─── Overlay components (lazy — not on initial paint) ─────────────────────────

const AiChat          = lazy(() => import("@/components/ai-chat").then(m => ({ default: m.AiChat })));
const CommandSearch   = lazy(() => import("@/components/command-search").then(m => ({ default: m.CommandSearch })));
const KeyboardShortcuts = lazy(() => import("@/components/keyboard-shortcuts").then(m => ({ default: m.KeyboardShortcuts })));
const CustomButtonsOverlay = lazy(() => import("@/components/custom-buttons-overlay").then(m => ({ default: m.CustomButtonsOverlay })));

// ─── Auth pages — eager (users hit these before bundle splits matter) ─────────

import Login          from "@/pages/login";
import StatusPage     from "@/pages/status";
import Register       from "@/pages/register";
import ForgotPassword from "@/pages/forgot-password";
import Landing        from "@/pages/landing";
import NotFound       from "@/pages/not-found";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PageLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="font-mono text-xs text-muted-foreground/50 animate-pulse tracking-widest uppercase">
        Loading...
      </div>
    </div>
  );
}

function ProtectedRoute({
  component: Component,
  adminOnly = false,
  allowedRoles,
  vaultGated = false,
  ...rest
}: Omit<RouteConfig, "path"> & { vaultGated?: boolean; [k: string]: any }) {
  const { user, isAdmin, isDev, isLoading } = useAuth();

  if (isLoading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-primary font-mono">
        INITIALIZING...
      </div>
    );
  if (!user)           return <Redirect to="/login" />;
  if (adminOnly && !isAdmin && !isDev) return <Redirect to="/dashboard" />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Redirect to="/dashboard" />;

  const page = (
    <Suspense fallback={<PageLoader />}>
      <Component {...rest} />
    </Suspense>
  );

  return (
    <AppLayout>
      {/* Phase 5 — Vault Security: every /vault/* route unlocks behind the
          vault-login PIN before its page mounts (see route mapping below). */}
      {vaultGated ? <VaultUnlockGate>{page}</VaultUnlockGate> : page}
    </AppLayout>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

function Router() {
  const { user, isAdmin, isDev, isModerator, isTeamLeader } = useAuth();

  return (
    <Switch>
      {/* Root redirect — role-based */}
      <Route path="/">
        {user
          ? (isAdmin || isDev)  ? <Redirect to="/admin/dashboard" />
          : isModerator         ? <Redirect to="/dashboard" />
          : isTeamLeader        ? <Redirect to="/teams" />
                                : <Redirect to="/home" />
          : <Landing />}
      </Route>

      {/* Public */}
      <Route path="/login"           component={Login} />
      <Route path="/register"        component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/status"          component={StatusPage} />

      {/* Legacy NFT redirect */}
      <Route path="/nft-marketplace">
        {() => { window.location.replace("/marketplace?tab=nft"); return null; }}
      </Route>

      {/* Admin + Dev routes — from config */}
      {ADMIN_ROUTES.map(({ path, component, adminOnly, allowedRoles }) => (
        <Route key={path} path={path}>
          {() => (
            <ProtectedRoute
              component={component}
              adminOnly={adminOnly}
              allowedRoles={allowedRoles}
            />
          )}
        </Route>
      ))}

      {/* User routes — from config */}
      {USER_ROUTES.map(({ path, component }) => (
        <Route key={path} path={path}>
          {/* Phase 5 — Vault Security: any /vault/* path (the whole Vault
              section — Entity/Wallet/Local/Mail/KYC/Game tabs, and the
              Enroll/Security/Backup/Shared sidebar from Phase 4) unlocks
              behind the vault-login PIN. Note this is a distinct PIN and
              gate from EntityPinGate, which guards individual entity detail
              pages (see components/vault/entity-pin-gate.tsx). */}
          {() => <ProtectedRoute component={component} vaultGated={path.startsWith("/vault")} />}
        </Route>
      ))}

      <Route component={NotFound} />
    </Switch>
  );
}

// ─── Query client ─────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// ─── Providers ────────────────────────────────────────────────────────────────

function RealtimeProvider({ children }: { children: React.ReactNode }) {
  useRealtime();
  return <>{children}</>;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  useEffect(() => {
    const saved = localStorage.getItem("ayzen_theme");
    document.documentElement.classList.toggle("dark", saved !== "light");
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <UiThemeProvider>
              <CustomButtonsProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <ThemeRouteSync />
                <PluginsProvider>
                  <DevNavProvider>
                    <RealtimeProvider>
                      <ErrorBoundary>
                        <Router />
                      </ErrorBoundary>
                      <Suspense fallback={null}>
                        <AiChat />
                        <CommandSearch />
                        <KeyboardShortcuts />
                        <CustomButtonsOverlay />
                      </Suspense>
                      <ScrollToTop />
                    </RealtimeProvider>
                  </DevNavProvider>
                </PluginsProvider>
              </WouterRouter>
              </CustomButtonsProvider>
            </UiThemeProvider>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
