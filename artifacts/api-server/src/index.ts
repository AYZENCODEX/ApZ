import app from "./app";
import { logger } from "./lib/logger";
import { logBus } from "./lib/log-bus";
import { initTelegramBot, stopTelegramBot } from "./lib/telegram";
import { startUptimeBot } from "./services/uptime-bot";
import { startVaultHealthCron } from "./lib/vault-health-cron";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["AYZEN_API_PORT"] ?? process.env["PORT"] ?? "8080";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid port value: "${rawPort}"`);
}

const MIGRATIONS = [
  "CREATE TABLE IF NOT EXISTS local_accounts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'Other', label TEXT, username TEXT, email TEXT, password TEXT, recovery_email TEXT, recovery_email_password TEXT, backup_codes TEXT, twofa TEXT, recovery_email_twofa TEXT, followers TEXT, account_worth REAL DEFAULT 0, buy_price REAL DEFAULT 0, account_create_date TIMESTAMP, account_buy_date TIMESTAMP, account_last_login_date TIMESTAMP, notes TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())",
  "CREATE TABLE IF NOT EXISTS local_account_categories (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW())",
  // KYC entities — same shape as local_accounts (fixed category list, not
  // user-managed) plus KYC Info (nid/name/father/birthdate) and Seller
  // (platform, buy price, location, connection, contact, buy date, paid,
  // seller name, social account) fields. See config/vault-kyc.ts and
  // config/fields/kyc-create.ts on the frontend.
  "CREATE TABLE IF NOT EXISTS kyc_entries (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'Other', username TEXT, account_password TEXT, notes TEXT, email TEXT, email_password TEXT, email_2fa TEXT, email_backup_code TEXT, nid_number TEXT, name TEXT, father_name TEXT, birth_date TIMESTAMP, platform TEXT, buy_price REAL DEFAULT 0, location TEXT, connection TEXT, contact_number TEXT, buy_date TIMESTAMP, paid BOOLEAN NOT NULL DEFAULT FALSE, seller_name TEXT, social_account TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())",
  // KYC · Info photo pair (front/back ID photos), stored as data-URLs — see
  // config/fields/kyc-create.ts photo1Url/photo2Url (type: "image").
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS photo1_url TEXT",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS photo2_url TEXT",
  // Game vault entities — same shape as kyc_entries (fixed category list)
  // but with an Info tab (rank/level/account age/tags) instead of KYC/Seller
  // fields. See config/vault-game.ts and config/fields/game-create.ts.
  "CREATE TABLE IF NOT EXISTS game_entries (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'Other', username TEXT, account_password TEXT, notes TEXT, email TEXT, email_password TEXT, email_2fa TEXT, email_backup_code TEXT, rank TEXT, level TEXT, account_age TEXT, tags JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())",
  // Developer API keys (routes/api-keys.ts, lib/db/src/schema/api-keys.ts) —
  // the route/middleware/crypto code already existed but this table was
  // never created, so every /api/api-keys call 500'd. Matches the drizzle
  // schema exactly (see api-keys.ts: keyPrefix/keyHash/type/scopes/etc).
  `CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'full',
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_used_at TIMESTAMP,
    last_used_ip TEXT,
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys(user_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash)",
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cost REAL DEFAULT 0",
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS profit REAL DEFAULT 0",
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS cost REAL DEFAULT 0",
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS profit REAL DEFAULT 0",
  "CREATE TABLE IF NOT EXISTS subscriptions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, plan TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'active', coingate_order_id TEXT, coingate_payment_url TEXT, expires_at TIMESTAMP, cancelled_at TIMESTAMP, is_lifetime BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS other_accounts TEXT",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS xp_name TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS email_recovery TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS email_recovery_password TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_email TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_email_password TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_followers TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_email_recovery TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_email_recovery_password TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_email TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_email_password TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_email_recovery TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_email_recovery_password TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_phone TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_linked_email TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_linked_email_password TEXT",
  `CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT 'My Wallet',
    address TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'ETH',
    chain_id INTEGER,
    balance REAL NOT NULL DEFAULT 0,
    balance_usd REAL NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    nft_count INTEGER NOT NULL DEFAULT 0,
    tx_count INTEGER NOT NULL DEFAULT 0,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    last_synced_at TIMESTAMP,
    notes TEXT,
    encrypted_phrase TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "ALTER TABLE wallets ADD COLUMN IF NOT EXISTS encrypted_phrase TEXT",
  "CREATE TABLE IF NOT EXISTS credits (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, balance INTEGER NOT NULL DEFAULT 0, azn_balance REAL NOT NULL DEFAULT 0, total_purchased INTEGER NOT NULL DEFAULT 0, total_spent INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())",
  "CREATE TABLE IF NOT EXISTS credit_transactions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL, method TEXT, credits INTEGER NOT NULL DEFAULT 0, azn_amount REAL NOT NULL DEFAULT 0, amount_bdt REAL, amount_usdt REAL, reference_id TEXT, status TEXT NOT NULL DEFAULT 'pending', notes TEXT, admin_note TEXT, approved_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())",
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Social'",
  "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_method TEXT",
  "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS sender_number TEXT",
  "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
  // Timer columns for projects
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS deadline TIMESTAMP",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS started_at TIMESTAMP",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'",
  // Timer columns for tasks
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline TIMESTAMP",
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER",
  // User-to-user messages
  `CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // ROI tracking on submissions
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS roi REAL DEFAULT 0",
  // Task category using A/B1/B2/C system
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_category TEXT DEFAULT 'B1'",
  // User total ROI field
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS total_roi REAL DEFAULT 0",
  // XP on tasks + project XP price
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS xp_amount REAL DEFAULT 0",
  "ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS xp_price REAL DEFAULT 0.01",
  // Notifications table
  `CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    message TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    data TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // Rejection reason on task_submissions
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS rejection_reason TEXT",
  // Project category (DeFi, NFT, GameFi, Layer2, Testnet, CEX, Social, Other)
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Other'",
  // Entity IDs on task submissions (JSON array)
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS entity_ids TEXT",
  // User activity log
  `CREATE TABLE IF NOT EXISTS user_activity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    entity_name TEXT,
    meta TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC)",
  // Earn links for link-click AZN income
  `CREATE TABLE IF NOT EXISTS earn_links (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT 'My Link',
    target_url TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    azn_per_click REAL NOT NULL DEFAULT 0.005,
    click_count INTEGER NOT NULL DEFAULT 0,
    earned_azn REAL NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_earn_links_user_id ON earn_links(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_earn_links_code ON earn_links(code)",
  // Task priority field
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'",
  // Task submission: cost_category and profit_category
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS cost_category TEXT",
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS profit_category TEXT",
  // Project completion percentage (cached)
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS completion_pct REAL DEFAULT 0",
  // User display color tag
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS color_tag TEXT DEFAULT '#22d3ee'",
  // ── Marketplace wallets (dedicated per market_type: azn | nft | vault | game) ──
  `CREATE TABLE IF NOT EXISTS marketplace_wallets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market_type TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    locked_balance REAL NOT NULL DEFAULT 0,
    address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, market_type)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mw_user ON marketplace_wallets(user_id)",
  // ── Spot trading engine (order book) — internal AZN/USDT & AZN/BDT pairs ──────
  "ALTER TABLE builtin_wallet_tokens ADD COLUMN IF NOT EXISTS locked_amount REAL NOT NULL DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS spot_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pair TEXT NOT NULL DEFAULT 'AZN/USDT',
    side TEXT NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'limit',
    price REAL NOT NULL DEFAULT 0,
    qty REAL NOT NULL,
    filled_qty REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_spot_orders_pair_status ON spot_orders(pair, status)",
  "CREATE INDEX IF NOT EXISTS idx_spot_orders_user ON spot_orders(user_id)",
  `CREATE TABLE IF NOT EXISTS spot_trades (
    id SERIAL PRIMARY KEY,
    pair TEXT NOT NULL DEFAULT 'AZN/USDT',
    buy_order_id INTEGER NOT NULL REFERENCES spot_orders(id),
    sell_order_id INTEGER NOT NULL REFERENCES spot_orders(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    price REAL NOT NULL,
    qty REAL NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_spot_trades_pair_time ON spot_trades(pair, created_at)",
  `CREATE TABLE IF NOT EXISTS staking_pools (
    id SERIAL PRIMARY KEY,
    symbol TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    apy REAL NOT NULL,
    min_lock_days INTEGER NOT NULL DEFAULT 7,
    min_amount REAL NOT NULL DEFAULT 10,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS staking_positions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pool_id INTEGER NOT NULL REFERENCES staking_pools(id),
    amount REAL NOT NULL,
    apy REAL NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    unlock_at TIMESTAMP NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    reward_paid REAL NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_staking_positions_user ON staking_positions(user_id)",
  `INSERT INTO staking_pools (symbol, label, apy, min_lock_days, min_amount) VALUES
    ('AZN-FLEX', 'AZN Flexible', 4.5, 0, 10),
    ('AZN-30D',  'AZN 30-Day Locked', 12, 30, 50),
    ('AZN-90D',  'AZN 90-Day Locked', 22, 90, 100),
    ('USDT-FLEX','USDT Flexible', 3, 0, 10)
   ON CONFLICT (symbol) DO NOTHING`,
  // ── AZN marketplace listings ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS azn_listings (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    price_per_unit REAL NOT NULL,
    total_price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    min_buy REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    buyer_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_azn_listings_status ON azn_listings(status)",
  // ── NFT marketplace listings (independent) ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS nft_market_listings (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'AZN',
    category TEXT DEFAULT 'collectible',
    rarity TEXT DEFAULT 'common',
    collection TEXT,
    edition INTEGER DEFAULT 1,
    total_supply INTEGER DEFAULT 1,
    traits TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    buyer_id INTEGER,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_nft_market_status ON nft_market_listings(status)",
  // ── Vault marketplace listings ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS vault_market_listings (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    vault_entry_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'AZN',
    category TEXT DEFAULT 'Social',
    tier TEXT DEFAULT 'basic',
    preview_data TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    buyer_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_vault_market_status ON vault_market_listings(status)",
  // ── Game marketplace listings (game account sales) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS game_market_listings (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    game_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    platform TEXT,
    photos TEXT,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    buyer_id INTEGER,
    views INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_game_market_status ON game_market_listings(status)",
  "CREATE INDEX IF NOT EXISTS idx_game_market_game_name ON game_market_listings(game_name)",
  // ── Marketplace transactions log ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS marketplace_transactions (
    id SERIAL PRIMARY KEY,
    market_type TEXT NOT NULL,
    listing_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    net_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mktx_buyer ON marketplace_transactions(buyer_id)",
  "CREATE INDEX IF NOT EXISTS idx_mktx_seller ON marketplace_transactions(seller_id)",
  // ── AI Agent settings (single row) ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_agent_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    router TEXT NOT NULL DEFAULT 'openai',
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    system_prompt TEXT DEFAULT 'You are AYZEN AI, an autonomous agent with access to the database, shell, and logs. Help the admin manage and develop the AYZEN platform.',
    temperature REAL DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 4096,
    tools_enabled TEXT DEFAULT '{"shell":true,"database":true,"console":true}',
    workflow TEXT DEFAULT '{}',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "INSERT INTO ai_agent_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  "ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS agent_mode TEXT DEFAULT 'single'",
  "ALTER TABLE ai_agent_settings ADD COLUMN IF NOT EXISTS context_window INTEGER DEFAULT 32000",
  // ── AI Agent chat sessions ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_agent_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL DEFAULT 'default',
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    tool_input TEXT,
    tool_output TEXT,
    tokens_used INTEGER DEFAULT 0,
    agent_name TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ai_msgs_session ON ai_agent_messages(session_id, created_at DESC)",
  "ALTER TABLE ai_agent_messages ADD COLUMN IF NOT EXISTS agent_name TEXT",
  // ── AI Agent roster (multi-agent pipeline members) ───────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_agents (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    description TEXT DEFAULT '',
    router TEXT NOT NULL DEFAULT 'openai',
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    system_prompt TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `INSERT INTO ai_agents (name, role, description, model, system_prompt, sort_order)
   SELECT * FROM (VALUES
     ('Planner', 'planner', 'Decodes intent and breaks the request into an actionable plan', 'gpt-4o-mini', 'You are the PLANNER agent of AYZEN AI Agent. Decode the user''s intent, expand it into clear requirements, and produce a numbered implementation plan. List the exact target files you expect to touch. Do not write code yet.', 1),
     ('Architect', 'architect', 'Locates and reads existing code relevant to the plan', 'gpt-4o-mini', 'You are the ARCHITECT agent of AYZEN AI Agent. Given a plan, use list_files and read_file to inspect the current codebase, confirm the exact files to change, and summarize the relevant existing code and conventions the Coder must follow.', 2),
     ('Coder', 'coder', 'Generates and applies code changes', 'gpt-4o-mini', 'You are the CODER agent of AYZEN AI Agent. Using the plan and the architecture notes, generate the necessary code and apply it with the write_file tool. Keep changes minimal, consistent with existing style, and scoped to the plan.', 3),
     ('QA', 'qa', 'Typechecks and fixes bugs', 'gpt-4o-mini', 'You are the QA agent of AYZEN AI Agent. Run run_typecheck after code changes. If it fails, read the errors, fix the offending files with write_file, and re-run typecheck until it passes or you determine it cannot be fixed automatically.', 4),
     ('DevOps', 'devops', 'Commits verified changes and can roll back on failure', 'gpt-4o-mini', 'You are the DEVOPS agent of AYZEN AI Agent. If QA reports a passing typecheck, use git_commit to save the verified changes with a clear commit message. If QA reports failure, use rollback_file to restore the original file contents and report that the change was rolled back.', 5)
   ) AS v(name, role, description, model, system_prompt, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM ai_agents)`,
  // ── AI Model catalog (user-editable) ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_model_catalog (
    id SERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    label TEXT NOT NULL,
    ctx INTEGER NOT NULL DEFAULT 32000,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `INSERT INTO ai_model_catalog (provider, model_id, label, ctx, is_custom)
   SELECT * FROM (VALUES
     ('openai', 'gpt-4o', 'GPT-4o', 128000, FALSE),
     ('openai', 'gpt-4o-mini', 'GPT-4o Mini', 128000, FALSE),
     ('openai', 'gpt-4-turbo', 'GPT-4 Turbo', 128000, FALSE),
     ('openai', 'gpt-3.5-turbo', 'GPT-3.5 Turbo', 16385, FALSE),
     ('groq', 'llama-3.3-70b-versatile', 'LLaMA 3.3 70B', 131072, FALSE),
     ('groq', 'llama-3.1-8b-instant', 'LLaMA 3.1 8B Instant', 131072, FALSE),
     ('groq', 'mixtral-8x7b-32768', 'Mixtral 8x7B', 32768, FALSE),
     ('groq', 'gemma2-9b-it', 'Gemma 2 9B', 8192, FALSE),
     ('openrouter', 'anthropic/claude-3.5-sonnet', 'Claude 3.5 Sonnet', 200000, FALSE),
     ('openrouter', 'anthropic/claude-3-haiku', 'Claude 3 Haiku', 200000, FALSE),
     ('openrouter', 'google/gemini-pro-1.5', 'Gemini Pro 1.5', 2000000, FALSE),
     ('openrouter', 'meta-llama/llama-3.2-90b-vision-instruct', 'LLaMA 3.2 90B Vision', 131072, FALSE),
     ('openrouter', 'deepseek/deepseek-r1', 'DeepSeek R1', 65536, FALSE),
     ('openrouter', 'mistralai/mistral-large', 'Mistral Large', 131072, FALSE),
     ('openrouter', 'x-ai/grok-beta', 'Grok Beta', 131072, FALSE)
   ) AS v(provider, model_id, label, ctx, is_custom)
   WHERE NOT EXISTS (SELECT 1 FROM ai_model_catalog)`,
  // ── AI Agent file backups (for write_file / rollback) ────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_agent_file_backups (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL DEFAULT 'default',
    file_path TEXT NOT NULL,
    original_content TEXT,
    existed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ai_backups_path ON ai_agent_file_backups(session_id, file_path, created_at DESC)",
  // ── NFT listings: liked_by JSON array ────────────────────────────────────────
  "ALTER TABLE nft_market_listings ADD COLUMN IF NOT EXISTS liked_by TEXT DEFAULT '[]'",
  // Task steps guide (JSON array of {title, description})
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS steps TEXT",
  // Cost entries JSON array on submissions (multiple line items)
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS cost_entries TEXT",
  // Project meta fields
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS duration_type TEXT DEFAULT 'long'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'average'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS cost_type TEXT DEFAULT 'free'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS tutorial_notes TEXT",
  `CREATE TABLE IF NOT EXISTS local_account_points (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_local_account_points_account_id ON local_account_points(account_id)",
  "CREATE INDEX IF NOT EXISTS idx_local_account_points_user_id ON local_account_points(user_id)",
  // Task external link for in-app link completion flow
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_link TEXT",
  // Track link visits per user/task
  `CREATE TABLE IF NOT EXISTS task_link_visits (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    visited_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(task_id, user_id)
  )`,
  // ── Phase 5: request_metrics — real telemetry ────────────────────────────
  `CREATE TABLE IF NOT EXISTS request_metrics (
    id SERIAL PRIMARY KEY,
    route TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    status_code INTEGER NOT NULL DEFAULT 200,
    duration_ms REAL NOT NULL DEFAULT 0,
    user_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_request_metrics_route ON request_metrics(route)",
  "CREATE INDEX IF NOT EXISTS idx_request_metrics_created_at ON request_metrics(created_at DESC)",
  // ── Phase 0: auth error_logs table (already defined in Drizzle schema) ───
  "CREATE TABLE IF NOT EXISTS error_logs (id SERIAL PRIMARY KEY, level TEXT NOT NULL DEFAULT 'ERROR', message TEXT NOT NULL, endpoint TEXT, stack TEXT, timestamp TIMESTAMP NOT NULL DEFAULT NOW())",
  "CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp DESC)",
  // ── Phase 1: categories + category_templates ─────────────────────────────
  `CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'task',
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS category_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'task',
    sub_categories JSONB NOT NULL DEFAULT '[]',
    created_by INTEGER,
    is_global BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // ── Phase 2: data integrity — entity_project_roi + health_rules ──────────
  `CREATE TABLE IF NOT EXISTS entity_project_roi (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    vault_entry_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    total_cost REAL NOT NULL DEFAULT 0,
    total_profit REAL NOT NULL DEFAULT 0,
    roi REAL GENERATED ALWAYS AS (total_profit - total_cost) STORED,
    recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(vault_entry_id, project_id)
  )`,
  `CREATE TABLE IF NOT EXISTS health_rules (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    rule_type TEXT NOT NULL DEFAULT 'wallet',
    condition JSONB NOT NULL DEFAULT '{}',
    severity TEXT NOT NULL DEFAULT 'warning',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // ── Phase 3: vault hub additions ─────────────────────────────────────────
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS encrypted_seed_phrase TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS current_value REAL NOT NULL DEFAULT 0",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS current_buy_value REAL NOT NULL DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS other_two_factor_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    vault_entry_id INTEGER,
    service_name TEXT NOT NULL,
    totp_secret TEXT,
    backup_codes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // ── Phase 6: teams ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS team_messages (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_team_messages_team_id ON team_messages(team_id)",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS team_id INTEGER",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id INTEGER",
  // ── Phase 7: content / AI generation ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS project_memory (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'context',
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_project_memory_project_id ON project_memory(project_id)",
  `CREATE TABLE IF NOT EXISTS generated_content (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'post',
    prompt_used TEXT,
    output TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_generated_content_project_id ON generated_content(project_id)",
  // ── Phase 8: plan limits ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS plan_limits (
    id SERIAL PRIMARY KEY,
    plan TEXT NOT NULL UNIQUE,
    max_projects INTEGER NOT NULL DEFAULT 5,
    max_entities INTEGER NOT NULL DEFAULT 10,
    max_content_gen_per_day INTEGER NOT NULL DEFAULT 5,
    max_team_size INTEGER NOT NULL DEFAULT 3,
    max_vault_entries INTEGER NOT NULL DEFAULT 20,
    can_use_ai BOOLEAN NOT NULL DEFAULT FALSE,
    can_use_teams BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "INSERT INTO plan_limits (plan, max_projects, max_entities, max_content_gen_per_day, max_team_size, max_vault_entries, can_use_ai, can_use_teams) VALUES ('free', 3, 5, 2, 2, 10, false, false) ON CONFLICT (plan) DO NOTHING",
  "INSERT INTO plan_limits (plan, max_projects, max_entities, max_content_gen_per_day, max_team_size, max_vault_entries, can_use_ai, can_use_teams) VALUES ('starter', 10, 25, 15, 5, 50, true, false) ON CONFLICT (plan) DO NOTHING",
  "INSERT INTO plan_limits (plan, max_projects, max_entities, max_content_gen_per_day, max_team_size, max_vault_entries, can_use_ai, can_use_teams) VALUES ('pro', 50, 100, 100, 20, 200, true, true) ON CONFLICT (plan) DO NOTHING",
  "INSERT INTO plan_limits (plan, max_projects, max_entities, max_content_gen_per_day, max_team_size, max_vault_entries, can_use_ai, can_use_teams) VALUES ('unlimited', 9999, 9999, 9999, 9999, 9999, true, true) ON CONFLICT (plan) DO NOTHING",
  // Extra project meta fields needed by teams / content modules
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'airdrop'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS account_type_filter TEXT",
  // Networks table (DB-driven, replaces hardcoded NETWORKS array in tools.ts)
  `CREATE TABLE IF NOT EXISTS networks (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    network_id TEXT,
    chain TEXT NOT NULL,
    symbol TEXT,
    coingecko_id TEXT,
    rpc_url TEXT,
    gas_oracle_url TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // Seed default networks
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('Ethereum', '1', 'ETH', 'ETH', 'ethereum', 'https://eth.llamarpc.com', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('BNB Chain', '56', 'BSC', 'BNB', 'binancecoin', 'https://bsc-dataseed.binance.org', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('Polygon', '137', 'MATIC', 'MATIC', 'matic-network', 'https://polygon-rpc.com', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('Arbitrum One', '42161', 'ARB', 'ETH', 'ethereum', 'https://arb1.arbitrum.io/rpc', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('Optimism', '10', 'OP', 'ETH', 'optimism', 'https://mainnet.optimism.io', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('Avalanche', '43114', 'AVAX', 'AVAX', 'avalanche-2', 'https://api.avax.network/ext/bc/C/rpc', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('Base', '8453', 'BASE', 'ETH', 'ethereum', 'https://mainnet.base.org', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('zkSync Era', '324', 'ZK', 'ETH', 'ethereum', 'https://mainnet.era.zksync.io', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('Scroll', '534352', 'SCROLL', 'ETH', 'ethereum', 'https://rpc.scroll.io', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO networks (name, network_id, chain, symbol, coingecko_id, rpc_url, enabled) VALUES ('Linea', '59144', 'LINEA', 'ETH', 'ethereum', 'https://rpc.linea.build', true) ON CONFLICT (name) DO NOTHING",
  // Local account snapshots (progress tracking over time)
  `CREATE TABLE IF NOT EXISTS local_account_snapshots (
    id SERIAL PRIMARY KEY,
    local_account_id INTEGER NOT NULL,
    metric_value REAL NOT NULL DEFAULT 0,
    metric_type TEXT NOT NULL DEFAULT 'followers',
    captured_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // request_metrics already created above — skip duplicate definition
  // Seed default health rules — use correct column names matching schema
  "CREATE UNIQUE INDEX IF NOT EXISTS health_rules_name_idx ON health_rules(name)",
  "INSERT INTO health_rules (name, description, rule_type, condition, severity, is_active) VALUES ('Missing 2FA', 'Entity does not have 2FA configured', 'entity', '{\"check\":\"missing_2fa\"}', 'warning', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO health_rules (name, description, rule_type, condition, severity, is_active) VALUES ('Missing Wallet', 'Entity has no wallet address linked', 'entity', '{\"check\":\"missing_wallet\"}', 'warning', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO health_rules (name, description, rule_type, condition, severity, is_active) VALUES ('Inactive 30 Days', 'Entity has not been active for 30+ days', 'entity', '{\"check\":\"inactive_days\",\"threshold\":30}', 'critical', true) ON CONFLICT (name) DO NOTHING",
  "INSERT INTO health_rules (name, description, rule_type, condition, severity, is_active) VALUES ('Missing Email', 'Entity has no email configured', 'entity', '{\"check\":\"missing_email\"}', 'warning', true) ON CONFLICT (name) DO NOTHING",
   // ── Phase 9: built-in wallet tokens ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS builtin_wallet_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL DEFAULT 'USDT',
    name TEXT NOT NULL DEFAULT 'Tether USD',
    amount REAL NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS builtin_wallet_tokens_user_symbol ON builtin_wallet_tokens(user_id, symbol)",
  // ── Phase 7: referrals ──────────────────────────────────────────────────
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_idx ON users(referral_code) WHERE referral_code IS NOT NULL",
  `CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_used TEXT NOT NULL,
    reward_amount REAL NOT NULL DEFAULT 10,
    reward_paid BOOLEAN NOT NULL DEFAULT FALSE,
    paid_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "ALTER TABLE teams ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",
  "ALTER TABLE teams ADD COLUMN IF NOT EXISTS description TEXT",
  "ALTER TABLE teams ADD COLUMN IF NOT EXISTS slug TEXT",
  "ALTER TABLE teams ADD COLUMN IF NOT EXISTS invite_code TEXT",
  "ALTER TABLE team_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",
  `CREATE TABLE IF NOT EXISTS team_missions (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    target_value INTEGER DEFAULT 100,
    current_value INTEGER DEFAULT 0,
    reward_amount NUMERIC(12,2) DEFAULT 0,
    deadline TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS reward_links (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    reward_amount NUMERIC(12,2) DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT false,
    view_duration_seconds INTEGER DEFAULT 10,
    max_completions INTEGER DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS link_completions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    link_id INTEGER NOT NULL REFERENCES reward_links(id) ON DELETE CASCADE,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, link_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ad_tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    ad_url TEXT NOT NULL,
    ad_image_url TEXT,
    reward_amount NUMERIC(12,2) DEFAULT 0,
    view_duration_seconds INTEGER DEFAULT 15,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ad_completions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ad_task_id INTEGER NOT NULL REFERENCES ad_tasks(id) ON DELETE CASCADE,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, ad_task_id)
  )`,
  // ── Phase 10: AYZEN Wallet — token balances + internal transfers ──────────
  "ALTER TABLE credits ADD COLUMN IF NOT EXISTS usdt_balance REAL NOT NULL DEFAULT 0",
  "ALTER TABLE credits ADD COLUMN IF NOT EXISTS bdt_balance REAL NOT NULL DEFAULT 0",
  "ALTER TABLE credits ADD COLUMN IF NOT EXISTS xp_balance REAL NOT NULL DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS wallet_transfers (
    id SERIAL PRIMARY KEY,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    currency TEXT NOT NULL DEFAULT 'AZN',
    amount REAL NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_wallet_transfers_from ON wallet_transfers(from_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_wallet_transfers_to ON wallet_transfers(to_user_id)",
  // ── Phase 11: AYZEN built-in Mail ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ayzen_mail (
    id SERIAL PRIMARY KEY,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL DEFAULT '(no subject)',
    body TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_by_sender BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_by_receiver BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ayzen_mail_to ON ayzen_mail(to_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_ayzen_mail_from ON ayzen_mail(from_user_id)",
  // ── Phase 12: Project types ───────────────────────────────────────────────
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'protocol'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS exchange_sub_type TEXT DEFAULT 'candydrop'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS account_category TEXT DEFAULT 'both'",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS exchange_custom_categories TEXT",
  // ── Phase 13: Email accounts (per-email IMAP/SMTP vault) ──────────────────
  `CREATE TABLE IF NOT EXISTS email_accounts (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    label       TEXT NOT NULL,
    email_address TEXT NOT NULL,
    protocol    TEXT NOT NULL DEFAULT 'IMAP',
    imap_host   TEXT,
    imap_port   INTEGER DEFAULT 993,
    smtp_host   TEXT,
    smtp_port   INTEGER DEFAULT 587,
    username    TEXT,
    password    TEXT,
    use_ssl     BOOLEAN NOT NULL DEFAULT TRUE,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    notes       TEXT,
    tags        TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON email_accounts(user_id)",
  "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'custom'",
  "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS auth_key TEXT",
  "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS session_pooler TEXT",
  `CREATE TABLE IF NOT EXISTS value_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    target TEXT NOT NULL DEFAULT 'account',
    label TEXT,
    metric TEXT NOT NULL DEFAULT 'value',
    value REAL NOT NULL,
    buy_value REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_value_history_owner ON value_history(user_id, source_type, source_id, created_at DESC)",
  // ── Follower tracking reuses value_history via metric='follower' ──────────
  "ALTER TABLE value_history ADD COLUMN IF NOT EXISTS metric TEXT NOT NULL DEFAULT 'value'",
  // ── Phase 14: Task admin fields ───────────────────────────────────────────
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS difficulty_level TEXT DEFAULT 'medium'",
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_cost REAL DEFAULT 0",
  "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_profit REAL DEFAULT 0",
  // ── Phase 15: NFT Subscription system ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS nft_subscriptions (
    id SERIAL PRIMARY KEY,
    token_id TEXT NOT NULL UNIQUE,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    original_owner_id INTEGER NOT NULL REFERENCES users(id),
    plan TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    expires_at TIMESTAMP NOT NULL,
    is_listed BOOLEAN NOT NULL DEFAULT FALSE,
    list_price REAL,
    transfer_count INTEGER NOT NULL DEFAULT 0,
    is_burned BOOLEAN NOT NULL DEFAULT FALSE,
    minted_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_nft_subscriptions_owner ON nft_subscriptions(owner_id)",
  "CREATE INDEX IF NOT EXISTS idx_nft_subscriptions_listed ON nft_subscriptions(is_listed) WHERE is_listed = TRUE",
  // ── Phase 16: P2P Marketplace ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS marketplace_listings (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    listing_type TEXT NOT NULL DEFAULT 'entity',
    item_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    price_azn REAL NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    buyer_id INTEGER REFERENCES users(id),
    sold_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status ON marketplace_listings(status)",
  "CREATE INDEX IF NOT EXISTS idx_marketplace_listings_seller ON marketplace_listings(seller_id)",
  `CREATE TABLE IF NOT EXISTS marketplace_orders (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    price_azn REAL NOT NULL,
    fee_pct REAL NOT NULL DEFAULT 5,
    fee_azn REAL,
    seller_receives REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    message TEXT,
    admin_note TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status ON marketplace_orders(status)",
  "CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer ON marketplace_orders(buyer_id)",
  "CREATE INDEX IF NOT EXISTS idx_marketplace_orders_seller ON marketplace_orders(seller_id)",
  `CREATE TABLE IF NOT EXISTS marketplace_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    fee_pct REAL NOT NULL DEFAULT 5,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // ── Phase 17: Security / 2FA codes ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS user_backup_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    code TEXT NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes(user_id)",
  `CREATE TABLE IF NOT EXISTS user_magic_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    code TEXT NOT NULL UNIQUE,
    label TEXT,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_magic_codes_code ON user_magic_codes(code)",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_secret TEXT",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email TEXT",
  "ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS azn_amount REAL DEFAULT 0",
  // ── Phase 18: Daily Check-in ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS user_checkins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    checked_in_date DATE NOT NULL,
    streak_day INTEGER NOT NULL DEFAULT 1,
    xp_earned INTEGER NOT NULL DEFAULT 10,
    azn_earned REAL NOT NULL DEFAULT 0.1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, checked_in_date)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_checkins_user ON user_checkins(user_id, checked_in_date DESC)",
  // ── Phase 18: Project Watchlist ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS user_watchlist (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, project_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_watchlist_user ON user_watchlist(user_id)",
  // ── Phase 19: NFT extended columns ────────────────────────────────────────
  "ALTER TABLE nft_subscriptions ADD COLUMN IF NOT EXISTS nft_type TEXT DEFAULT 'subscription'",
  "ALTER TABLE nft_subscriptions ADD COLUMN IF NOT EXISTS image_url TEXT",
  "ALTER TABLE nft_subscriptions ADD COLUMN IF NOT EXISTS nft_category TEXT DEFAULT 'pass'",
  "ALTER TABLE nft_subscriptions ADD COLUMN IF NOT EXISTS badge_name TEXT",
  // ── Phase 19: Marketplace extended columns ────────────────────────────────
  "ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS image_url TEXT",
  "ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'good'",
  "ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS tags TEXT",
  // ── Phase 19: Marketplace Activity Log ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS marketplace_activity_log (
    id SERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    actor_id INTEGER,
    actor_username TEXT,
    target_id INTEGER,
    target_type TEXT,
    title TEXT NOT NULL,
    details TEXT,
    amount_azn REAL,
    status TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_activity_created ON marketplace_activity_log(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_mkt_activity_event ON marketplace_activity_log(event_type)",
  // ── Phase 20: Marketplace listing expiry ──────────────────────────────────
  "ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS listing_expires_at TIMESTAMP",
  // ── Phase 21: Robin API Key Manager ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS robin_api_keys (
    id SERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    slot INTEGER NOT NULL DEFAULT 1,
    key_value TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(provider, slot)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_robin_keys_provider ON robin_api_keys(provider, is_active)",
  // ── Phase 25: Entity per-platform age + worth (vault worth calculator) ────
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_age TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_worth TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_followers TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_age TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_worth TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_age TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_worth TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_buy_value TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_buy_value TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_buy_value TEXT",
  // ── Demo accounts for all roles (idempotent) ───────────────────────────────
  // Demo accounts — SHA-256(password + "ayzen_salt"), pre-computed from hashPassword() in auth.ts.
  // All four accounts use the same hash so a clean DB has all role init buttons working.
  `INSERT INTO users (username, email, password_hash, role, status, email_verified, two_fa_enabled, referral_code)
   SELECT 'demoadmin', 'demoadmin@ayzen.io',
     '32c9156337d663748c1b0122abbcbe288929ea52352250854325d61d786ae292',
     'admin', 'active', true, false, 'AYZN-ADMIN1'
   WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demoadmin@ayzen.io')`,
  `INSERT INTO users (username, email, password_hash, role, status, email_verified, two_fa_enabled, referral_code)
   SELECT 'demodev', 'demodev@ayzen.io',
     '32c9156337d663748c1b0122abbcbe288929ea52352250854325d61d786ae292',
     'dev', 'active', true, false, 'AYZN-DEV001'
   WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demodev@ayzen.io')`,
  `INSERT INTO users (username, email, password_hash, role, status, email_verified, two_fa_enabled, referral_code)
   SELECT 'demomod', 'demomod@ayzen.io',
     '32c9156337d663748c1b0122abbcbe288929ea52352250854325d61d786ae292',
     'moderator', 'active', true, false, 'AYZN-MOD001'
   WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demomod@ayzen.io')`,
  `INSERT INTO users (username, email, password_hash, role, status, email_verified, two_fa_enabled, referral_code)
   SELECT 'demoteam', 'demoteam@ayzen.io',
     '32c9156337d663748c1b0122abbcbe288929ea52352250854325d61d786ae292',
     'teamleader', 'active', true, false, 'AYZN-TL001'
   WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'demoteam@ayzen.io')`,
  // ── Phase 22: AZN Market buy/sell order types + payment methods ───────────
  "ALTER TABLE azn_listings ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'sell'",
  "ALTER TABLE azn_listings ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'binance'",
  "ALTER TABLE azn_listings ADD COLUMN IF NOT EXISTS payment_details TEXT",
  // ── Phase 23: NFT Market dynamic categories ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS nft_market_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    color TEXT DEFAULT 'text-primary',
    icon TEXT DEFAULT 'gem',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "INSERT INTO nft_market_categories (name, label, color, icon) VALUES ('username', 'Username NFT', 'text-cyan-400', 'user') ON CONFLICT (name) DO NOTHING",
  "INSERT INTO nft_market_categories (name, label, color, icon) VALUES ('lifetime_pass', 'Lifetime Pass', 'text-teal-400', 'infinity') ON CONFLICT (name) DO NOTHING",
  "INSERT INTO nft_market_categories (name, label, color, icon) VALUES ('regular_pass', 'Regular Pass', 'text-violet-400', 'zap') ON CONFLICT (name) DO NOTHING",
  "INSERT INTO nft_market_categories (name, label, color, icon) VALUES ('achievement_pass', 'Achievement Pass', 'text-amber-400', 'award') ON CONFLICT (name) DO NOTHING",
  "ALTER TABLE nft_subscriptions ADD COLUMN IF NOT EXISTS market_payment_method TEXT DEFAULT 'azn'",
  "ALTER TABLE nft_subscriptions ADD COLUMN IF NOT EXISTS market_payment_details TEXT",
  // ── Phase 24: Vault Market extended fields ─────────────────────────────────
  "ALTER TABLE vault_market_listings ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'sell'",
  "ALTER TABLE vault_market_listings ADD COLUMN IF NOT EXISTS account_type TEXT",
  "ALTER TABLE vault_market_listings ADD COLUMN IF NOT EXISTS account_details TEXT",
  "ALTER TABLE vault_market_listings ADD COLUMN IF NOT EXISTS vault_type TEXT DEFAULT 'entity'",
  "ALTER TABLE vault_market_listings ADD COLUMN IF NOT EXISTS price_min REAL",
  "ALTER TABLE vault_market_listings ADD COLUMN IF NOT EXISTS price_max REAL",
  // ── Phase 26: Projects/Vault function pass — project status, ratings, vault activity log ──
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_status TEXT DEFAULT 'active' NOT NULL",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' NOT NULL",
  "ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS project_id INTEGER",
  `UPDATE task_submissions ts SET project_id = t.project_id
     FROM tasks t WHERE t.id = ts.task_id AND ts.project_id IS NULL`,
  "CREATE INDEX IF NOT EXISTS task_submissions_project_idx ON task_submissions (project_id)",
  `CREATE TABLE IF NOT EXISTS project_ratings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS project_ratings_user_project_idx ON project_ratings (user_id, project_id)",
  "CREATE INDEX IF NOT EXISTS project_ratings_project_idx ON project_ratings (project_id)",
  // vault_entry_id intentionally has NO foreign key / cascade — this is an audit
  // log and must outlive the vault entry it describes (e.g. the "deleted" event).
  `CREATE TABLE IF NOT EXISTS vault_activity_log (
    id SERIAL PRIMARY KEY,
    vault_entry_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS vault_activity_log_entry_idx ON vault_activity_log (vault_entry_id)",
  // ── Phase 27: Marketplace cart / per-platform pricing / favorites / order lifecycle ──
  "ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP",
  "ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS dispute_reason TEXT",
  "ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMP",
  `CREATE TABLE IF NOT EXISTS marketplace_favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, listing_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_favorites_user ON marketplace_favorites(user_id)",
  `CREATE TABLE IF NOT EXISTS marketplace_listing_platform_pricing (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    price_azn REAL NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(listing_id, platform)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_platform_pricing_listing ON marketplace_listing_platform_pricing(listing_id)",
  // ── Phase 28: Marketplace cart ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS marketplace_cart_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    platform TEXT,
    price_azn REAL NOT NULL,
    added_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, listing_id, platform)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_cart_user ON marketplace_cart_items(user_id)",
  // ── Phase 29: Marketplace 50-function expansion (reviews/offers/coupons/reports/bundles/alerts) ──
  "ALTER TABLE marketplace_cart_items ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE marketplace_orders ADD COLUMN IF NOT EXISTS bundle_id INTEGER",
  `CREATE TABLE IF NOT EXISTS marketplace_reviews (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE REFERENCES marketplace_orders(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    comment TEXT,
    seller_response TEXT,
    seller_response_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_reviews_seller ON marketplace_reviews(seller_id)",
  "CREATE INDEX IF NOT EXISTS idx_mkt_reviews_buyer ON marketplace_reviews(buyer_id)",
  `CREATE TABLE IF NOT EXISTS marketplace_offers (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offer_price_azn REAL NOT NULL,
    counter_price_azn REAL,
    counter_message TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_offers_listing ON marketplace_offers(listing_id)",
  "CREATE INDEX IF NOT EXISTS idx_mkt_offers_buyer ON marketplace_offers(buyer_id)",
  "CREATE INDEX IF NOT EXISTS idx_mkt_offers_seller ON marketplace_offers(seller_id)",
  `CREATE TABLE IF NOT EXISTS marketplace_coupons (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value REAL NOT NULL,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    min_purchase_azn REAL NOT NULL DEFAULT 0,
    expires_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS marketplace_coupon_usage (
    id SERIAL PRIMARY KEY,
    coupon_id INTEGER NOT NULL REFERENCES marketplace_coupons(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(coupon_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS marketplace_reports (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    reported_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_reports_status ON marketplace_reports(status)",
  `CREATE TABLE IF NOT EXISTS marketplace_bundles (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    listing_ids INTEGER[] NOT NULL,
    bundle_price_azn REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_bundles_seller ON marketplace_bundles(seller_id)",
  `CREATE TABLE IF NOT EXISTS marketplace_alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keyword TEXT,
    listing_type TEXT,
    max_price_azn REAL,
    platform TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_alerts_user ON marketplace_alerts(user_id)",
  `CREATE TABLE IF NOT EXISTS marketplace_saved_searches (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mkt_saved_searches_user ON marketplace_saved_searches(user_id)",
  // ── Phase 14: Team module extensions (30 new team functions) ──────────────
  "ALTER TABLE teams ADD COLUMN IF NOT EXISTS avatar_url TEXT",
  "ALTER TABLE teams ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'",
  "ALTER TABLE team_members ADD COLUMN IF NOT EXISTS note TEXT",
  "ALTER TABLE team_members ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP",
  "ALTER TABLE team_missions ADD COLUMN IF NOT EXISTS claimed BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE team_missions ADD COLUMN IF NOT EXISTS claimed_by INTEGER",
  "ALTER TABLE team_missions ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP",
  `CREATE TABLE IF NOT EXISTS team_join_requests (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS team_favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, team_id)
  )`,
  `CREATE TABLE IF NOT EXISTS team_announcements (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // DEPRECATED (Phase 17 audit fix): kept only so pre-fix rows remain
  // readable — routes/teams.ts no longer INSERTs here. All team-activity
  // events (member_removed, role_changed, mailbox_added,
  // ownership_transferred, member_left, team_join_request_*) now go through
  // logSubjectActivity("team", teamId, ...) into the shared activity_log
  // table (subject_type="team"), same as mission_progress/vault_used
  // already did, per Phase 15's original "no second logging system" intent.
  // GET /teams/:id/activity and /teams/:id/audit-log both read this table
  // merged with activity_log (see fetchMergedTeamActivity in
  // routes/teams.ts) so historical rows still show up. Not yet Drizzle-
  // tracked, matching the rest of the raw-SQL teams_* table cluster this
  // block creates — safe to drop once historical rows are backfilled into
  // activity_log or no longer needed.
  `CREATE TABLE IF NOT EXISTS team_activity_log (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INTEGER,
    action TEXT NOT NULL,
    meta JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_team_join_requests_team ON team_join_requests(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_team_favorites_user ON team_favorites(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_team_announcements_team ON team_announcements(team_id)",
  "CREATE INDEX IF NOT EXISTS idx_team_activity_log_team ON team_activity_log(team_id)",

  // ── Phase 13B: team App section — AYZEN-provided team mailbox ────────────
  // Reuses email_accounts/mail_messages (the same IMAP/SMTP + cache tables
  // that power personal Vault Mail) instead of forking a parallel table.
  // team_id nullable: NULL rows stay personal (unchanged behavior); a row
  // with team_id set belongs to that team's shared mailbox — leader manages
  // the IMAP/SMTP config, every active member can read the inbox. See
  // routes/teams.ts's /teams/:id/email-accounts endpoints for access control.
  "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE",
  "CREATE INDEX IF NOT EXISTS idx_email_accounts_team_id ON email_accounts(team_id)",

  // ── MCP Agents: modular agent-type/skill/provider system ─────────────────────
  // Providers = the "router" — where a model call actually goes. Ships with
  // openai/groq/openrouter (matching the existing AI Agent), but new providers
  // (any OpenAI-compatible base_url) can be added from the admin UI without a
  // redeploy. Actual key material lives in robin_api_keys (key-manager.ts);
  // api_key_env is only the env-var fallback when no DB key is configured.
  `CREATE TABLE IF NOT EXISTS ai_providers (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_env TEXT NOT NULL,
    is_custom BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `INSERT INTO ai_providers (key, label, base_url, api_key_env, is_custom, sort_order)
   SELECT * FROM (VALUES
     ('openai', 'OpenAI', 'https://api.openai.com/v1', 'OPENAI_API_KEY', FALSE, 1),
     ('groq', 'Groq', 'https://api.groq.com/openai/v1', 'GROQ_API_KEY', FALSE, 2),
     ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', FALSE, 3)
   ) AS v(key, label, base_url, api_key_env, is_custom, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM ai_providers)`,

  // Agent types = the modular MCP agents themselves (Local, Builder, Database,
  // Execute, Blueprint...). Each is bound to a provider+model+prompt and owns
  // a set of skills. New types can be added from the admin UI.
  `CREATE TABLE IF NOT EXISTS mcp_agent_types (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'Bot',
    description TEXT DEFAULT '',
    provider_key TEXT NOT NULL DEFAULT 'openai' REFERENCES ai_providers(key),
    model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    system_prompt TEXT NOT NULL DEFAULT '',
    is_custom BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `INSERT INTO mcp_agent_types (key, label, icon, description, model, system_prompt, is_custom, sort_order)
   SELECT * FROM (VALUES
     ('local', 'Local Agent', 'HardDrive', 'Reads/writes repo files on the local filesystem and inspects the project tree', 'gpt-4o-mini', 'You are the LOCAL agent of AYZEN MCP. You operate on the local repository filesystem: list directories, read files, write files, and roll back changes. Stay scoped to the repo root and never touch node_modules or .git internals directly.', FALSE, 1),
     ('builder', 'Builder Agent', 'Hammer', 'Generates/edits code, typechecks it, and commits verified changes', 'gpt-4o-mini', 'You are the BUILDER agent of AYZEN MCP. Given a plan, write or modify source files, then run the typecheck skill before committing. Keep changes minimal and consistent with existing code style. Never commit a change that fails typecheck.', FALSE, 2),
     ('database', 'Database Agent', 'Database', 'Runs read queries against the AYZEN database and reports schema/stats', 'gpt-4o-mini', 'You are the DATABASE agent of AYZEN MCP. Answer questions about platform data using read-only SQL, table listings, and platform stats. Never run destructive queries.', FALSE, 3),
     ('execute', 'Execute Agent', 'Terminal', 'Runs shell commands and reads server/console/error logs', 'gpt-4o-mini', 'You are the EXECUTE agent of AYZEN MCP. Run shell commands and inspect logs to diagnose or carry out operational tasks. Refuse destructive or irreversible commands.', FALSE, 4),
     ('blueprint', 'Blueprint Agent', 'FileCode2', 'Drafts implementation blueprints/specs before any code is written', 'gpt-4o-mini', 'You are the BLUEPRINT agent of AYZEN MCP. Turn a feature request into a structured blueprint: goal, affected files, data model changes, API endpoints, and a numbered step plan. Do not write implementation code — only the plan.', FALSE, 5)
   ) AS v(key, label, icon, description, model, system_prompt, is_custom, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM mcp_agent_types)`,

  // Skills = individual tools an agent type can use. handler_kind selects the
  // implementation: a built-in ("native") key handled in code, or a no-code
  // "http_webhook" that lets an admin bolt on a new skill by URL alone.
  `CREATE TABLE IF NOT EXISTS mcp_skills (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL,
    agent_type_key TEXT NOT NULL REFERENCES mcp_agent_types(key) ON DELETE CASCADE,
    label TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'Puzzle',
    handler_kind TEXT NOT NULL DEFAULT 'native',
    handler_config TEXT DEFAULT '{}',
    is_custom BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(agent_type_key, key)
  )`,
  `INSERT INTO mcp_skills (key, agent_type_key, label, description, icon, handler_kind, is_custom, sort_order)
   SELECT * FROM (VALUES
     ('list_files',      'local',      'List Files',        'List files and folders in a repository directory',              'FolderTree', 'native', FALSE, 1),
     ('read_file',       'local',      'Read File',          'Read the contents of a source file',                             'FileText',   'native', FALSE, 2),
     ('write_file',      'local',      'Write File',         'Create or overwrite a file (auto-backed up)',                    'FileText',   'native', FALSE, 3),
     ('rollback_file',   'local',      'Rollback File',      'Restore a file to its pre-write version',                        'RotateCcw',  'native', FALSE, 4),

     ('write_file',      'builder',    'Write File',         'Create or overwrite a file (auto-backed up)',                    'FileText',   'native', FALSE, 1),
     ('run_typecheck',   'builder',    'Typecheck',          'Run the project-wide TypeScript typecheck',                      'ShieldCheck','native', FALSE, 2),
     ('git_commit',      'builder',    'Git Commit',         'Stage and commit verified changes',                              'GitCommit',  'native', FALSE, 3),
     ('rollback_file',   'builder',    'Rollback File',      'Restore a file to its pre-write version',                        'RotateCcw',  'native', FALSE, 4),

     ('execute_sql',     'database',   'Execute SQL',        'Run a read-only SQL query (destructive queries blocked)',       'Database',   'native', FALSE, 1),
     ('list_tables',     'database',   'List Tables',        'List all database tables with column counts',                   'Layers',     'native', FALSE, 2),
     ('get_platform_stats','database', 'Platform Stats',     'Users, projects, tasks, revenue snapshot',                       'Sparkles',   'native', FALSE, 3),

     ('execute_shell',   'execute',    'Execute Shell',      'Run a shell command in the server environment',                  'Terminal',   'native', FALSE, 1),
     ('query_logs',      'execute',    'Request Logs',       'Query recent request metrics',                                   'Server',     'native', FALSE, 2),
     ('query_error_logs','execute',    'Error Logs',         'Query the persistent error_logs table',                          'AlertTriangle','native', FALSE, 3),
     ('query_workflow_logs','execute','Workflow Logs',       'Read live workflow / startup log-bus entries',                   'Layers',     'native', FALSE, 4),

     ('draft_blueprint', 'blueprint',  'Draft Blueprint',    'Produce a structured implementation plan from a feature request','FileCode2', 'native', FALSE, 1),
     ('read_file',       'blueprint',  'Read File',          'Read existing code to ground the blueprint in reality',          'FileText',   'native', FALSE, 2),
     ('list_files',      'blueprint',  'List Files',         'Survey the repo tree before drafting',                           'FolderTree', 'native', FALSE, 3)
   ) AS v(key, agent_type_key, label, description, icon, handler_kind, is_custom, sort_order)
   WHERE NOT EXISTS (SELECT 1 FROM mcp_skills)`,

  // Let roster agents (ai_agents, used by cascade/multi-agent mode) optionally
  // bind to one of the modular MCP agent types above and carry their own
  // explicit skill selection instead of the global tools_enabled toggle set.
  "ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS agent_type TEXT",
  "ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS skills TEXT DEFAULT '[]'",

  // Blueprints drafted by the Blueprint agent, handed off to Builder/Local.
  `CREATE TABLE IF NOT EXISTS mcp_blueprints (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    affected_files TEXT DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mcp_blueprints_session ON mcp_blueprints(session_id, created_at DESC)",

  // Chat history for the modular MCP agent console (separate from the legacy
  // single-agent ai_agent_messages so the two systems don't collide).
  `CREATE TABLE IF NOT EXISTS mcp_agent_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL DEFAULT 'default',
    agent_type_key TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    tool_input TEXT,
    tool_output TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mcp_agent_msgs_session ON mcp_agent_messages(session_id, created_at DESC)",

  // Configurable "Dev" sidebar (dev-nav.ts routes) — table was missing from
  // migrations entirely, causing GET /admin/dev-nav to 500 on a fresh DB.
  `CREATE TABLE IF NOT EXISTS dev_nav_items (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER,
    level INTEGER NOT NULL DEFAULT 1,
    label TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'Circle',
    href TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_seed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,

  // Extends dev_nav_items to back every role's sidebar (not just Dev): adds
  // nav_type ('dev'|'user'|'admin'|'moderator'|'team_leader', defaults to
  // 'dev' so existing rows keep working untouched) and plugin_slug (mirrors
  // the old hardcoded nav arrays' plugin-gating).
  "ALTER TABLE dev_nav_items ADD COLUMN IF NOT EXISTS nav_type TEXT NOT NULL DEFAULT 'dev'",
  "ALTER TABLE dev_nav_items ADD COLUMN IF NOT EXISTS plugin_slug TEXT",
  "CREATE INDEX IF NOT EXISTS idx_dev_nav_items_nav_type ON dev_nav_items(nav_type)",

  // Real-money Polymarket trade log (routes/polymarket.ts). Local audit trail
  // only — Polymarket's CLOB is the source of truth for order/fill state.
  `CREATE TABLE IF NOT EXISTS polymarket_trades (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    wallet_id INTEGER NOT NULL,
    market_id TEXT NOT NULL,
    market_question TEXT,
    token_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    side TEXT NOT NULL DEFAULT 'BUY',
    price REAL NOT NULL,
    size_usdc REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    clob_order_id TEXT,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_polymarket_trades_user ON polymarket_trades(user_id)",

  // Admin wallet — collects marketplace fees + subscription revenue + account/OTP
  // sale proceeds into one auditable ledger (services/admin-wallet.ts).
  `CREATE TABLE IF NOT EXISTS admin_wallet_ledger (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'AZN',
    ref_id TEXT,
    user_id INTEGER,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_admin_wallet_source ON admin_wallet_ledger(source)",
  // Marks a marketplace_transactions row's fee as already swept into the admin
  // wallet, so the sweep (services/admin-wallet.ts sweepMarketplaceFees) never
  // double-credits the same trade across every marketplace type (vault, azn,
  // bundles, cart, game, nft, offers) without needing to edit each of those
  // route files individually.
  "ALTER TABLE marketplace_transactions ADD COLUMN IF NOT EXISTS admin_credited BOOLEAN NOT NULL DEFAULT FALSE",
  "CREATE INDEX IF NOT EXISTS idx_mktx_admin_credited ON marketplace_transactions(admin_credited)",

  // Marks a vault_market_listings row as AYZEN-owned inventory (Gmail/Twitter/
  // Discord/GitHub/Facebook/WhatsApp/Telegram/Outlook accounts + OTP numbers
  // sold directly by the platform) rather than a peer-to-peer user listing.
  // Powers the "Account Store" section of the renamed P2P Market page.
  "ALTER TABLE vault_market_listings ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE",
  "CREATE INDEX IF NOT EXISTS idx_vault_market_official ON vault_market_listings(is_official)",

  // USDT/BDT P2P listings — a separate table from azn_listings (rather than
  // reusing it with a currency filter) so the AZN market's existing queries
  // never need to change and can't accidentally pick up USDT rows.
  `CREATE TABLE IF NOT EXISTS usdt_listings (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    price_per_unit REAL NOT NULL,
    total_price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    settle_currency TEXT NOT NULL DEFAULT 'BDT',
    min_buy REAL DEFAULT 0,
    order_type TEXT DEFAULT 'sell',
    payment_method TEXT DEFAULT 'bkash',
    payment_details TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    buyer_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_usdt_listings_status ON usdt_listings(status)",
  // ── Per-market admin config (Vault Market / Game Market fee % + enable switch) ──
  // Backs lib/market-config.ts — replaces the hardcoded `const FEE_PCT = 5`
  // that used to live at the top of marketplace-vault.ts / marketplace-game.ts.
  `CREATE TABLE IF NOT EXISTS marketplace_market_configs (
    id SERIAL PRIMARY KEY,
    market_type TEXT NOT NULL UNIQUE,
    fee_pct REAL NOT NULL DEFAULT 5,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,

  // ── Project photo/banner upload (stored as data-URL text — no object
  // storage configured for this app, so uploads are base64-encoded client
  // side and saved straight into these text columns, same as thumbnail_url) ──
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS banner_url TEXT",

  // ── Structured tutorial step-builder (replaces/augments the old freeform
  // tutorial_notes blob). JSON array of {title, description, link}. ──
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS tutorial_steps TEXT",

  // ── Vault entity rank/badge system: 0-10 score → 5-tier rank (Warrior /
  // Elite / Master / Grandmaster / Mythic), computed client+server side from
  // this score. Applies to both vault_entries ("entity" vault) and
  // local_accounts ("local" vault) so every entity type gets a badge. ──
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 5",
  "ALTER TABLE local_accounts ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 5",

  // ── Account tab restructure (Main/Info/Recovery/Wallet sub-tabs) + Drive
  // wallet + follower tracking. See config/fields/entity-create.ts. ────────
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS username TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS account_password TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS email_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS email_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS recovery_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS recovery_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS buy_date TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS create_date TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS followers INTEGER NOT NULL DEFAULT 0",
  // Drive wallet — fixed, set-once record (immutable once set)
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS drive_wallet_label TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS drive_wallet_address TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS drive_wallet_note TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS drive_wallet_set_at TIMESTAMP",

  // ── Vault Mail Hub hierarchy: persistent mail storage (30-day retention) ──
  // Emails synced via IMAP are cached here so the Mail Hub's per-entity
  // Overview/Email tabs and individual message pages don't need a live IMAP
  // round-trip on every click. Rows older than 30 days are purged by
  // purgeOldMail() below.
  `CREATE TABLE IF NOT EXISTS mail_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    email_account_id INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    source_category TEXT NOT NULL DEFAULT 'other',
    source_id TEXT,
    uid INTEGER NOT NULL,
    seqno INTEGER,
    from_addr TEXT,
    to_addr TEXT,
    subject TEXT,
    body_text TEXT,
    message_date TIMESTAMP,
    fetched_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(email_account_id, uid)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mail_messages_account ON mail_messages(email_account_id, message_date DESC)",
  "CREATE INDEX IF NOT EXISTS idx_mail_messages_user_cat ON mail_messages(user_id, source_category, source_id)",
  "CREATE INDEX IF NOT EXISTS idx_mail_messages_created ON mail_messages(created_at)",

  // ── Mail Hub full-text search — indexes subject + sender only. body_text is
  // encrypted (see lib/vault-crypto.ts) and deliberately left out of the
  // search index: a plaintext search copy of email bodies would defeat the
  // point of encrypting them (OTP codes, personal info, etc. often sit right
  // in the body). Search-by-subject/sender covers the common "find that
  // email from X" case without that tradeoff.
  "ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS search_vector tsvector",
  `CREATE OR REPLACE FUNCTION mail_messages_search_vector_update() RETURNS trigger AS $$
   BEGIN
     NEW.search_vector := to_tsvector('english', coalesce(NEW.subject,'') || ' ' || coalesce(NEW.from_addr,''));
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql`,
  "DROP TRIGGER IF EXISTS trg_mail_messages_search_vector ON mail_messages",
  `CREATE TRIGGER trg_mail_messages_search_vector BEFORE INSERT OR UPDATE ON mail_messages
   FOR EACH ROW EXECUTE FUNCTION mail_messages_search_vector_update()`,
  "CREATE INDEX IF NOT EXISTS idx_mail_messages_search_vector ON mail_messages USING GIN(search_vector)",
  // Backfill existing rows once (trigger only covers future inserts/updates)
  "UPDATE mail_messages SET search_vector = to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(from_addr,'')) WHERE search_vector IS NULL",

  // ── Vault Tags + Custom Labels + Grouping ──────────────────────────────────
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS tags TEXT",

  // ── Vault Health Monitor + Alert System ────────────────────────────────────
  // Tracks when the health-rules engine last flagged this entry, so the
  // periodic checker doesn't re-notify for the same unresolved issue every run.
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS last_health_alert_at TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS last_health_flags TEXT",

  // ── Uptime bot: self-ping keepalive + public status page ────────────────
  `CREATE TABLE IF NOT EXISTS uptime_pings (
    id SERIAL PRIMARY KEY,
    target TEXT NOT NULL DEFAULT 'self',
    is_up BOOLEAN NOT NULL,
    status_code INTEGER,
    latency_ms REAL,
    error_message TEXT,
    checked_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS idx_uptime_pings_checked_at ON uptime_pings(checked_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_uptime_pings_target ON uptime_pings(target, checked_at DESC)",

  // ── Phase 3: Project ↔ Entity Enrollment Bridge ─────────────────────────
  // Enrollment-level account snapshot (Main/Info/Recovery fields), captured
  // at enroll time and scoped to the project — independent of the entity's
  // own vault_entries row. Nullable, no backfill for existing rows.
  "ALTER TABLE project_enrollments ADD COLUMN IF NOT EXISTS account_data TEXT",

  // ── Vault Entity Sharing/Transfer — access to a local/entity/kyc/game
  // vault item can be granted to another user WITHOUT changing ownership.
  // owner_id never changes; the row's original user_id in its own table
  // stays the source of truth for ownership. Turning is_active off simply
  // removes the recipient's access — it does not delete or move anything.
  // See routes/vault-shares.ts.
  `CREATE TABLE IF NOT EXISTS vault_shares (
    id SERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    owner_id INTEGER NOT NULL,
    shared_with_user_id INTEGER NOT NULL,
    permission TEXT NOT NULL DEFAULT 'view',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMP
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS vault_shares_unique ON vault_shares(entity_type, entity_id, shared_with_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_vault_shares_owner ON vault_shares(owner_id, entity_type)",
  "CREATE INDEX IF NOT EXISTS idx_vault_shares_recipient ON vault_shares(shared_with_user_id, is_active)",

  // ── Vault Entity Relationship Linking — airdrop farming main + alt accounts
  // live as separate vault_entries rows with no structural connection. This
  // table lets a user mark "this is an alt of X" / "shares wallet with Y".
  // Directional (entity_id -> linked_entity_id); the UI resolves both
  // directions so the link shows on either entity's detail page.
  // See routes/vault-entity-links.ts.
  `CREATE TABLE IF NOT EXISTS vault_entity_links (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    entity_id INTEGER NOT NULL,
    linked_entity_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS vault_entity_links_unique ON vault_entity_links(entity_id, linked_entity_id, relation_type)",
  "CREATE INDEX IF NOT EXISTS idx_vault_entity_links_entity ON vault_entity_links(entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_vault_entity_links_linked ON vault_entity_links(linked_entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_vault_entity_links_user ON vault_entity_links(user_id)",

  // ── Field-level encryption at rest — KMS-style envelope encryption for
  // lib/vault-crypto.ts. encryption_keys holds wrapped (never plaintext) data
  // -encryption keys, one active per namespace; encryption_version on each
  // sensitive table stamps which key version encrypted that row's columns,
  // so scripts/src/reencrypt-vault.ts knows what still needs migrating after
  // a rotation. See lib/vault-crypto.ts for the full design note.
  `CREATE TABLE IF NOT EXISTS encryption_keys (
    id SERIAL PRIMARY KEY,
    namespace TEXT NOT NULL,
    version INTEGER NOT NULL,
    wrapped_dek TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(namespace, version)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_encryption_keys_namespace_active ON encryption_keys(namespace, active)",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS encryption_version INTEGER",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS encryption_version INTEGER",
  "ALTER TABLE local_accounts ADD COLUMN IF NOT EXISTS encryption_version INTEGER",
  "ALTER TABLE game_entries ADD COLUMN IF NOT EXISTS encryption_version INTEGER",
  "ALTER TABLE other_two_factor_codes ADD COLUMN IF NOT EXISTS encryption_version INTEGER",
  "ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS encryption_version INTEGER",
  "ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS encryption_version INTEGER",

  // Phase 5 — Vault Security: PINs & Session. One row per user; both PIN
  // columns hashed (bcrypt, see lib/password.ts) and independent of each
  // other. See lib/db/src/schema/vault-security.ts and routes/vault-security.ts.
  "CREATE TABLE IF NOT EXISTS vault_security (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, vault_pin_hash TEXT, entity_pin_hash TEXT, updated_at TIMESTAMP NOT NULL DEFAULT NOW())",
  // ── Phase 30 (Vault/Project/Team Overhaul roadmap doc, Phase 4): generic
  // activity_log — subject_type/subject_id keyed so Phase 15 (team activity
  // log) can reuse this same table instead of a second bespoke one. Powers
  // per-entity project-enrollment history (enrolled/left/reward events). ──
  `CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_user_id INTEGER,
    amount REAL,
    meta TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  "CREATE INDEX IF NOT EXISTS activity_log_subject_idx ON activity_log (subject_type, subject_id)",
  // Phase 31 (Vault/Project/Team Overhaul roadmap doc, Phase 7A): project
  // badges/tags. JSON-stringified array of strings, same storage convention
  // as tutorial_steps. Editable in admin, rendered on card/detail/compare
  // in Phase 7B.
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS badges TEXT",
  // Phase 16 (Vault/Project/Team Overhaul roadmap doc): per-platform field
  // parity with the Account tab — notes + last-login/buy-date/create-date
  // group for Twitter/Discord/Telegram, plus the missing telegram_followers.
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_followers TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_last_login_at TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_buy_date TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_create_date TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_notes TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_last_login_at TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_buy_date TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_create_date TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_notes TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_last_login_at TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_buy_date TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_create_date TIMESTAMP",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_notes TEXT",
  // Entity/Local/KYC ban feature: per-platform ban flags on vault_entries
  // (twitter/discord/telegram — "other" platform accounts carry their own
  // `banned` boolean inside the other_accounts JSON blob, no column needed),
  // plus a status column on local_accounts/kyc_entries so those two entity
  // types can be banned/unbanned the same way vault_entries.status already
  // supports (see routes/vault.ts PATCH /vault/:id).
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_banned BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_banned BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_banned BOOLEAN NOT NULL DEFAULT FALSE",
  "ALTER TABLE local_accounts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",
  // vault_entry_id links a local account to the vault entity that "owns" it —
  // set when the user imports a local entity's credentials into a vault entity
  // platform slot (Twitter / Discord / Telegram). Nullable: unlinked accounts
  // are "free" and can be imported into a new entity.
  "ALTER TABLE local_accounts ADD COLUMN IF NOT EXISTS vault_entry_id INTEGER",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",
  // KYC extended fields — Account tab Main/Info/Recovery parity with vault entity
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS account_2fa TEXT",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS account_backup_code TEXT",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS account_create_date TIMESTAMP",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS account_buy_date TIMESTAMP",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS account_buy_price REAL DEFAULT 0",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS account_worth REAL DEFAULT 0",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS followers TEXT",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS email_recovery TEXT",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS email_recovery_password TEXT",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS recovery_2fa TEXT",
  "ALTER TABLE kyc_entries ADD COLUMN IF NOT EXISTS recovery_backup_code TEXT",
  // New credential fields — account-level 2FA/backup + per-platform email2fa/backup/recovery
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS account_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS account_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_account_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_email_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_email_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_recovery_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS twitter_recovery_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_account_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_email_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_email_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_recovery_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS discord_recovery_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_account_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_email_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_email_backup_code TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_recovery_2fa TEXT",
  "ALTER TABLE vault_entries ADD COLUMN IF NOT EXISTS telegram_recovery_backup_code TEXT",
];

async function waitForDbThenMigrate(): Promise<void> {
  logBus.system("DB probe started — waiting for connection...");
  let attempts = 0;
  while (true) {
    try {
      await db.execute(sql`SELECT 1`);
      break;
    } catch (err: any) {
      attempts++;
      if (attempts % 5 === 0) {
        logBus.warn(`DB still offline after ${attempts} probes: ${err?.message ?? err}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  logBus.system("✅ Database connected — running startup migrations");
  for (const q of MIGRATIONS) {
    try {
      await db.execute(sql.raw(q));
      logBus.system(`Migration OK: ${q.replace("ALTER TABLE ", "").slice(0, 60)}`);
    } catch (err: any) {
      logger.warn({ err, q }, "Migration statement warning (column may already exist)");
      logBus.warn(`Migration skip (exists): ${q.slice(0, 60)}`);
    }
  }
  logBus.system("✅ All startup migrations complete");
  logger.info("Startup migrations complete");

  try {
    const { loadKeyManager, getActiveVersion } = await import("./lib/vault-crypto");
    await loadKeyManager();
    logBus.system(`✅ Vault field-encryption key manager loaded (active version v${getActiveVersion()})`);
  } catch (err: any) {
    // Not fatal — encryptField()/decryptField() fall back to the legacy key
    // until this succeeds, so writes/reads keep working either way.
    logger.warn({ err }, "Vault key manager load failed — falling back to legacy field key for now");
    logBus.warn(`Vault key manager load failed: ${err?.message ?? err}`);
  }
}

// ── Mail retention: auto-delete synced mail_messages older than 30 days ────
async function purgeOldMail(): Promise<void> {
  try {
    const result: any = await db.execute(sql`DELETE FROM mail_messages WHERE created_at < NOW() - INTERVAL '30 days'`);
    const removed = result?.rowCount ?? result?.rows?.length ?? 0;
    if (removed) logBus.system(`Mail retention purge: removed ${removed} message(s) older than 30d`);
  } catch (err: any) {
    logger.warn({ err }, "Mail retention purge failed");
  }
}
setTimeout(purgeOldMail, 20000);
setInterval(purgeOldMail, 6 * 60 * 60 * 1000); // re-check every 6h

// ── Mail Hub: scheduled auto-sync — periodically pull new mail for every
// IMAP-configured account so the Mail Hub stays fresh without a manual
// "Sync" click. Runs a few minutes after boot, then every 20 minutes.
async function runScheduledMailSync(): Promise<void> {
  try {
    const { syncAllMailAccounts } = await import("./lib/mail-sync");
    const { synced, failed } = await syncAllMailAccounts();
    if (synced || failed) logBus.system(`Mail auto-sync: ${synced} account(s) synced, ${failed} failed`);
  } catch (err: any) {
    logger.warn({ err }, "Scheduled mail auto-sync failed");
  }
}
setTimeout(runScheduledMailSync, 60000);
setInterval(runScheduledMailSync, 20 * 60 * 1000); // every 20 minutes

setTimeout(waitForDbThenMigrate, 2000);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    logBus.error(`Server failed to start: ${(err as Error).message}`);
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  logBus.system(`🚀 AYZEN API Server started on port ${port}`);
  initTelegramBot();
  startUptimeBot(port);
  startVaultHealthCron();

  // Graceful shutdown — stop Telegram polling before exit so the next start has no 409
  const shutdown = () => {
    stopTelegramBot().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
});
