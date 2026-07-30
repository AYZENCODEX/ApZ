import { Router } from "express";
import { db, vaultEntriesTable, usersTable, userProjectsTable, projectsTable, taskSubmissionsTable } from "@workspace/db";
import { eq, desc, count, sql } from "drizzle-orm";

const router = Router();

export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile",                     name: "Llama 3.3 70B Versatile",       context: 128000, free: true,  tier: "recommended",  speed: "fast" },
  { id: "llama-3.1-8b-instant",                         name: "Llama 3.1 8B Instant",           context: 131072, free: true,  tier: "recommended",  speed: "ultra-fast" },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct",   name: "Llama 4 Scout 17B",              context: 131072, free: true,  tier: "recommended",  speed: "fast" },
  { id: "llama3-70b-8192",                              name: "Llama 3 70B",                    context: 8192,   free: true,  tier: "stable",       speed: "fast" },
  { id: "llama3-8b-8192",                               name: "Llama 3 8B",                     context: 8192,   free: true,  tier: "stable",       speed: "ultra-fast" },
  { id: "gemma2-9b-it",                                 name: "Gemma 2 9B IT",                  context: 8192,   free: true,  tier: "stable",       speed: "fast" },
  { id: "qwen-qwq-32b",                                 name: "Qwen QwQ 32B",                   context: 131072, free: true,  tier: "reasoning",    speed: "medium" },
  { id: "deepseek-r1-distill-llama-70b",                name: "DeepSeek R1 Distill 70B",        context: 131072, free: true,  tier: "reasoning",    speed: "medium" },
  { id: "llama-3.3-70b-specdec",                        name: "Llama 3.3 70B SpecDec",          context: 8192,   free: true,  tier: "experimental", speed: "fast" },
  { id: "llama-guard-3-8b",                             name: "Llama Guard 3 8B",               context: 8192,   free: true,  tier: "safety",       speed: "fast" },
];

const DEFAULT_MODEL = "llama-3.3-70b-versatile";

const USER_SYSTEM = `You are AYZEN AI — a dedicated crypto airdrop intelligence assistant for the AYZEN Airdrop Command Center.

You have DIRECT ACCESS to the user's live account data (injected below). Answer questions about:
- Their vault credential entities (wallets, emails, socials per airdrop project)
- Their enrolled projects and airdrop participation
- Completed tasks, submission history, ROI, streak
- General crypto: airdrops, DeFi, L2 networks, gas optimization, sybil avoidance

🔧 ACTIONS YOU CAN PERFORM:
When the user asks you to perform an action, respond with an action block at the END of your response in this EXACT format:

ACTION: create_vault
PROJECT: <projectName>
CATEGORY: <Wallet|Twitter|Discord|Telegram>
EMAIL: <email or skip>
TWITTER: <@handle or skip>
DISCORD: <username or skip>
TELEGRAM: <@handle or skip>

ACTION: complete_task
TASK_ID: <numeric id>
NOTES: <optional notes>

ACTION: get_password
PROJECT: <projectName>
FIELD: <email|twitter_password|discord_password|telegram_password>

ACTION: add_roi
AMOUNT: <number>
PROJECT_ID: <optional project id>
NOTES: <description>

Rules:
- When asked about their data ("my accounts", "my vault", "my wallets"), refer to the injected context
- When asked to CREATE a vault entry, ADD a project/account, or COMPLETE a task — use the ACTION blocks above
- When asked for a password or credentials, use ACTION: get_password
- Never fabricate credentials — only report what's in the context
- Be concise, direct, and crypto-native
- Use $TICKER symbols when relevant
- Only use one ACTION block per response`;

const ADMIN_SYSTEM = `You are AYZEN Admin AI — an intelligent admin assistant for the AYZEN crypto airdrop platform.

You have DIRECT ACCESS to live platform statistics (injected below). You can help with:
- Platform analytics: user counts, project stats, vault entries, ROI distributed
- User management: answering questions about operators, roles, activity
- Project management: explaining project details, task completion rates
- Operational decisions: airdrop strategy, vault credential management, tier structure
- Technical debugging: API errors, database issues, system health

Rules:
- Be precise and data-driven, referencing the injected platform stats
- Use admin-appropriate language — direct, professional, action-oriented
- For destructive actions (delete user, ban, etc.), describe the action but clarify it must be done via the admin panel
- Be concise — executives don't want long explanations`;

