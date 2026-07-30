import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { getMarketConfig } from "../lib/market-config";

const router = Router();

async function ensureWallet(userId: number): Promise<number> {
  await pool.query(
    `INSERT INTO marketplace_wallets (user_id, market_type, balance, locked_balance)
     VALUES ($1, 'vault', 0, 0) ON CONFLICT (user_id, market_type) DO NOTHING`,
    [userId]
  );
  const r = await pool.query(
    "SELECT balance FROM marketplace_wallets WHERE user_id=$1 AND market_type='vault'",
    [userId]
  );
  return Number(r.rows[0]?.balance ?? 0);
}

// ── GET /marketplace/vault/listings ──────────────────────────────────────────
router.get("/marketplace/vault/listings", requireAuth, async (req, res): Promise<void> => {
  const { limit = 50, offset = 0, category, account_type, vault_type, order_type, min_price, max_price, official } = req.query as any;
  try {
    let q = `
      SELECT vl.*, u.username AS seller_username
      FROM vault_market_listings vl
      LEFT JOIN users u ON u.id = vl.seller_id
      WHERE vl.status = 'active'
    `;
    const params: any[] = [];
    if (category) { params.push(category); q += ` AND vl.category = $${params.length}`; }
    if (account_type) { params.push(account_type); q += ` AND vl.account_type = $${params.length}`; }
    if (vault_type) { params.push(vault_type); q += ` AND vl.vault_type = $${params.length}`; }
    if (order_type) { params.push(order_type); q += ` AND vl.order_type = $${params.length}`; }
    if (min_price) { params.push(Number(min_price)); q += ` AND vl.price >= $${params.length}`; }
    if (max_price) { params.push(Number(max_price)); q += ` AND vl.price <= $${params.length}`; }
    // official=true -> AYZEN's own Account Store inventory only.
    // official=false -> peer-to-peer user listings only (excludes the store).
    if (official === "true") { q += ` AND vl.is_official = TRUE`; }
    else if (official === "false") { q += ` AND vl.is_official = FALSE`; }
    q += ` ORDER BY vl.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), Number(offset));
    const r = await pool.query(q, params);
    const cnt = await pool.query("SELECT COUNT(*) FROM vault_market_listings WHERE status='active'");
    const listings = r.rows.map(row => ({
      ...row,
      preview_data: row.preview_data ? JSON.parse(row.preview_data) : null,
      account_details: row.account_details ? JSON.parse(row.account_details) : null,
    }));
    const { feePct } = await getMarketConfig("vault");
    res.json({ listings, total: Number(cnt.rows[0].count), fee_pct: feePct });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── POST /marketplace/vault/listings ─────────────────────────────────────────
router.post("/marketplace/vault/listings", requireAuth, async (req, res): Promise<void> => {
  const sellerId = req.user!.userId;
  const {
    vault_entry_id, local_account_id,
    title, description, price, price_min, price_max,
    category, tier = "basic",
    order_type = "sell",
    account_type,
    account_details,
    vault_type = "entity",
    official,
  } = req.body;
  if (order_type === "sell" && !price) { res.status(400).json({ error: "price required for sell order" }); return; }
  if (order_type === "buy" && !account_type) { res.status(400).json({ error: "account_type required for buy order" }); return; }
  const { enabled } = await getMarketConfig("vault");
  if (!enabled) { res.status(403).json({ error: "Vault Market is currently disabled" }); return; }
  try {
    let previewData = null;
    // Verify ownership of referenced vault asset before listing
    if (vault_entry_id && vault_type === "entity") {
      const ve = await pool.query(
        "SELECT * FROM vault_entries WHERE id=$1 AND user_id=$2",
        [vault_entry_id, sellerId]
      );
      if (!ve.rows[0]) { res.status(403).json({ error: "Vault entry not found or not yours" }); return; }
      const e = ve.rows[0];
      previewData = JSON.stringify({
        project_name: e.project_name,
        has_twitter: !!e.twitter_username,
        has_discord: !!e.discord_username,
        has_telegram: !!e.telegram_phone,
        has_email: !!e.email,
        has_wallet: !!(e.wallet_addresses),
        entity_serial: e.entity_serial,
      });
    } else if (local_account_id && vault_type === "local") {
      const la = await pool.query(
        "SELECT * FROM local_accounts WHERE id=$1 AND user_id=$2",
        [local_account_id, sellerId]
      );
      if (!la.rows[0]) { res.status(403).json({ error: "Local account not found or not yours" }); return; }
      const a = la.rows[0];
      previewData = JSON.stringify({
        category: a.category,
        has_2fa: !!a.twofa,
        account_create_date: a.account_create_date,
        followers: a.followers,
      });
    }

    const effectiveTitle = title || `${account_type ? account_type.charAt(0).toUpperCase() + account_type.slice(1) : "Account"} buy request`;
    const effectivePrice = order_type === "buy" ? (price_min ?? 0) : Number(price);
    // Only an admin can mark a listing as official AYZEN inventory — this is
    // what makes it show up in the Account Store section rather than as a
    // regular peer listing. Never trust a non-admin-supplied `official: true`.
    const isOfficial = official === true && req.user!.role === "admin";

    const r = await pool.query(
      `INSERT INTO vault_market_listings
         (seller_id, vault_entry_id, title, description, price, category, tier,
          preview_data, order_type, account_type, account_details, vault_type, price_min, price_max, is_official)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        sellerId,
        vault_entry_id ?? local_account_id ?? null,
        effectiveTitle,
        description ?? null,
        effectivePrice,
        category ?? account_type ?? "Other",
        tier,
        previewData,
        order_type,
        account_type ?? null,
        account_details ? JSON.stringify(account_details) : null,
        vault_type,
        price_min ? Number(price_min) : null,
        price_max ? Number(price_max) : null,
        isOfficial,
      ]
    );
    res.json({
      ...r.rows[0],
      preview_data: previewData ? JSON.parse(previewData) : null,
      account_details: account_details ?? null,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── POST /marketplace/vault/buy ────────────────────────────────────────────────
router.post("/marketplace/vault/buy", requireAuth, async (req, res): Promise<void> => {
  const buyerId = req.user!.userId;
  const { listing_id } = req.body;
  if (!listing_id) { res.status(400).json({ error: "listing_id required" }); return; }
  try {
    // Only allow purchasing sell-type listings (buy-orders are fulfilled via a different flow)
    const listR = await pool.query(
      "SELECT * FROM vault_market_listings WHERE id=$1 AND status='active' AND (order_type='sell' OR order_type IS NULL)",
      [listing_id]
    );
    if (!listR.rows[0]) { res.status(404).json({ error: "Listing not found, sold, or is not a sell listing" }); return; }
    const listing = listR.rows[0];
    if (listing.seller_id === buyerId) { res.status(400).json({ error: "Cannot buy your own listing" }); return; }
    const balance = await ensureWallet(buyerId);
    if (balance < Number(listing.price)) { res.status(400).json({ error: "Insufficient vault wallet balance" }); return; }
    const { feePct } = await getMarketConfig("vault");
    const fee = Number(listing.price) * (feePct / 100);
    const net = Number(listing.price) - fee;
    await pool.query("BEGIN");
    try {
      // Debit buyer
      await pool.query(
        "UPDATE marketplace_wallets SET balance=balance-$1, updated_at=NOW() WHERE user_id=$2 AND market_type='vault'",
        [Number(listing.price), buyerId]
      );
      // Credit seller (minus fee)
      await pool.query(
        "UPDATE marketplace_wallets SET balance=balance+$1, updated_at=NOW() WHERE user_id=$2 AND market_type='vault'",
        [net, listing.seller_id]
      );
      // Mark listing sold
      await pool.query(
        "UPDATE vault_market_listings SET status='sold', buyer_id=$1, sold_at=NOW() WHERE id=$2",
        [buyerId, listing_id]
      );
      // Transfer the vault asset
      if (listing.vault_entry_id) {
        if (listing.vault_type === "entity") {
          const transferResult = await pool.query(
            "UPDATE vault_entries SET user_id=$1 WHERE id=$2 AND user_id=$3 RETURNING id",
            [buyerId, listing.vault_entry_id, listing.seller_id]
          );
          if (transferResult.rowCount === 0) {
            // Seller no longer owns this asset; rollback to protect buyer
            await pool.query("ROLLBACK");
            res.status(409).json({ error: "Asset ownership conflict — seller may no longer own this entry" }); return;
          }
        } else if (listing.vault_type === "local") {
          const transferResult = await pool.query(
            "UPDATE local_accounts SET user_id=$1 WHERE id=$2 AND user_id=$3 RETURNING id",
            [buyerId, listing.vault_entry_id, listing.seller_id]
          );
          if (transferResult.rowCount === 0) {
            await pool.query("ROLLBACK");
            res.status(409).json({ error: "Asset ownership conflict — seller may no longer own this local account" }); return;
          }
        }
      }
      // Record transaction
      await pool.query(
        `INSERT INTO marketplace_transactions (market_type,listing_id,buyer_id,seller_id,amount,fee,net_amount)
         VALUES ('vault',$1,$2,$3,$4,$5,$6)`,
        [listing_id, buyerId, listing.seller_id, Number(listing.price), fee, net]
      );
      await pool.query("COMMIT");
      res.json({ ok: true, title: listing.title, price: Number(listing.price), fee, net });
    } catch (e) { await pool.query("ROLLBACK"); throw e; }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /marketplace/vault/listings/:id ────────────────────────────────────
router.delete("/marketplace/vault/listings/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const r = await pool.query("SELECT * FROM vault_market_listings WHERE id=$1 AND status='active'", [id]);
    if (!r.rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    const listing = r.rows[0];
    if (listing.seller_id !== userId && req.user!.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
    await pool.query("UPDATE vault_market_listings SET status='cancelled' WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── GET /marketplace/vault/stats ──────────────────────────────────────────────
router.get("/marketplace/vault/stats", requireAuth, async (_req, res): Promise<void> => {
  try {
    const [active, buy_orders, volume] = await Promise.all([
      pool.query("SELECT COUNT(*) as cnt, MIN(price) as floor, AVG(price) as avg_price FROM vault_market_listings WHERE status='active' AND (order_type='sell' OR order_type IS NULL)"),
      pool.query("SELECT COUNT(*) as cnt FROM vault_market_listings WHERE status='active' AND order_type='buy'"),
      pool.query("SELECT SUM(amount) as vol, COUNT(*) as sales FROM marketplace_transactions WHERE market_type='vault'"),
    ]);
    const { feePct } = await getMarketConfig("vault");
    res.json({
      active_listings: Number(active.rows[0].cnt),
      active_buy_orders: Number(buy_orders.rows[0].cnt),
      floor_price: Number(active.rows[0].floor ?? 0),
      avg_price: Number(active.rows[0].avg_price ?? 0),
      total_volume: Number(volume.rows[0].vol ?? 0),
      total_sales: Number(volume.rows[0].sales),
      fee_pct: feePct,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
