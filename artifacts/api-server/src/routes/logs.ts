import { Router } from "express";
import { logBus } from "../lib/log-bus";

const router = Router();

router.get("/admin/logs/stream", (req, res): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const recent = logBus.recent(150);
  if (recent.length) {
    res.write(`data: ${JSON.stringify({ type: "history", entries: recent })}\n\n`);
  }

  const onLog = (entry: unknown) => {
    res.write(`data: ${JSON.stringify({ type: "entry", entry })}\n\n`);
  };

  logBus.on("log", onLog);

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    logBus.off("log", onLog);
  });
});

router.delete("/admin/logs", (_req, res): void => {
  res.json({ ok: true });
});

export default router;
