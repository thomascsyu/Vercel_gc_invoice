import type { IncomingMessage, ServerResponse } from "node:http";
import { businessTimeZone } from "@workspace/invoice-utils";
import app from "./app";
import { logger } from "./lib/logger";
import { envFlagEnabled } from "./lib/uploadStoragePersistence";
import { runSqlMigrationsOnStartup } from "./lib/db/migrate";
import { assertProductionSecurityConfig } from "./lib/productionGuards";

/**
 * Vercel Function entry (bundled by build.mjs, packaged by scripts/vercel-build.mjs).
 *
 * Differences from the long-lived server in index.ts:
 * - No `listen()`: Vercel hands each request to the default export.
 * - No node-cron: the daily jobs run through Vercel Cron → /api/cron/*.
 * - Migrations run during `vercel-build` (production deploys) rather than on
 *   every cold start. Set RUN_MIGRATIONS_ON_START=1 to also run them here.
 */
// Vercel (AWS Lambda) sets TZ=":UTC". The Docker image runs with
// TZ=Asia/Hong_Kong and several paths use local-time Date methods (YYMM
// document-number stamps, dashboard month ranges), so restore the business
// zone for this process. Node picks up TZ changes at runtime.
const tz = process.env["TZ"]?.trim();
if (!tz || tz.startsWith(":")) {
  process.env["TZ"] = businessTimeZone();
}

let ready: Promise<void> | null = null;

function init(): Promise<void> {
  ready ??= (async () => {
    assertProductionSecurityConfig();
    if (envFlagEnabled("RUN_MIGRATIONS_ON_START")) {
      await runSqlMigrationsOnStartup();
    }
  })().catch((err) => {
    // Retry on the next request instead of caching a failed boot forever.
    ready = null;
    throw err;
  });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await init();
  } catch (err) {
    logger.error({ err }, "API failed to initialise");
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Server misconfigured" }));
    return;
  }
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