function buildUserContext(user: any, vault: any[], projects: any[], tasks: any[]): string {
  const lines = ["\n\n══ LIVE USER CONTEXT FROM AYZEN DB ══"];
  lines.push(`Operator: ${user.username} | Streak: ${user.streak}d | Total ROI: $${user.totalRoi} | Role: ${user.role}`);
  if (vault.length) {
    lines.push(`\n📂 Vault Entities (${vault.length} total):`);
    vault.slice(0, 25).forEach(e => {
      lines.push(`  [${e.entitySerial}] ${e.projectName} — ${e.category}`);
      if (e.email) lines.push(`    ✉ ${e.email}`);
      if (e.twitterUsername) lines.push(`    🐦 @${e.twitterUsername}`);
      if (e.discordUsername) lines.push(`    💬 ${e.discordUsername}`);
      if (e.telegramUsername) lines.push(`    📱 @${e.telegramUsername}`);
      const wallets: string[] = e.walletAddresses ? JSON.parse(e.walletAddresses) : [];
      if (wallets.length) lines.push(`    👛 ${wallets.join(" | ")}`);
    });
    if (vault.length > 25) lines.push(`  … +${vault.length - 25} more entities`);
  }
  if (projects.length) {
    lines.push(`\n🚀 Enrolled Projects (${projects.length}):`);
    projects.slice(0, 15).forEach(p => {
      lines.push(`  • ${p.name} | Tier: ${p.tier} | Est. Reward: $${p.rewardEstimate ?? "TBD"}`);
    });
  }
  if (tasks.length) {
    lines.push(`\n✅ Recent Task Submissions:`);
    tasks.slice(0, 8).forEach(t => {
      lines.push(`  • Task #${t.taskId} | ${t.status} | $${t.rewardAmount ?? "?"}`);
    });
  }
  lines.push("══════════════════════════════════════");
  return lines.join("\n");
}

async function buildAdminContext(): Promise<string> {
  try {
    const [{ totalUsers }] = await db.select({ totalUsers: count() }).from(usersTable);
    const [{ totalProjects }] = await db.select({ totalProjects: count() }).from(projectsTable);
    const [{ totalVault }] = await db.select({ totalVault: count() }).from(vaultEntriesTable);
    const [{ totalSubmissions }] = await db.select({ totalSubmissions: count() }).from(taskSubmissionsTable);
    const projects = await db.select({ name: projectsTable.name, tier: projectsTable.tier, rewardEstimate: projectsTable.rewardEstimate, fundingAmount: projectsTable.fundingAmount }).from(projectsTable).limit(20);
    const recentUsers = await db.select({ username: usersTable.username, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt }).from(usersTable).orderBy(desc(usersTable.createdAt)).limit(10);

    const lines = ["\n\n══ LIVE PLATFORM CONTEXT FROM AYZEN DB ══"];
    lines.push(`Platform Stats: ${totalUsers} operators | ${totalProjects} projects | ${totalVault} vault entities | ${totalSubmissions} task submissions`);
    if (projects.length) {
      lines.push(`\n🚀 Active Projects:`);
      projects.forEach(p => lines.push(`  • ${p.name} | Tier ${p.tier} | Est. Reward: $${p.rewardEstimate} | Funding: $${p.fundingAmount}`));
    }
    if (recentUsers.length) {
      lines.push(`\n👥 Recent Operators (newest 10):`);
      recentUsers.forEach(u => lines.push(`  • ${u.username} (${u.email}) | Role: ${u.role}`));
    }
    lines.push("══════════════════════════════════════");
    return lines.join("\n");
  } catch {
    return "\n\n[Platform context unavailable — DB offline]";
  }
}

function getAuth(req: any): { userId: number; role: string } {
  const auth = req.headers.authorization as string | undefined;
  if (!auth) return { userId: 1, role: "user" };
  try {
    const p = JSON.parse(Buffer.from(auth.replace("Bearer ", ""), "base64").toString());
    return { userId: p.userId ?? 1, role: p.role ?? "user" };
  } catch { return { userId: 1, role: "user" }; }
}

