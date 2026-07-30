import { Router } from "express";
import { db, creditsTable, creditTransactionsTable, subscriptionsTable, settingsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { broadcastEvent } from "./events";
import { mintNftForUser } from "./nft-subscriptions";

const router = Router();

function getAuthUser(req: any): { id: number; role: string } | null {
  const auth = req.headers.authorization as string | undefined;
  if (!auth) return null;
  try {
    const p = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return { id: p.userId, role: p.role ?? "user" };
  } catch { return null; }
}

// Credit packages
export const CREDIT_PACKAGES = [
  { id: "starter",    label: "Starter",    credits: 1_000,  priceBDT: 100,   priceUSDT: 1,    bonus: 0  },
  { id: "basic",      label: "Basic",      credits: 5_500,  priceBDT: 450,   priceUSDT: 4.5,  bonus: 10 },
  { id: "pro",        label: "Pro Pack",   credits: 18_000, priceBDT: 1_200, priceUSDT: 12,   bonus: 20 },
  { id: "mega",       label: "Mega",       credits: 65_000, priceBDT: 3_500, priceUSDT: 35,   bonus: 30 },
];

// AZN rates
const CREDITS_PER_AZN = 100;
const AZN_FOR_PRO = 200;
const AZN_FOR_ENTERPRISE = 1000;

// AZN token market price
const AZN_PRICE_USD = 0.01;
const USD_TO_BDT = 130;

// Admin payment config — DB (admin settings panel) takes priority, env vars are
// a fallback for first boot before the admin has configured anything.
async function getAdminPaymentInfo() {
  const [s] = await db.select().from(settingsTable).limit(1);
  return {
    bkash: s?.bkashNumber || process.env["BKASH_NUMBER"] || "01XXXXXXXXX",
    nagad: s?.nagadNumber || process.env["NAGAD_NUMBER"] || "01XXXXXXXXX",
    usdt: s?.usdtAddress || process.env["USDT_ADDRESS"] || "TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    usdtNetwork: s?.usdtNetwork || process.env["USDT_NETWORK"] || "TRC20",
  };
}

// ─── Helper: get or create credit row ─────────────────────────────────────────
async function getOrCreateCredits(userId: number) {
  const [row] = await db.select().from(creditsTable).where(eq(creditsTable.userId, userId));
  if (row) return row;
  const [created] = await db.insert(creditsTable).values({ userId }).returning();
  return created;
}

// ─── GET /api/credits — my balance ────────────────────────────────────────────
router.get("/credits", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const credits = await getOrCreateCredits(authUser.id);
  const txs = await db.select().from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.userId, authUser.id))
    .orderBy(desc(creditTransactionsTable.createdAt))
    .limit(50);
  const paymentInfo = await getAdminPaymentInfo();
  res.json({ credits, transactions: txs, packages: CREDIT_PACKAGES, rates: { creditsPerAzn: CREDITS_PER_AZN, aznForPro: AZN_FOR_PRO, aznForEnterprise: AZN_FOR_ENTERPRISE, aznPriceUSD: AZN_PRICE_USD, usdToBDT: USD_TO_BDT, aznPriceBDT: +(AZN_PRICE_USD * USD_TO_BDT).toFixed(4) }, paymentInfo });
});

