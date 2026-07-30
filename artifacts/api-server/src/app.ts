import express, { type Express } from "express";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { logBus } from "./lib/log-bus";
import { globalErrorHandler, notFoundHandler } from "./middlewares/error-handler";
import {
  securityHeaders,
  corsMiddleware,
  globalLimiter,
  dedupeQueryParams,
  sanitizeBody,
  JSON_BODY_LIMIT,
} from "./middlewares/security";
import { apiKeyScopeGate } from "./middlewares/api-key-scope";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// Behind Render/Replit's reverse proxy — needed so req.ip and the rate
// limiter see the real client IP (X-Forwarded-For) instead of the proxy's.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const code = res.statusCode;
    const level = code >= 500 ? "ERROR" : code >= 400 ? "WARN" : "INFO";
    const route = req.url?.split("?")[0] ?? "/";
    logBus.push({
      time: Date.now(),
      level,
      msg: `${req.method} ${route} → ${code}`,
      method: req.method,
      url: route,
      statusCode: code,
      ms: durationMs,
    });
    // Write to request_metrics table (fire-and-forget, only for /api/* routes).
    // Uses drizzle's parameterized `sql` tag (bind params) instead of sql.raw
    // + manual string interpolation — the previous version built the query
    // with string concatenation, which is the exact pattern SQL injection
    // comes from even when individual fields look "safe enough to escape".
    if (route.startsWith("/api/")) {
      db.execute(
        sql`INSERT INTO request_metrics (route, method, status_code, duration_ms)
            VALUES (${route}, ${req.method}, ${code}, ${durationMs})`,
      ).catch(() => { /* ignore until table exists after migration */ });
    }
  });
  next();
});

// ── Security layer ───────────────────────────────────────────────────────────
// See middlewares/security.ts for the full rationale behind each piece.
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
// Accepts raw CSV body (e.g. vault bulk import/export) alongside JSON.
app.use(express.text({ type: ["text/csv", "text/plain"], limit: "5mb" }));
app.use(dedupeQueryParams);
app.use(sanitizeBody);

app.use("/api", globalLimiter, apiKeyScopeGate, router);

app.use("/api/{*splat}", notFoundHandler);
app.use(globalErrorHandler as any);

// ── Serve built frontend in production ───────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(__dirname, "../../ayzen/dist/public");
  app.use(express.static(distPath));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

export default app;
