import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// ─── 1. POST /marketplace/orders/:id/review — buyer reviews a completed order ─
router.post("/marketplace/orders/:id/review", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const orderId = Number(req.params.id);
  const { rating, comment } = req.body;
  const r5 = Number(rating);
  if (!r5 || r5 < 1 || r5 > 5) { res.status(400).json({ error: "rating must be 1-5" }); return; }
  try {
    const orderR = await pool.query(
      "SELECT * FROM marketplace_orders WHERE id=$1 AND buyer_id=$2 AND status='completed'",
      [orderId, userId]
    );
    if (orderR.rows.length === 0) { res.status(404).json({ error: "Completed order not found or not yours" }); return; }
    const order = orderR.rows[0];
    const r = await pool.query(
      `INSERT INTO marketplace_reviews (order_id, listing_id, buyer_id, seller_id, rating, comment, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       ON CONFLICT (order_id) DO UPDATE SET rating=$5, comment=$6, updated_at=NOW()
       RETURNING *`,
      [orderId, order.listing_id, userId, order.seller_id, r5, comment || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── 2. GET /marketplace/sellers/:id/reviews — public reviews for a seller ────
router.get("/marketplace/sellers/:id/reviews", async (req, res): Promise<void> => {
  const sellerId = Number(req.params.id);
  const { limit = 50, offset = 0 } = req.query as any;
  try {
    const r = await pool.query(
      `SELECT mr.*, ml.title as listing_title, u.username as buyer_username
       FROM marketplace_reviews mr
       JOIN marketplace_listings ml ON ml.id = mr.listing_id
       LEFT JOIN users u ON u.id = mr.buyer_id
       WHERE mr.seller_id = $1
       ORDER BY mr.created_at DESC LIMIT $2 OFFSET $3`,
      [sellerId, Number(limit), Number(offset)]
    );
    res.json(r.rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── 3. GET /marketplace/sellers/:id/rating — average rating summary ─────────
router.get("/marketplace/sellers/:id/rating", async (req, res): Promise<void> => {
  const sellerId = Number(req.params.id);
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int as review_count, COALESCE(AVG(rating),0)::float as avg_rating,
              COUNT(*) FILTER (WHERE rating=5)::int as five_star,
              COUNT(*) FILTER (WHERE rating=4)::int as four_star,
              COUNT(*) FILTER (WHERE rating=3)::int as three_star,
              COUNT(*) FILTER (WHERE rating=2)::int as two_star,
              COUNT(*) FILTER (WHERE rating=1)::int as one_star
       FROM marketplace_reviews WHERE seller_id=$1`,
      [sellerId]
    );
    res.json(r.rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── 4. PATCH /marketplace/reviews/:id — buyer edits own review ──────────────
router.patch("/marketplace/reviews/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);
  const { rating, comment } = req.body;
  try {
    const r = await pool.query(
      `UPDATE marketplace_reviews SET
        rating = COALESCE($1, rating), comment = COALESCE($2, comment), updated_at=NOW()
       WHERE id=$3 AND buyer_id=$4 RETURNING *`,
      [rating ? Number(rating) : null, comment ?? null, id, userId]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: "Review not found or not yours" }); return; }
    res.json(r.rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── 5. DELETE /marketplace/reviews/:id — buyer deletes own review ───────────
router.delete("/marketplace/reviews/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);
  try {
    const r = await pool.query("DELETE FROM marketplace_reviews WHERE id=$1 AND buyer_id=$2 RETURNING id", [id, userId]);
    if (r.rows.length === 0) { res.status(404).json({ error: "Review not found or not yours" }); return; }
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── 6. POST /marketplace/reviews/:id/response — seller responds to a review ─
router.post("/marketplace/reviews/:id/response", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);
  const { response } = req.body;
  if (!response) { res.status(400).json({ error: "response is required" }); return; }
  try {
    const r = await pool.query(
      `UPDATE marketplace_reviews SET seller_response=$1, seller_response_at=NOW(), updated_at=NOW()
       WHERE id=$2 AND seller_id=$3 RETURNING *`,
      [response, id, userId]
    );
    if (r.rows.length === 0) { res.status(404).json({ error: "Review not found or not yours to respond to" }); return; }
    res.json(r.rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── 7. GET /marketplace/reviews/my — buyer's own submitted reviews ──────────
router.get("/marketplace/reviews/my", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const r = await pool.query(
      `SELECT mr.*, ml.title as listing_title
       FROM marketplace_reviews mr JOIN marketplace_listings ml ON ml.id = mr.listing_id
       WHERE mr.buyer_id = $1 ORDER BY mr.created_at DESC`,
      [userId]
    );
    res.json(r.rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
