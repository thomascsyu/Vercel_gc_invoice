import { logger } from "./lib/logger";
import { runSqlMigrationsOnStartup } from "./lib/db/migrate";

/** One-shot migration runner (`node dist/migrate.mjs`), used by the Vercel build. */
runSqlMigrationsOnStartup().catch((err) => {
  logger.error({ err }, "Migrations failed");
  process.exit(1);
});
