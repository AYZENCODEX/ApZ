import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { broadcastToUser } from "./events";

const router = Router();

function getAuthUser(req: any): { id: number; role: string } | null {
  const auth = req.headers.authorization as string | undefined;
  if (!auth) return null;
  try {
    const p = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return { id: p.userId, role: p.role ?? "user" };
  } catch { return null; }
}

// GET /api/notifications/unread-count — before /:id
router.get("/notifications/unread-count", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.json({ count: 0 }); return; }
  try {
    const result = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, authUser.id), eq(notificationsTable.isRead, false)));
    res.json({ count: Number(result[0]?.count ?? 0) });
  } catch { res.json({ count: 0 }); }
});

// GET /api/notifications
router.get("/notifications", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, authUser.id))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch { res.json([]); }
});

// PATCH /api/notifications/read-all — before /:id
router.patch("/notifications/read-all", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, authUser.id));
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read
router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, authUser.id)));
  res.json({ success: true });
});

// DELETE /api/notifications/:id
router.delete("/notifications/:id", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, authUser.id)));
  res.json({ success: true });
});

// Admin: POST /api/notifications
router.post("/notifications", async (req, res): Promise<void> => {
  const authUser = getAuthUser(req);
  if (!authUser || authUser.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const { userId, type, title, message, data } = req.body;
  if (!userId || !title) { res.status(400).json({ error: "userId and title required" }); return; }
  const [notif] = await db.insert(notificationsTable).values({
    userId: Number(userId), type: type ?? "system", title, message: message ?? "",
    isRead: false, data: data ? JSON.stringify(data) : undefined,
  }).returning();
  broadcastToUser(Number(userId), "notification", { id: notif.id, type, title, message });
  res.status(201).json(notif);
});

export async function createNotification(
  userId: number, type: string, title: string, message: string, data?: Record<string, unknown>
) {
  try {
    const [notif] = await db.insert(notificationsTable).values({
      userId, type, title, message, isRead: false,
      data: data ? JSON.stringify(data) : undefined,
    }).returning();
    broadcastToUser(userId, "notification", { id: notif.id, type, title, message });
  } catch {}
}

export default router;
