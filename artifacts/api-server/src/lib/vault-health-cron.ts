/**
 * lib/vault-health-cron.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cron wiring for the daily vault health scan (see vault-health-scan.ts).
 * Kept separate from the scan logic itself so the scan stays testable/callable
 * on its own (e.g. an admin "run now" button could import runDailyHealthScan
 * directly without touching the scheduler).
 *
 * Schedule is configurable via VAULT_HEALTH_SCAN_CRON (standard 5-field cron
 * syntax); defaults to 09:00 server time daily.
 */

import cron from "node-cron";
import { logger } from "./logger";
import { logBus } from "./log-bus";
import { runDailyHealthScan } from "./vault-health-scan";

let scheduled = false;

export function startVaultHealthCron(): void {
  if (scheduled) return; // guard against double-init (e.g. hot reload)
  scheduled = true;

  const expr = process.env.VAULT_HEALTH_SCAN_CRON ?? "0 9 * * *";
  if (!cron.validate(expr)) {
    logger.warn({ expr }, "VAULT_HEALTH_SCAN_CRON is not a valid cron expression — health scan cron disabled");
    logBus.warn(`Vault health scan cron disabled: invalid schedule "${expr}"`);
    return;
  }

  cron.schedule(expr, () => {
    runDailyHealthScan().catch((err) => {
      logger.error({ err }, "Daily vault health scan failed");
      logBus.error(`Vault health scan failed: ${err?.message ?? err}`);
    });
  });

  logBus.system(`✅ Vault health scan cron scheduled ("${expr}")`);
  logger.info({ expr }, "Vault health scan cron scheduled");
}
