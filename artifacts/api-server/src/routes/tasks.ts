import { Router } from "express";
import { db, tasksTable, taskSubmissionsTable, projectsTable, usersTable, creditsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { broadcastEvent, broadcastToUser } from "./events";
import { notifyTaskVerified } from "../lib/telegram";
import { createNotification } from "./notifications";
import { logActivity } from "../lib/activity";
import { logSubjectActivity } from "../lib/activity-log";
import { requireAdmin, requireAuth, requireRoles } from "../middlewares/auth";
import { syncOnTaskDelete } from "../services/sync";

const router = Router();

/** Extract userId — returns null if unauthenticated (B1 fix: no silent fallback to 1). */
function getUserId(req: { headers: { authorization?: string } }): number | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try {
    const p = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return p.userId ? Number(p.userId) : null;
  } catch { return null; }
}

function getAuthInfo(req: { headers: { authorization?: string } }): { id: number | null; role: string } {
  const auth = req.headers.authorization;
  if (!auth) return { id: null, role: "user" };
  try {
    const p = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return { id: p.userId ? Number(p.userId) : null, role: p.role ?? "user" };
  } catch { return { id: null, role: "user" }; }
}

function taskIdStr(id: number): string { return `#TSK-${String(id).padStart(4, "0")}`; }

function formatTask(t: any, projectName?: string | null, userStatus?: string | null) {
  let steps: any[] = [];
  try { steps = JSON.parse(t.steps || t.steps_json || "[]"); } catch { steps = []; }
  return {
    ...t,
    taskId: taskIdStr(t.id),
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    deadline: t.deadline instanceof Date ? t.deadline.toISOString() : (t.deadline ?? null),
    projectName: projectName ?? null,
    userStatus: userStatus ?? null,
    cost: t.cost ?? 0,
    profit: t.profit ?? 0,
    category: t.category ?? "Social",
    taskCategory: t.taskCategory ?? t.task_category ?? t.category ?? "B1",
    timeLimitMinutes: t.timeLimitMinutes ?? t.time_limit_minutes ?? null,
    xpAmount: t.xpAmount ?? t.xp_amount ?? 0,
    taskLink: t.taskLink ?? t.task_link ?? null,
    steps,
    priority: t.priority ?? "normal",
    difficultyLevel: t.difficultyLevel ?? t.difficulty_level ?? "medium",
    estimatedCost: t.estimatedCost ?? t.estimated_cost ?? 0,
    estimatedProfit: t.estimatedProfit ?? t.estimated_profit ?? 0,
  };
}

