import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../lib/db/migrations",
);

/**
 * Replays the 0044 self-heal against two active GTL001 rows — the exact
 * 23505 that crash-looped production (`user_id, live, GTL001`).
 */
test("0044 heal renames a duplicate active GTL001 before the unique index", async (t) => {
  const databaseUrl = process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5432/postgres";
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch {
    t.skip("PostgreSQL is not available");
    return;
  }

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE "invoiceplane_clients" (
        "id" uuid PRIMARY KEY,
        "user_id" text NOT NULL,
        "data_mode" text NOT NULL,
        "client_code" text NOT NULL,
        "deleted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      ) ON COMMIT DROP;
    `);

    const userId = "116820260239879027957";
    await client.query(
      `INSERT INTO "invoiceplane_clients" ("id", "user_id", "data_mode", "client_code")
       VALUES
         ('00000000-0000-0000-0000-000000000001', $1, 'live', 'GTL001'),
         ('00000000-0000-0000-0000-000000000002', $1, 'live', 'GTL001')`,
      [userId],
    );

    const sql = fs.readFileSync(path.join(migrationsDir, "0044_clients_code_partial_unique.sql"), "utf8");
    const heal = sql.match(/DO\s+\$\$[\s\S]*?END\s+\$\$/i)?.[0];
    assert.ok(heal, "0044 must include a self-heal DO block");
    // Only the heal block — DROP INDEX / CREATE INDEX would target the real
    // public.invoiceplane_clients index if search_path hits public first.
    await client.query(heal);

    const { rows } = await client.query<{ client_code: string }>(
      `SELECT "client_code" FROM "invoiceplane_clients" ORDER BY "id"`,
    );
    const codes = rows.map((r) => r.client_code);
    assert.equal(codes.filter((c) => c === "GTL001").length, 1);
    assert.equal(new Set(codes).size, 2);
    assert.ok(codes.some((c) => c.startsWith("GTL001-DUP-")));
    await client.query("ROLLBACK");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    await client.end();
  }
});
