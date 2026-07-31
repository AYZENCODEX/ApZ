# AYZEN — Crypto Airdrop Command Center

## Project Overview
AYZEN is a professional crypto airdrop operator platform. It lets users track airdrops, manage vault entities (accounts, wallets, KYC, 2FA), complete tasks, and analyze wallet performance across 20+ chains.

## Architecture
This is a **pnpm monorepo** with three artifacts:

| Artifact | Dir | Purpose |
|----------|-----|---------|
| `ayzen` (web) | `artifacts/ayzen` | React + Vite frontend (Tailwind, shadcn/ui, Wouter routing) |
| `api-server` (api) | `artifacts/api-server` | Express 5 backend (pino logging, JWT auth, Drizzle ORM) |
| `mockup-sandbox` (design) | `artifacts/mockup-sandbox` | Component preview server (design canvas only) |

Shared libraries live under `lib/`:
- `lib/db` — Drizzle ORM schema + DB connection (PostgreSQL via `DATABASE_URL`)
- `lib/api-zod` — shared Zod schemas / API types
- `lib/api-client-react` — React Query hooks + `customFetch` for all API calls

## How to Run
Workflows are configured and auto-start:
- **Frontend**: `pnpm --filter @workspace/ayzen run dev` → port from `$PORT`
- **API Server**: `pnpm --filter @workspace/api-server run dev` → port 8080

The API server builds then starts (`build.mjs` → `dist/index.mjs`). DB migrations run automatically on boot.

## Environment Secrets Required
| Secret | Purpose |
|--------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Supabase (auth + storage) |
| `VAULT_FIELD_ENCRYPTION_KEY`, `PHRASE_ENCRYPTION_KEY` | Vault credential encryption at rest |
| `TELEGRAM_BOT_TOKEN` | Telegram bot integration |
| `RESEND_API_KEY` | Transactional email via Resend |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` | AI features |
| `CLOUDFLARE_API_KEY` | Cloudflare integration |

## Key Conventions
- All routes are defined in `artifacts/ayzen/src/lib/route-config.tsx` — add a page by adding one entry there
- Vault sidebar sections are in `artifacts/ayzen/src/components/layout/vault-sidebar.tsx`
- DB migrations are append-only `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements in `artifacts/api-server/src/index.ts` (`MIGRATIONS` array)
- Sensitive vault fields are encrypted at rest via `lib/vault-crypto.ts` using `VAULT_FIELD_ENCRYPTION_KEY`
- API routes are split by domain in `artifacts/api-server/src/routes/`

## User Preferences
- Keep existing project structure and conventions — no restructuring unless asked
- Migrations are always `IF NOT EXISTS` to be safe on re-boot
