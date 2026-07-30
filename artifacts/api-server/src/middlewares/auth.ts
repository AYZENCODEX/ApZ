/**
 * middlewares/auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this at: artifacts/api-server/src/middlewares/auth.ts
 *
 * SECURITY FIXES applied:
 *  1. getRequestUser() — removed the fallback that parsed an unverified base64
 *     token and blindly trusted the role field inside it. An attacker could
 *     craft  btoa('{"userId":1,"role":"admin"}')  and bypass role checks on
 *     any route that called getRequestUser() without requireAuth middleware.
 *     Now it ONLY returns req.user (set by a middleware after a DB lookup).
 *
 *  2. getRequestUserId() — same fix; returns null instead of a forged userId.
 *
 * HOW AUTH WORKS IN AYZEN (reminder):
 *  requireAuth / requireAdmin / requireDev / requireRoles
 *    → call getUserFromToken() [auth-utils.ts]
 *    → verifies JWT or legacy base64 token + re-reads role from DB
 *    → sets req.user = { userId, role }
 *  Route handlers then call getRequestUser(req) or req.user directly.
 *  Nothing in a route handler should ever parse the raw token itself.
 */

import type { Request, Response, NextFunction } from "express";
import { getTokenFromReq, getUserFromToken } from "../lib/auth-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  userId: number;
  role: string;
  /** How this request was authenticated. "apikey" = AYZEN developer API key. */
  authType?: "session" | "apikey" | "legacy";
  /** Only set when authType === "apikey". "full" = no restriction. "scoped" = limited to `scopes`. */
  keyType?: "full" | "scoped";
  /** Only meaningful when keyType === "scoped". Scope ids from lib/api-scopes.ts. */
  scopes?: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getTokenFromReq(req);
  if (!token) {
    res.status(401).json({
      error: "Unauthorized",
      code: "NO_TOKEN",
      solution: "Include a valid Authorization: Bearer <token> header.",
    });
    return;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({
      error: "Unauthorized",
      code: "INVALID_TOKEN",
      solution: "Token is invalid or expired. Please log in again.",
    });
    return;
  }
  req.user = user;
  next();
}

/**
 * Like requireAuth, but rejects requests authenticated via an AYZEN API key.
 * Use this on the API-key management routes themselves (create/rotate/revoke)
 * so a leaked key can never be used to mint itself more keys or lock the
 * real owner out — managing keys always requires a real login session.
 */
export async function requireSessionAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getTokenFromReq(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized", code: "NO_TOKEN", solution: "Include a valid Authorization: Bearer <token> header." });
    return;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized", code: "INVALID_TOKEN", solution: "Token is invalid or expired. Please log in again." });
    return;
  }
  if (user.authType === "apikey") {
    res.status(403).json({
      error: "Forbidden",
      code: "SESSION_REQUIRED",
      solution: "This action requires a real login session, not an API key. Log in via the app to manage your API keys.",
    });
    return;
  }
  req.user = user;
  next();
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getTokenFromReq(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized", code: "NO_TOKEN", solution: "Include a valid Authorization: Bearer <token> header." });
    return;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized", code: "INVALID_TOKEN", solution: "Token is invalid or expired. Please log in again." });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Forbidden", code: "NOT_ADMIN", solution: "This action requires admin privileges." });
    return;
  }
  req.user = user;
  next();
}

export async function requireDev(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getTokenFromReq(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized", code: "NO_TOKEN", solution: "Include a valid Authorization: Bearer <token> header." });
    return;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized", code: "INVALID_TOKEN", solution: "Token is invalid or expired. Please log in again." });
    return;
  }
  if (user.role !== "dev" && user.role !== "admin") {
    res.status(403).json({ error: "Forbidden", code: "NOT_DEV", solution: "This action requires developer privileges." });
    return;
  }
  req.user = user;
  next();
}

export function requireRoles(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = getTokenFromReq(req);
    if (!token) {
      res.status(401).json({ error: "Unauthorized", code: "NO_TOKEN", solution: "Include a valid Authorization: Bearer <token> header." });
      return;
    }
    const user = await getUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: "Unauthorized", code: "INVALID_TOKEN", solution: "Token is invalid or expired. Please log in again." });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({
        error: "Forbidden",
        code: "NOT_ALLOWED",
        solution: `This action requires one of these roles: ${roles.join(", ")}.`,
      });
      return;
    }
    req.user = user;
    next();
  };
}

// ─── Route-level helpers ──────────────────────────────────────────────────────

/**
 * Returns the authenticated user set by a middleware (requireAuth etc.).
 * Returns null if no middleware ran — does NOT fall back to parsing the raw
 * token, because doing so would trust an unverified, forgeable role field.
 *
 * Always use a requireAuth/requireAdmin/requireRoles middleware BEFORE calling
 * this in your route handler.
 */
export function getRequestUser(req: Request): AuthUser | null {
  // FIX: only trust req.user set by verified middleware — no raw token fallback
  return req.user ?? null;
}

/**
 * Returns the authenticated user's ID, or null if not authenticated.
 * Never returns a fallback ID — callers must handle null explicitly.
 */
export function getRequestUserId(req: Request): number | null {
  return req.user?.userId ?? null;
}