// ── GET /tasks — list all tasks ─────────────────────────────────────────────
router.get("/tasks", async (req, res): Promise<void> => {
  const { projectId, userId } = req.query as Record<string, string>;
  try {
    const whereClause = projectId ? `WHERE t.project_id = ${parseInt(projectId, 10)}` : "";
    const rawTasks = await db.execute(sql.raw(
      `SELECT t.*, p.name as project_name, p.xp_name as project_xp_name, p.xp_price as project_xp_price
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       ${whereClause}
       ORDER BY t.created_at DESC`
    ));
    const tasks = rawTasks.rows as any[];
    const enriched = await Promise.all(tasks.map(async (t) => {
      let userStatus: string | null = null;
      if (userId) {
        const [sub] = await db.select().from(taskSubmissionsTable)
          .where(and(eq(taskSubmissionsTable.taskId, t.id), eq(taskSubmissionsTable.userId, parseInt(userId, 10))));
        userStatus = sub?.status ?? null;
        if (userStatus && (t.task_type === "Daily" || t.task_type === "daily")) {
          const lastSub = await db.execute(sql.raw(
            `SELECT submitted_at FROM task_submissions WHERE task_id = ${t.id} AND user_id = ${parseInt(userId!, 10)} ORDER BY submitted_at DESC LIMIT 1`
          ));
          const submittedAt = (lastSub.rows[0] as any)?.submitted_at;
          if (submittedAt) {
            const today = new Date(); today.setHours(0,0,0,0);
            const subDate = new Date(submittedAt); subDate.setHours(0,0,0,0);
            if (subDate < today) userStatus = null;
          }
        }
      }
      return formatTask({
        ...t, projectId: t.project_id, completionCount: t.completion_count,
        rewardAmount: t.reward_amount, verificationType: t.verification_type,
        taskType: t.task_type, createdAt: t.created_at, category: t.category,
        xpAmount: t.xp_amount ?? 0, steps: t.steps,
      }, t.project_name, userStatus);
    }));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ── POST /tasks — create task ───────────────────────────────────────────────
router.post("/tasks", requireRoles("admin", "moderator"), async (req, res): Promise<void> => {
  const { projectId, name, description, rewardAmount, verificationType, taskType, cost, profit, category, taskCategory, deadline, timeLimitMinutes, xpAmount, steps, priority, difficultyLevel, estimatedCost, estimatedProfit } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const projIdSql = projectId ? `${Number(projectId)}` : "NULL";
  const stepsJson = steps && Array.isArray(steps) ? JSON.stringify(steps) : "[]";
  try {
    const { taskLink } = req.body;
    const taskLinkSql = taskLink ? `'${String(taskLink).replace(/'/g, "''")}'` : "NULL";
    const result = await db.execute(sql.raw(
      `INSERT INTO tasks (project_id, name, description, reward_amount, xp_amount, verification_type, task_type, cost, profit, category, task_category, deadline, time_limit_minutes, steps, task_link, priority, difficulty_level, estimated_cost, estimated_profit)
       VALUES (${projIdSql}, '${name.replace(/'/g, "''")}',
         ${description ? `'${description.replace(/'/g, "''")}'` : "NULL"},
         ${rewardAmount != null ? Number(rewardAmount) : "NULL"},
         ${Number(xpAmount ?? 0)},
         '${(verificationType ?? "manual").replace(/'/g, "''")}',
         '${(taskType ?? "One-time").replace(/'/g, "''")}',
         ${Number(cost ?? 0)}, ${Number(profit ?? 0)},
         '${(category ?? "Social").replace(/'/g, "''")}',
         '${(taskCategory ?? "B1").replace(/'/g, "''")}',
         ${deadline ? `'${deadline}'` : "NULL"},
         ${timeLimitMinutes ? Number(timeLimitMinutes) : "NULL"},
         '${stepsJson.replace(/'/g, "''")}',
         ${taskLinkSql},
         '${(priority ?? "normal").replace(/'/g, "''")}',
         '${(difficultyLevel ?? "medium").replace(/'/g, "''")}',
         ${Number(estimatedCost ?? 0)},
         ${Number(estimatedProfit ?? 0)})
       RETURNING *`
    ));
    const task = result.rows[0] as any;
    broadcastEvent("tasks_updated", { action: "created", taskId: task.id });
    res.status(201).json(formatTask({
      ...task, projectId: task.project_id, completionCount: task.completion_count,
      rewardAmount: task.reward_amount, verificationType: task.verification_type,
      taskType: task.task_type, createdAt: task.created_at, category: task.category,
      taskCategory: task.task_category ?? task.category, xpAmount: task.xp_amount ?? 0,
      steps: task.steps,
    }));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ── GET /tasks/submissions — MUST be before GET /tasks/:id ─────────────────
router.get("/tasks/submissions", async (req, res): Promise<void> => {
  const { status, projectId } = req.query as Record<string, string>;
  const subs = await db.select({
    sub: taskSubmissionsTable, task: tasksTable, user: usersTable
  }).from(taskSubmissionsTable)
    .leftJoin(tasksTable, eq(taskSubmissionsTable.taskId, tasksTable.id))
    .leftJoin(usersTable, eq(taskSubmissionsTable.userId, usersTable.id));

  const filtered = subs.filter(s => {
    if (status && s.sub.status !== status) return false;
    if (projectId && s.task?.projectId !== parseInt(projectId, 10)) return false;
    return true;
  });

  res.json(filtered.map(s => {
    let costEntries: any[] = [];
    try { costEntries = JSON.parse((s.sub as any).costEntries ?? (s.sub as any).cost_entries ?? "[]"); } catch {}
    return {
      id: s.sub.id, taskId: s.sub.taskId, taskName: s.task?.name ?? null,
      userId: s.sub.userId, username: s.user?.username ?? null,
      status: s.sub.status, proofUrl: s.sub.proofUrl, notes: s.sub.notes,
      cost: s.sub.cost ?? 0, profit: s.sub.profit ?? 0,
      costEntries,
      submittedAt: s.sub.submittedAt.toISOString(), reviewedAt: s.sub.reviewedAt?.toISOString() ?? null,
    };
  }));
});

// ── POST /tasks/:id/visit — record link visit ────────────────────────────────
router.post("/tasks/:id/visit", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.user!.userId;
  try {
    await db.execute(sql.raw(
      `INSERT INTO task_link_visits (task_id, user_id) VALUES (${taskId}, ${userId})
       ON CONFLICT (task_id, user_id) DO UPDATE SET visited_at = NOW()`
    ));
    res.json({ ok: true, visitedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ── GET /tasks/:id/visit — check if user visited ─────────────────────────────
router.get("/tasks/:id/visit", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.user!.userId;
  try {
    const result = await db.execute(sql.raw(
      `SELECT visited_at FROM task_link_visits WHERE task_id = ${taskId} AND user_id = ${userId} LIMIT 1`
    ));
    const row = result.rows[0] as any;
    res.json({ visited: !!row, visitedAt: row?.visited_at ?? null });
  } catch {
    res.json({ visited: false, visitedAt: null });
  }
});

// ── GET /tasks/:id ──────────────────────────────────────────────────────────
router.get("/tasks/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  let projName: string | null = null;
  if (task.projectId) {
    const [proj] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, task.projectId));
    projName = proj?.name ?? null;
  }
  res.json(formatTask(task, projName));
});

// ── PATCH /tasks/:id ────────────────────────────────────────────────────────
router.patch("/tasks/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const allowedFields = ["name", "description", "rewardAmount", "verificationType", "taskType", "cost", "profit", "category", "xpAmount"];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const rawSets: string[] = [];
  if (req.body.taskCategory !== undefined) rawSets.push(`task_category = '${String(req.body.taskCategory).replace(/'/g, "''")}'`);
  if (req.body.deadline !== undefined) rawSets.push(`deadline = ${req.body.deadline ? `'${req.body.deadline}'` : "NULL"}`);
  if (req.body.timeLimitMinutes !== undefined) rawSets.push(`time_limit_minutes = ${req.body.timeLimitMinutes ? Number(req.body.timeLimitMinutes) : "NULL"}`);
  if (req.body.projectId !== undefined) rawSets.push(`project_id = ${req.body.projectId ? Number(req.body.projectId) : "NULL"}`);
  if (req.body.steps !== undefined) rawSets.push(`steps = '${JSON.stringify(req.body.steps).replace(/'/g, "''")}'`);
  if (req.body.taskLink !== undefined) rawSets.push(`task_link = ${req.body.taskLink ? `'${String(req.body.taskLink).replace(/'/g, "''")}'` : "NULL"}`);
  if (req.body.priority !== undefined) rawSets.push(`priority = '${String(req.body.priority).replace(/'/g, "''")}'`);
  if (req.body.difficultyLevel !== undefined) rawSets.push(`difficulty_level = '${String(req.body.difficultyLevel).replace(/'/g, "''")}'`);
  if (req.body.estimatedCost !== undefined) rawSets.push(`estimated_cost = ${Number(req.body.estimatedCost) || 0}`);
  if (req.body.estimatedProfit !== undefined) rawSets.push(`estimated_profit = ${Number(req.body.estimatedProfit) || 0}`);

  try {
    let task: any;
    if (Object.keys(updates).length > 0) {
      const [t] = await db.update(tasksTable).set(updates).where(eq(tasksTable.id, id)).returning();
      task = t;
    }
    if (rawSets.length > 0) {
      const result = await db.execute(sql.raw(`UPDATE tasks SET ${rawSets.join(", ")} WHERE id = ${id} RETURNING *`));
      task = result.rows[0] ?? task;
    }
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    broadcastEvent("tasks_updated", { action: "updated", taskId: id });
    const t = task as any;
    res.json(formatTask({
      ...t, projectId: t.project_id ?? t.projectId, completionCount: t.completion_count ?? t.completionCount,
      rewardAmount: t.reward_amount ?? t.rewardAmount, verificationType: t.verification_type ?? t.verificationType,
      taskType: t.task_type ?? t.taskType, createdAt: t.created_at ?? t.createdAt,
      category: t.category, taskCategory: t.task_category ?? t.taskCategory ?? t.category,
      xpAmount: t.xp_amount ?? t.xpAmount ?? 0, steps: t.steps,
    }));
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ── DELETE /tasks/:id ───────────────────────────────────────────────────────
router.delete("/tasks/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  broadcastEvent("tasks_updated", { action: "deleted", taskId: id });
  syncOnTaskDelete(id).catch(() => {});
  res.json({ message: "Task deleted" });
});