// ─── POST /api/credits/purchase — submit payment proof ────────────────────────
router.post("/credits/purchase", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { packageId, method, referenceId, senderNumber } = req.body as {
    packageId?: string; method?: string; referenceId?: string; senderNumber?: string;
  };

  const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
  if (!pkg) { res.status(400).json({ error: "Invalid package" }); return; }
  if (!method || !["bkash", "nagad", "binance_usdt"].includes(method)) {
    res.status(400).json({ error: "Invalid payment method" }); return;
  }
  if (!referenceId?.trim()) { res.status(400).json({ error: "Transaction ID / TX hash required" }); return; }

  // Check for duplicate reference
  const dup = await db.select({ id: creditTransactionsTable.id })
    .from(creditTransactionsTable)
    .where(and(
      eq(creditTransactionsTable.referenceId, referenceId.trim()),
      eq(creditTransactionsTable.method, method),
    ));
  if (dup.length > 0) { res.status(409).json({ error: "This transaction ID has already been submitted" }); return; }

  const [tx] = await db.insert(creditTransactionsTable).values({
    userId: authUser.id,
    type: "purchase",
    method,
    credits: pkg.credits,
    amountBDT: method !== "binance_usdt" ? pkg.priceBDT : null,
    amountUSDT: method === "binance_usdt" ? pkg.priceUSDT : null,
    referenceId: referenceId.trim(),
    notes: senderNumber ? `Sender: ${senderNumber}` : `${pkg.label} package`,
    status: "pending",
  }).returning();

  broadcastEvent("credit_purchase_submitted", { userId: authUser.id, txId: tx.id, method, credits: pkg.credits });
  res.status(201).json({ success: true, transaction: tx, message: "Payment submitted. Credits will be added after verification (usually within 1-2 hours)." });
});

// ─── POST /api/credits/swap — credits → AZN tokens ────────────────────────────
router.post("/credits/swap", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { credits: creditsToSwap } = req.body as { credits?: number };
  if (!creditsToSwap || creditsToSwap < CREDITS_PER_AZN) {
    res.status(400).json({ error: `Minimum swap is ${CREDITS_PER_AZN} credits (1 AZN)` }); return;
  }
  if (creditsToSwap % CREDITS_PER_AZN !== 0) {
    res.status(400).json({ error: `Credits must be a multiple of ${CREDITS_PER_AZN}` }); return;
  }

  const creditRow = await getOrCreateCredits(authUser.id);
  if (creditRow.balance < creditsToSwap) {
    res.status(400).json({ error: `Insufficient credits. You have ${creditRow.balance} credits.` }); return;
  }

  const aznAmount = creditsToSwap / CREDITS_PER_AZN;

  await db.update(creditsTable).set({
    balance: creditRow.balance - creditsToSwap,
    aznBalance: creditRow.aznBalance + aznAmount,
    totalSpent: creditRow.totalSpent + creditsToSwap,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, authUser.id));

  const [tx] = await db.insert(creditTransactionsTable).values({
    userId: authUser.id,
    type: "swap_to_azn",
    method: "system",
    credits: -creditsToSwap,
    aznAmount,
    status: "approved",
    notes: `Swapped ${creditsToSwap} credits → ${aznAmount} AZN`,
    approvedAt: new Date(),
  }).returning();

  broadcastEvent("credits_updated", { userId: authUser.id });
  res.json({ success: true, aznReceived: aznAmount, newCreditBalance: creditRow.balance - creditsToSwap, newAznBalance: creditRow.aznBalance + aznAmount, transaction: tx });
});

// ─── POST /api/credits/buy-subscription — AZN → subscription ──────────────────
router.post("/credits/buy-subscription", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { plan, username } = req.body as { plan?: string; username?: string };
  if (!plan || !["pro", "enterprise"].includes(plan)) {
    res.status(400).json({ error: "Invalid plan. Choose pro or enterprise" }); return;
  }

  const aznCost = plan === "enterprise" ? AZN_FOR_ENTERPRISE : AZN_FOR_PRO;
  const creditRow = await getOrCreateCredits(authUser.id);

  if (creditRow.aznBalance < aznCost) {
    res.status(400).json({ error: `Insufficient AZN. Need ${aznCost} AZN, you have ${creditRow.aznBalance.toFixed(2)} AZN.` }); return;
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Upsert subscription
  const existing = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, authUser.id));
  if (existing.length > 0) {
    await db.update(subscriptionsTable).set({ plan, status: "active", expiresAt, updatedAt: new Date() }).where(eq(subscriptionsTable.userId, authUser.id));
  } else {
    await db.insert(subscriptionsTable).values({ userId: authUser.id, plan, status: "active", expiresAt });
  }

  // Deduct AZN
  await db.update(creditsTable).set({
    aznBalance: creditRow.aznBalance - aznCost,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, authUser.id));

  await db.insert(creditTransactionsTable).values({
    userId: authUser.id,
    type: "azn_subscription",
    method: "system",
    credits: 0,
    aznAmount: -aznCost,
    status: "approved",
    notes: `Purchased ${plan} subscription for ${aznCost} AZN`,
    approvedAt: new Date(),
  });

  broadcastEvent("subscription_updated", { userId: authUser.id, plan });

  // Auto-mint the subscription-pass NFT — AZN was already charged above, so skip re-deducting.
  let nft = null;
  try {
    const minted = await mintNftForUser({ userId: authUser.id, plan, username, deductAzn: false });
    nft = minted.nft;
  } catch (err) {
    // Subscription purchase itself succeeded — NFT mint failure shouldn't block the response,
    // but it is surfaced so the frontend/user knows the collectible wasn't issued.
    res.json({ success: true, plan, expiresAt, aznSpent: aznCost, newAznBalance: creditRow.aznBalance - aznCost, nft: null, nftError: (err as Error).message });
    return;
  }

  res.json({ success: true, plan, expiresAt, aznSpent: aznCost, newAznBalance: creditRow.aznBalance - aznCost, nft });
});

