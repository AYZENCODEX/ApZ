import { Router } from "express";
import { db, supportTicketsTable, supportMessagesTable, usersTable } from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";

const router = Router();

function getAuth(req: any): { userId: number; role: string } {
  const auth = req.headers.authorization as string | undefined;
  if (!auth) return { userId: 1, role: "user" };
  try {
    const p = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return { userId: p.userId ?? 1, role: p.role ?? "user" };
  } catch { return { userId: 1, role: "user" }; }
}

function fmtTicket(t: typeof supportTicketsTable.$inferSelect) {
  return { ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}
function fmtMsg(m: typeof supportMessagesTable.$inferSelect) {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

// ── User: list own tickets ─────────────────────────────────────────────────
router.get("/support/tickets", async (req, res): Promise<void> => {
  const { userId, role } = getAuth(req);
  const tickets = role === "admin"
    ? await db.select().from(supportTicketsTable).orderBy(desc(supportTicketsTable.updatedAt))
    : await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.userId, userId)).orderBy(desc(supportTicketsTable.updatedAt));

  // Attach username for admin view
  const enriched = await Promise.all(tickets.map(async (t) => {
    const [u] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, t.userId));
    const [{ cnt }] = await db.select({ cnt: count() }).from(supportMessagesTable).where(eq(supportMessagesTable.ticketId, t.id));
    return { ...fmtTicket(t), username: u?.username ?? "Unknown", messageCount: Number(cnt) };
  }));
  res.json(enriched);
});

// ── User: create ticket ────────────────────────────────────────────────────
router.post("/support/tickets", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const { title, category, priority, message } = req.body;
  if (!title || !message) { res.status(400).json({ error: "title and message required" }); return; }

  const [ticket] = await db.insert(supportTicketsTable).values({
    userId, title, category: category ?? "general", status: "open", priority: priority ?? "medium",
  }).returning();

  await db.insert(supportMessagesTable).values({
    ticketId: ticket.id, authorId: userId, authorRole: "user", content: message,
  });

  res.status(201).json(fmtTicket(ticket));
});

// ── Get ticket + messages ─────────────────────────────────────────────────
router.get("/support/tickets/:id", async (req, res): Promise<void> => {
  const { userId, role } = getAuth(req);
  const id = parseInt(req.params.id as string, 10);

  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!ticket) { res.status(404).json({ error: "Not found" }); return; }
  if (role !== "admin" && ticket.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const messages = await db.select().from(supportMessagesTable)
    .where(eq(supportMessagesTable.ticketId, id)).orderBy(supportMessagesTable.createdAt);

  const messagesWithAuthors = await Promise.all(messages.map(async (m) => {
    const [u] = await db.select({ username: usersTable.username, avatarUrl: usersTable.avatarUrl })
      .from(usersTable).where(eq(usersTable.id, m.authorId));
    return { ...fmtMsg(m), username: u?.username ?? "System", avatarUrl: u?.avatarUrl ?? null };
  }));

  const [u] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, ticket.userId));
  res.json({ ...fmtTicket(ticket), username: u?.username ?? "Unknown", messages: messagesWithAuthors });
});

// ── Reply to ticket ────────────────────────────────────────────────────────
router.post("/support/tickets/:id/messages", async (req, res): Promise<void> => {
  const { userId, role } = getAuth(req);
  const ticketId = parseInt(req.params.id as string, 10);
  const { content } = req.body;
  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, ticketId));
  if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }
  if (role !== "admin" && ticket.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const [msg] = await db.insert(supportMessagesTable).values({
    ticketId, authorId: userId, authorRole: role, content: content.trim(),
  }).returning();

  // Update ticket status
  const newStatus = role === "admin" ? "in_progress" : ticket.status;
  await db.update(supportTicketsTable).set({ status: newStatus, updatedAt: new Date() }).where(eq(supportTicketsTable.id, ticketId));

  const [u] = await db.select({ username: usersTable.username, avatarUrl: usersTable.avatarUrl }).from(usersTable).where(eq(usersTable.id, userId));
  res.status(201).json({ ...fmtMsg(msg), username: u?.username ?? "System", avatarUrl: u?.avatarUrl ?? null });
});

// ── Admin: update ticket status ───────────────────────────────────────────
router.patch("/support/tickets/:id", async (req, res): Promise<void> => {
  const { role } = getAuth(req);
  if (role !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = parseInt(req.params.id as string, 10);
  const { status, priority } = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  const [t] = await db.update(supportTicketsTable).set(updates).where(eq(supportTicketsTable.id, id)).returning();
  res.json(fmtTicket(t));
});

// ── Admin: stats ──────────────────────────────────────────────────────────
router.get("/support/stats", async (_req, res): Promise<void> => {
  const [{ total }] = await db.select({ total: count() }).from(supportTicketsTable);
  const open = await db.select({ cnt: count() }).from(supportTicketsTable).where(eq(supportTicketsTable.status, "open"));
  const inprog = await db.select({ cnt: count() }).from(supportTicketsTable).where(eq(supportTicketsTable.status, "in_progress"));
  const resolved = await db.select({ cnt: count() }).from(supportTicketsTable).where(eq(supportTicketsTable.status, "resolved"));
  res.json({ total: Number(total), open: Number(open[0].cnt), inProgress: Number(inprog[0].cnt), resolved: Number(resolved[0].cnt) });
});

export default router;
