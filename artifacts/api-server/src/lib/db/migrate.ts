import { resolveDatabaseUrl } from "@workspace/db/database-url";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { logger } from "../logger";
import { HEAL_DUPLICATE_CLIENT_CODES_SQL } from "./healDuplicateClientCodes";

function migrationsDir(): string {
  // In Docker, WORKDIR is `/app/artifacts/api-server`, so this resolves to `/app/lib/db/migrations`.
  // In local dev, running from the same folder also works.
  return path.resolve(process.cwd(), "../../lib/db/migrations");
}

async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

// Arbitrary fixed key for the session-level advisory lock below. Any two
// processes calling pg_advisory_lock with the same key serialize against
// each other; the value itself has no meaning beyond being consistent.
const MIGRATION_ADVISORY_LOCK_KEY = 84_2231_9773;

/**
 * Re-applies every `*.sql` file in `lib/db/migrations` on each boot (there is
 * no applied-migration ledger). SQL files MUST be idempotent (`IF NOT EXISTS`,
 * or equivalent `DO $$ ... $$` guards) so a second start cannot fail with
 * 42P07 "relation already exists".
 *
 * Per-file idempotency alone isn't enough when two replicas boot at once
 * against a fresh/pre-migration database: both can pass a file's existence
 * check before either commits, and the loser fails with a duplicate-object
 * error. A session-level advisory lock serializes concurrent startups so
 * only one replica applies migrations at a time; the rest wait, then find
 * everything already applied.
 */
export async function runSqlMigrationsOnStartup(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl();
  const dir = migrationsDir();
  const files = await listMigrationFiles(dir);

  if (files.length === 0) {
    logger.warn({ dir }, "No SQL migrations found; skipping startup migrations");
    return;
  }

  logger.info({ dir, count: files.length }, "Running SQL migrations on startup");

  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
    try {
      // Must run *before* the SQL files. Older 0039 still ADD CONSTRAINTs a
      // full UNIQUE(user_id, data_mode, client_code); that is 23505 on GTL001
      // and crash-loops the pod before 0044 can heal. Embedded here so a stale
      // Docker `lib` layer cannot skip the rename.
      logger.info("Healing duplicate invoiceplane_clients codes before SQL migrations");
      await client.query("BEGIN");
      try {
        await client.query(HEAL_DUPLICATE_CLIENT_CODES_SQL);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }

      for (const file of files) {
        const fullPath = path.join(dir, file);
        const sql = await fs.readFile(fullPath, "utf-8");
        const trimmed = sql.trim();
        if (!trimmed) continue;

        logger.info({ file }, "Applying migration");
        await client.query("BEGIN");
        try {
          await client.query(trimmed);
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      }

      logger.info("Startup migrations complete");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}