// ─── ADMIN: GET /api/admin/credits — pending purchases ────────────────────────
router.get("/admin/credits", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser || authUser.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const pending = await db.select().from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.status, "pending"))
    .orderBy(desc(creditTransactionsTable.createdAt));
  res.json(pending);
});

// ─── ADMIN: POST /api/admin/credits/:id/approve ────────────────────────────────
router.post("/admin/credits/:id/approve", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser || authUser.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [tx] = await db.select().from(creditTransactionsTable).where(eq(creditTransactionsTable.id, id));
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  if (tx.status !== "pending") { res.status(400).json({ error: "Transaction already processed" }); return; }

  await db.update(creditTransactionsTable).set({ status: "approved", approvedAt: new Date(), adminNote: req.body.note ?? null, updatedAt: new Date() }).where(eq(creditTransactionsTable.id, id));

  const creditRow = await getOrCreateCredits(tx.userId);
  await db.update(creditsTable).set({
    balance: creditRow.balance + (tx.credits ?? 0),
    totalPurchased: creditRow.totalPurchased + (tx.credits ?? 0),
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, tx.userId));

  broadcastEvent("credits_updated", { userId: tx.userId, credits: tx.credits });
  res.json({ success: true });
});

// ─── ADMIN: POST /api/admin/credits/:id/reject ─────────────────────────────────
router.post("/admin/credits/:id/reject", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser || authUser.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.update(creditTransactionsTable).set({ status: "rejected", adminNote: req.body.note ?? "Rejected by admin", updatedAt: new Date() }).where(eq(creditTransactionsTable.id, id));
  res.json({ success: true });
});