// ── GET /tasks/:id/steps — get task step guide ──────────────────────────────
router.get("/tasks/:id/steps", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  try {
    const result = await db.execute(sql.raw(`SELECT steps FROM tasks WHERE id = ${id}`));
    const row = result.rows[0] as any;
    let steps: any[] = [];
    try { steps = JSON.parse(row?.steps ?? "[]"); } catch {}
    res.json(steps);
  } catch { res.json([]); }
});

// ── PUT /tasks/:id/steps — save all steps ──────────────────────────────────
router.put("/tasks/:id/steps", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { steps } = req.body as { steps?: any[] };
  const stepsJson = JSON.stringify(Array.isArray(steps) ? steps : []);
  try {
    await db.execute(sql.raw(`UPDATE tasks SET steps = '${stepsJson.replace(/'/g, "''")}' WHERE id = ${id}`));
    broadcastEvent("tasks_updated", { action: "steps_updated", taskId: id });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ── POST /tasks/:id/submit — submit task ────────────────────────────────────
router.post("/tasks/:id/submit", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { proofUrl, notes, cost, profit, entityIds, costEntries } = req.body;
  const userId = req.user!.userId;

  try {
    const result = await db.execute(sql.raw(`SELECT * FROM tasks WHERE id = ${taskId}`));
    const task = result.rows[0] as any;
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }

    const status = task.verification_type === "auto" ? "approved" : "pending";

    const entityIdsJson = entityIds && Array.isArray(entityIds) && entityIds.length
      ? `'${JSON.stringify(entityIds).replace(/'/g, "''")}'` : "NULL";

    const costEntriesJson = costEntries && Array.isArray(costEntries) && costEntries.length
      ? `'${JSON.stringify(costEntries).replace(/'/g, "''")}'` : "NULL";

    const totalCost = costEntries && Array.isArray(costEntries)
      ? costEntries.filter((e: any) => e.type === "cost").reduce((s: number, e: any) => s + Number(e.amount || 0), 0)
      : Number(cost ?? 0);
    const totalProfit = costEntries && Array.isArray(costEntries)
      ? costEntries.filter((e: any) => e.type === "profit").reduce((s: number, e: any) => s + Number(e.amount || 0), 0)
      : Number(profit ?? 0);

    const subResult = await db.execute(sql.raw(
      `INSERT INTO task_submissions (task_id, user_id, status, proof_url, notes, cost, profit, entity_ids, cost_entries, project_id)
       VALUES (${taskId}, ${userId}, '${status}',
         ${proofUrl ? `'${proofUrl.replace(/'/g, "''")}'` : "NULL"},
         ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"},
         ${totalCost}, ${totalProfit}, ${entityIdsJson}, ${costEntriesJson}, ${task.project_id ?? "NULL"})
       RETURNING *`
    ));
    const sub = subResult.rows[0] as any;

    if (status === "approved") {
      await db.execute(sql.raw(`UPDATE tasks SET completion_count = completion_count + 1 WHERE id = ${taskId}`));
      await awardXpAsAzn(userId, task);
      await createNotification(userId, "task_approved", "Task Auto-Approved ✓",
        `"${task.name}" was auto-verified. XP awarded to your balance.`,
        { taskId, xpAmount: task.xp_amount ?? 0 });
      logActivity(userId, "task_auto_approved", "task", taskId, task.name, { xpAmount: task.xp_amount ?? 0 });
      logProjectReward(task.project_id, taskId, userId, totalProfit, Array.isArray(entityIds) ? entityIds : null);
    } else {
      await createNotification(userId, "task_submitted", "Task Submitted",
        `"${task.name}" submitted for review. Pending admin verification.`, { taskId });
      logActivity(userId, "task_submitted", "task", taskId, task.name, { entities: entityIds });
    }

    broadcastEvent("tasks_updated", { action: "submitted", taskId, userId, status });

    const [user] = await db.select({ email: usersTable.email, username: usersTable.username })
      .from(usersTable).where(eq(usersTable.id, userId));
    if (user && status === "pending") {
      const { sendTaskSubmittedEmail } = await import("../lib/email");
      sendTaskSubmittedEmail(user.email, user.username, task.name).catch(() => {});
    }

    res.json({
      id: sub.id, taskId: sub.task_id, taskName: task.name, userId: sub.user_id,
      status: sub.status, proofUrl: sub.proof_url, notes: sub.notes,
      cost: totalCost, profit: totalProfit, costEntries: costEntries ?? [],
      submittedAt: sub.submitted_at, reviewedAt: sub.reviewed_at ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: "DB error", detail: err?.message });
  }
});

// ── Helper: award XP as AZN on task approval ────────────────────────────────
async function awardXpAsAzn(userId: number, task: any) {
  const xpAmt = Number(task.xp_amount ?? task.xpAmount ?? 0);
  if (!xpAmt || xpAmt <= 0) return;
  try {
    let xpPrice = 0.01;
    if (task.project_id || task.projectId) {
      const projId = task.project_id ?? task.projectId;
      const proj = await db.execute(sql.raw(`SELECT xp_price FROM projects WHERE id = ${projId}`));
      xpPrice = Number((proj.rows[0] as any)?.xp_price ?? 0.01);
    }
    const aznEarned = +(xpAmt * xpPrice).toFixed(6);
    if (aznEarned <= 0) return;
    await db.execute(sql.raw(
      `INSERT INTO credits (user_id, balance, azn_balance, total_purchased, total_spent, created_at, updated_at)
       VALUES (${userId}, 0, ${aznEarned}, 0, 0, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET azn_balance = credits.azn_balance + ${aznEarned}, updated_at = NOW()`
    ));
  } catch {}
}

// ── Phase 4 (Vault/Project/Team Overhaul roadmap): log a "reward" activity
// event, per enrolled entity, on task approval. Attributed to each entity's
// own project_enrollments row so per-entity totals (computed from the log)
// never drift out of sync. ──────────────────────────────────────────────────
async function logProjectReward(
  projectId: number | null | undefined,
  taskId: number,
  userId: number,
  amount: number | null | undefined,
  entityIds: number[] | null | undefined,
) {
  if (!projectId || !amount || !entityIds || !entityIds.length) return;
  const ids = entityIds.map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) return;
  try {
    const rows = await db.execute(sql.raw(
      `SELECT id FROM project_enrollments WHERE project_id = ${projectId} AND user_id = ${userId} AND vault_entry_id IN (${ids.join(",")})`
    ));
    for (const r of rows.rows as any[]) {
      await logSubjectActivity("project_enrollment", Number(r.id), "reward", {
        actorUserId: userId, amount, meta: { projectId, taskId },
      });
    }
  } catch {
    // Best-effort — never block task approval on log-write issues.
  }
}

// ── POST /tasks/:id/verify — admin approve/reject ──────────────────────────
router.post("/tasks/:id/verify", requireAdmin, async (req, res): Promise<void> => {
  const { submissionId, approved, rejectionReason } = req.body;
  const status = approved ? "approved" : "rejected";
  await db.update(taskSubmissionsTable).set({ status, rejectionReason, reviewedAt: new Date() }).where(eq(taskSubmissionsTable.id, submissionId));

  const [sub] = await db.select().from(taskSubmissionsTable).where(eq(taskSubmissionsTable.id, submissionId));
  let taskName: string | null = null;
  let rewardAmount: number | null = null;

  if (sub) {
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, sub.taskId));
    if (task) {
      taskName = task.name;
      rewardAmount = task.rewardAmount ?? null;
      if (approved) {
        await db.update(tasksTable).set({ completionCount: task.completionCount + 1 }).where(eq(tasksTable.id, sub.taskId));
        await awardXpAsAzn(sub.userId, task);
      }
    }

    if (approved) {
      await createNotification(sub.userId, "task_approved", "Task Approved ✓",
        taskName ? `"${taskName}" approved by admin. XP credited to your balance.` : "Your task was approved.",
        { submissionId, taskId: sub.taskId, xpAmount: task?.xpAmount ?? 0 });
      logActivity(sub.userId, "task_approved", "task", sub.taskId, taskName, { xpAmount: task?.xpAmount ?? 0, reward: rewardAmount });
      const parsedEntityIds: number[] | null = sub.entityIds
        ? JSON.parse(sub.entityIds)
        : (sub.entityId ? [sub.entityId] : null);
      logProjectReward(task?.projectId, sub.taskId, sub.userId, sub.profit, parsedEntityIds);
    } else {
      await createNotification(sub.userId, "task_rejected", "Task Rejected",
        taskName ? `"${taskName}" was rejected. Reason: ${rejectionReason || "See admin notes."}` : "Your task was rejected.",
        { submissionId, taskId: sub.taskId, reason: rejectionReason });
      logActivity(sub.userId, "task_rejected", "task", sub.taskId, taskName, { reason: rejectionReason });
    }

    if (taskName) {
      notifyTaskVerified(sub.userId, taskName, !!approved, rewardAmount).catch(() => {});
      const { sendTaskApprovedEmail } = await import("../lib/email");
      const [user] = await db.select({ email: usersTable.email, username: usersTable.username })
        .from(usersTable).where(eq(usersTable.id, sub.userId));
      if (user && approved) {
        sendTaskApprovedEmail(user.email, user.username, taskName, rewardAmount).catch(() => {});
      } else if (user && !approved) {
        const { sendTaskRejectedEmail } = await import("../lib/email");
        sendTaskRejectedEmail(user.email, user.username, taskName ?? "", rejectionReason ?? undefined).catch(() => {});
      }
    }
  }

  broadcastEvent("tasks_updated", { action: "verified", submissionId, status });
  broadcastEvent("submissions_updated", { submissionId, status });
  broadcastEvent("users_updated", { reason: "task_verified" });
  if (sub) broadcastToUser(sub.userId, "submissions_updated", { submissionId, status, taskName });
  res.json({ message: `Submission ${status}` });
});

export default router;
