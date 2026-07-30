# AYZEN — Crypto Airdrop Platform

A professional crypto airdrop command center: track projects, complete tasks, manage encrypted vault entities, analyze wallets across 20+ chains, and maximize ROI — all in one platform.

## Run & Operate

- `pnpm --filter @workspace/ayzen run dev` — run the frontend (port 23325, served at `/`)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, served at `/api`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, shadcn/ui, Tailwind CSS v4, Recharts, wouter, TanStack Query
- API: Express 5, pino logging
- DB: PostgreSQL (Supabase) + Drizzle ORM — schema auto-migrated on API startup via MIGRATIONS array in `src/index.ts`
- Auth: JWT + bcrypt, optional TOTP 2FA
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- External: Telegram bot, Resend email, Groq/OpenRouter AI, Cloudflare

## Where things live

- `artifacts/ayzen/src/pages/` — all frontend pages (user/, admin/, moderator/, team-leader/)
- `artifacts/ayzen/src/components/` — shared components (vault/, layout/, ui/)
- `artifacts/api-server/src/routes/` — all API route handlers (80+ route files)
- `artifacts/api-server/src/index.ts` — startup + MIGRATIONS array (auto-applied on start)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema/` — Drizzle schema files
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)

## Architecture decisions

- **All 15 vault/project/team phases implemented** — Phases 1–15 from the phased implementation plan are complete. See `attached_assets/AYZEN_phased_implementation_prompts_1785435451619.md`.
- **Schema migrations via MIGRATIONS array** — The API server applies `ALTER TABLE / CREATE TABLE IF NOT EXISTS` statements on every startup, making the DB self-healing without a separate migration runner.
- **Supabase Postgres** — `DATABASE_URL` points to Supabase; the DB lib auto-detects Supabase hostnames and forces SSL + session pooler (port 5432).
- **imap externalized in esbuild** — `imap` and `imap-simple` are marked external in `build.mjs` so they load from node_modules at runtime rather than being bundled.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After editing `build.mjs` externals, always restart the API Server workflow.
- The `imap` package must remain in `dependencies` (not devDependencies) — it is externalized by esbuild and loaded at runtime.
- `DATABASE_URL` must use Supabase's session pooler port (5432), not the transaction pooler (6543).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