// ─── POST /api/credits/transfer — user-to-user AZN transfer ──────────────────
router.post("/credits/transfer", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { toUsername, amount } = req.body as { toUsername?: string; amount?: number };
  if (!toUsername?.trim()) { res.status(400).json({ error: "toUsername is required" }); return; }
  if (!amount || amount <= 0) { res.status(400).json({ error: "amount must be greater than 0" }); return; }
  if (amount < 0.01) { res.status(400).json({ error: "Minimum transfer is 0.01 AZN" }); return; }

  // Find recipient
  const { usersTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const [recipient] = await db.select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable).where(eq(usersTable.username, toUsername.trim()));
  if (!recipient) { res.status(404).json({ error: "User not found" }); return; }
  if (recipient.id === authUser.id) { res.status(400).json({ error: "Cannot transfer to yourself" }); return; }

  const senderCredits = await getOrCreateCredits(authUser.id);
  if (senderCredits.aznBalance < amount) {
    res.status(400).json({ error: `Insufficient AZN. You have ${senderCredits.aznBalance.toFixed(4)} AZN.` }); return;
  }

  // Deduct from sender
  await db.update(creditsTable).set({
    aznBalance: senderCredits.aznBalance - amount,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, authUser.id));

  // Credit recipient
  const recipientCredits = await getOrCreateCredits(recipient.id);
  await db.update(creditsTable).set({
    aznBalance: recipientCredits.aznBalance + amount,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, recipient.id));

  // Log transactions for both
  await db.insert(creditTransactionsTable).values({
    userId: authUser.id, type: "azn_transfer_out", method: "transfer",
    credits: 0, aznAmount: -amount, status: "approved",
    notes: `Sent ${amount} AZN to @${recipient.username}`,
    referenceId: String(recipient.id), approvedAt: new Date(),
  });
  await db.insert(creditTransactionsTable).values({
    userId: recipient.id, type: "azn_transfer_in", method: "transfer",
    credits: 0, aznAmount: amount, status: "approved",
    notes: `Received ${amount} AZN from @${senderCredits.userId}`,
    referenceId: String(authUser.id), approvedAt: new Date(),
  });

  // Notify recipient
  try {
    const { createNotification } = await import("./notifications");
    const [sender] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, authUser.id));
    await createNotification(recipient.id, "azn_transfer", `+${amount} AZN Received 💸`,
      `@${sender?.username ?? "someone"} sent you ${amount} AZN tokens.`,
      { from: authUser.id, amount });
  } catch {}

  broadcastEvent("credits_updated", { userId: authUser.id });
  broadcastEvent("credits_updated", { userId: recipient.id });

  res.json({
    success: true,
    sent: amount,
    to: recipient.username,
    newBalance: +(senderCredits.aznBalance - amount).toFixed(6),
    message: `Successfully sent ${amount} AZN to @${recipient.username}`,
  });
});

// ─── POST /api/credits/sell-azn — request to sell AZN tokens ─────────────────
router.post("/credits/sell-azn", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { aznAmount, method, accountNumber } = req.body as { aznAmount?: number; method?: string; accountNumber?: string };
  if (!aznAmount || aznAmount < 1) {
    res.status(400).json({ error: "Minimum sell is 1 AZN" }); return;
  }
  if (!method || !["bkash", "nagad", "binance_usdt"].includes(method)) {
    res.status(400).json({ error: "Invalid withdrawal method" }); return;
  }
  if (!accountNumber?.trim()) {
    res.status(400).json({ error: "Account number / wallet address required" }); return;
  }

  const creditRow = await getOrCreateCredits(authUser.id);
  if (creditRow.aznBalance < aznAmount) {
    res.status(400).json({ error: `Insufficient AZN. You have ${creditRow.aznBalance.toFixed(4)} AZN.` }); return;
  }

  const usdValue = +(aznAmount * AZN_PRICE_USD).toFixed(4);
  const bdtValue = +(usdValue * USD_TO_BDT).toFixed(2);

  // Deduct AZN immediately and create pending withdrawal
  await db.update(creditsTable).set({
    aznBalance: creditRow.aznBalance - aznAmount,
    updatedAt: new Date(),
  }).where(eq(creditsTable.userId, authUser.id));

  const [tx] = await db.insert(creditTransactionsTable).values({
    userId: authUser.id,
    type: "azn_sell",
    method,
    credits: 0,
    aznAmount: -aznAmount,
    amountUSDT: method === "binance_usdt" ? usdValue : null,
    amountBDT: method !== "binance_usdt" ? bdtValue : null,
    status: "pending",
    notes: `Sell ${aznAmount} AZN → ${method === "binance_usdt" ? `$${usdValue} USDT` : `৳${bdtValue}`} to: ${accountNumber.trim()}`,
    referenceId: accountNumber.trim(),
  }).returning();

  broadcastEvent("credit_sell_requested", { userId: authUser.id, txId: tx.id, aznAmount });
  res.status(201).json({
    success: true,
    transaction: tx,
    usdValue,
    bdtValue,
    message: `Sell request submitted. Admin will send ${method !== "binance_usdt" ? `৳${bdtValue}` : `$${usdValue} USDT`} to your account within 24 hours.`,
  });
});

export default router;
