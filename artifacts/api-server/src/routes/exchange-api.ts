/**
 * routes/exchange-api.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Exchange API integration: store encrypted API keys on KYC entries and proxy
 * real-time balance/portfolio requests to supported CEX platforms (Binance,
 * Bybit, KuCoin, Bitget). Keys never leave the server unencrypted.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import axios from "axios";
import { createHmac } from "crypto";
import { encryptField, decryptField } from "../lib/vault-crypto";

const router = Router();
const safe = (v: unknown) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

// ── GET /exchange-balance/:kycId ─────────────────────────────────────────────
// Fetch real-time spot-account balance from the exchange linked to a KYC entry.
router.get("/exchange-balance/:kycId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const kycId = parseInt(req.params.kycId as string);
  if (isNaN(kycId)) { res.status(400).json({ error: "Invalid KYC ID" }); return; }

  try {
    const result = await db.execute(
      sql.raw(`SELECT platform, username, name, exchange_api_key, exchange_api_secret FROM kyc_entries WHERE id = ${kycId} AND user_id = ${userId} LIMIT 1`)
    );
    if (!result.rows.length) { res.status(404).json({ error: "KYC entry not found" }); return; }

    const row = result.rows[0] as any;
    const apiKey    = row.exchange_api_key    ? decryptField(row.exchange_api_key)    : null;
    const apiSecret = row.exchange_api_secret ? decryptField(row.exchange_api_secret) : null;
    const platform  = (row.platform || "").toLowerCase();

    if (!apiKey || !apiSecret) {
      res.json({ hasKeys: false, exchange: platform, balances: [] });
      return;
    }

    // ── Binance ────────────────────────────────────────────────────────────
    if (platform.includes("binance")) {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = createHmac("sha256", apiSecret).update(queryString).digest("hex");

      const { data } = await axios.get("https://api.binance.com/api/v3/account", {
        headers: { "X-MBX-APIKEY": apiKey },
        params: { timestamp, signature },
        timeout: 8000,
      });

      const balances = (data.balances ?? [])
        .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map((b: any) => ({ asset: b.asset, free: b.free, locked: b.locked }));

      res.json({ hasKeys: true, exchange: "binance", balances, canTrade: data.canTrade, accountType: data.accountType });
      return;
    }

    // ── Bybit ──────────────────────────────────────────────────────────────
    if (platform.includes("bybit")) {
      const timestamp = Date.now().toString();
      const recvWindow = "5000";
      const signStr = timestamp + apiKey + recvWindow;
      const signature = createHmac("sha256", apiSecret).update(signStr).digest("hex");

      const { data } = await axios.get("https://api.bybit.com/v5/account/wallet-balance", {
        headers: {
          "X-BAPI-API-KEY": apiKey,
          "X-BAPI-SIGN": signature,
          "X-BAPI-SIGN-METHOD": "HMAC",
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-RECV-WINDOW": recvWindow,
        },
        params: { accountType: "UNIFIED" },
        timeout: 8000,
      });

      const coins = data?.result?.list?.[0]?.coin ?? [];
      const balances = coins
        .filter((c: any) => parseFloat(c.walletBalance) > 0)
        .map((c: any) => ({
          asset: c.coin,
          free: c.availableToWithdraw,
          locked: String(parseFloat(c.walletBalance) - parseFloat(c.availableToWithdraw)),
        }));

      res.json({ hasKeys: true, exchange: "bybit", balances });
      return;
    }

    // ── KuCoin ─────────────────────────────────────────────────────────────
    if (platform.includes("kucoin")) {
      const timestamp = Date.now().toString();
      const strToSign = `${timestamp}GET/api/v1/accounts`;
      const signature = Buffer.from(
        createHmac("sha256", apiSecret).update(strToSign).digest()
      ).toString("base64");

      const { data } = await axios.get("https://api.kucoin.com/api/v1/accounts", {
        headers: {
          "KC-API-KEY": apiKey,
          "KC-API-SIGN": signature,
          "KC-API-TIMESTAMP": timestamp,
          "KC-API-PASSPHRASE": "",
        },
        timeout: 8000,
      });

      const balances = (data?.data ?? [])
        .filter((a: any) => a.type === "trade" && parseFloat(a.available) > 0)
        .map((a: any) => ({ asset: a.currency, free: a.available, locked: a.holds }));

      res.json({ hasKeys: true, exchange: "kucoin", balances });
      return;
    }

    // ── Bitget ─────────────────────────────────────────────────────────────
    if (platform.includes("bitget")) {
      const timestamp = Date.now().toString();
      const strToSign = `${timestamp}GET/api/v2/spot/account/assets`;
      const signature = Buffer.from(
        createHmac("sha256", apiSecret).update(strToSign).digest()
      ).toString("base64");

      const { data } = await axios.get("https://api.bitget.com/api/v2/spot/account/assets", {
        headers: {
          "ACCESS-KEY": apiKey,
          "ACCESS-SIGN": signature,
          "ACCESS-TIMESTAMP": timestamp,
          "ACCESS-PASSPHRASE": "",
        },
        timeout: 8000,
      });

      const balances = (data?.data ?? [])
        .filter((a: any) => parseFloat(a.available) > 0 || parseFloat(a.frozen) > 0)
        .map((a: any) => ({ asset: a.coin, free: a.available, locked: a.frozen }));

      res.json({ hasKeys: true, exchange: "bitget", balances });
      return;
    }

    res.json({ hasKeys: true, exchange: platform, balances: [], note: "Exchange not yet supported — add API keys and we will call the balance endpoint." });
  } catch (err: any) {
    const httpStatus = err?.response?.status;
    if (httpStatus === 401 || httpStatus === 403) {
      res.json({ hasKeys: true, error: "Invalid API key or IP not whitelisted by the exchange", balances: [] });
      return;
    }
    res.status(200).json({ hasKeys: true, error: `Exchange API error: ${err?.message ?? "unknown"}`, balances: [] });
  }
});

// ── PATCH /kyc-entries/:id/exchange-keys — save encrypted key pair ───────────
router.patch("/kyc-entries/:id/exchange-keys", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { apiKey, apiSecret } = req.body as { apiKey?: string; apiSecret?: string };
  const setParts: string[] = [];
  if (apiKey !== undefined)    setParts.push(`exchange_api_key = ${safe(apiKey ? encryptField(apiKey) : null)}`);
  if (apiSecret !== undefined) setParts.push(`exchange_api_secret = ${safe(apiSecret ? encryptField(apiSecret) : null)}`);
  if (setParts.length === 0)  { res.status(400).json({ error: "Nothing to update" }); return; }

  try {
    await db.execute(
      sql.raw(`UPDATE kyc_entries SET ${setParts.join(", ")}, updated_at = NOW() WHERE id = ${id} AND user_id = ${userId}`)
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

export default router;