router.post("/ai/chat", async (req, res): Promise<void> => {
  const groqKey = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openAiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const openAiBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

  if (!groqKey && !openRouterKey && !openAiKey) {
    res.status(503).json({ error: "AI not configured. Add GROQ_API_KEY in Replit Secrets." });
    return;
  }

  const { messages, model } = req.body;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  const { userId, role } = getAuth(req);
  const isAdmin = role === "admin" || role === "operator";

  let systemPrompt: string;
  if (isAdmin) {
    const ctx = await buildAdminContext();
    systemPrompt = ADMIN_SYSTEM + ctx;
  } else {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const vault = await db.select().from(vaultEntriesTable).where(eq(vaultEntriesTable.userId, userId));
    const projects = await db.select({ name: projectsTable.name, tier: projectsTable.tier, rewardEstimate: projectsTable.rewardEstimate })
      .from(userProjectsTable)
      .innerJoin(projectsTable, eq(userProjectsTable.projectId, projectsTable.id))
      .where(eq(userProjectsTable.userId, userId));
    const tasks = await db.select().from(taskSubmissionsTable)
      .where(eq(taskSubmissionsTable.userId, userId))
      .orderBy(desc(taskSubmissionsTable.submittedAt))
      .limit(10);
    systemPrompt = USER_SYSTEM + (user ? buildUserContext(user, vault, projects, tasks) : "");
  }

  const selectedModel = (model && GROQ_MODELS.find(m => m.id === model)) ? model : DEFAULT_MODEL;
  const allMessages = [{ role: "system", content: systemPrompt }, ...messages.slice(-20)];

  type ProviderResult = { ok: true; data: Record<string, unknown>; label: string } | { ok: false; error: string };

  async function tryGroq(): Promise<ProviderResult> {
    if (!groqKey) return { ok: false, error: "GROQ_API_KEY not set" };
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel, messages: allMessages, max_tokens: 1024 }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok || (data as any)?.error) {
        return { ok: false, error: `Groq: ${JSON.stringify((data as any)?.error ?? data)}` };
      }
      return { ok: true, data, label: selectedModel };
    } catch (err: any) {
      return { ok: false, error: `Groq: ${err?.message ?? "request failed"}` };
    }
  }

  async function tryOpenRouter(): Promise<ProviderResult> {
    if (!openRouterKey) return { ok: false, error: "OPENROUTER_API_KEY not set" };
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openRouterKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://ayzen.tech" },
        body: JSON.stringify({ model: "meta-llama/llama-3.3-70b-instruct:free", messages: allMessages, max_tokens: 1024 }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok || (data as any)?.error) {
        return { ok: false, error: `OpenRouter: ${JSON.stringify((data as any)?.error ?? data)}` };
      }
      return { ok: true, data, label: "llama-3.3-70b (OpenRouter)" };
    } catch (err: any) {
      return { ok: false, error: `OpenRouter: ${err?.message ?? "request failed"}` };
    }
  }

  async function tryReplitAi(): Promise<ProviderResult> {
    if (!openAiKey || !openAiBase) return { ok: false, error: "Replit AI integration not configured" };
    try {
      const response = await fetch(`${openAiBase}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-5-mini", messages: allMessages, max_completion_tokens: 1024 }),
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok || (data as any)?.error) {
        return { ok: false, error: `Replit AI: ${JSON.stringify((data as any)?.error ?? data)}` };
      }
      return { ok: true, data, label: "gpt-5-mini (Replit AI)" };
    } catch (err: any) {
      return { ok: false, error: `Replit AI: ${err?.message ?? "request failed"}` };
    }
  }

  const providers = [tryGroq, tryOpenRouter, tryReplitAi];
  const errors: string[] = [];

  for (const provider of providers) {
    const result = await provider();
    if (result.ok) {
      res.json({ ...result.data, _model: result.label });
      return;
    }
    errors.push(result.error);
  }

  res.status(502).json({
    error: "All AI providers failed. Check that your API keys are valid.",
    details: errors,
  });
});

router.get("/ai/models", (_req, res) => {
  res.json(GROQ_MODELS);
});

export default router;
