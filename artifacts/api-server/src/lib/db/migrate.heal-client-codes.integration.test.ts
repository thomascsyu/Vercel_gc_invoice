import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { HEAL_DUPLICATE_CLIENT_CODES_SQL } from "./healDuplicateClientCodes";

/**
 * Exact statement from the original 0039 that crash-loops production:
 *   could not create unique index "invoiceplane_clients_user_mode_code_uniq"
 *   Key (user_id, data_mode, client_code)=(116820260239879027957, live, GTL001)
 *
 * IF NOT EXISTS on pg_constraint is omitted here so a leftover public
 * constraint of the same name cannot skip the ALTER on this TEMP table.
 */
const OLD_0039_ADD_CONSTRAINT = `
ALTER TABLE "invoiceplane_clients"
  ADD CONSTRAINT "invoiceplane_clients_user_mode_code_uniq"
  UNIQUE ("user_id", "data_mode", "client_code");
`;

test("preflight heal lets old 0039 ADD CONSTRAINT succeed for duplicate GTL001", async (t) => {
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

    await client.query("SAVEPOINT before_old_0039");
    await assert.rejects(
      () => client.query(OLD_0039_ADD_CONSTRAINT),
      (err: unknown) =>
        err instanceof Error &&
        /invoiceplane_clients_user_mode_code_uniq/.test(err.message) &&
        "code" in err &&
        (err as { code: string }).code === "23505",
      "duplicate GTL001 must reproduce the production 23505 before heal",
    );
    await client.query("ROLLBACK TO SAVEPOINT before_old_0039");

    await client.query(HEAL_DUPLICATE_CLIENT_CODES_SQL);

    const { rows } = await client.query<{ client_code: string }>(
      `SELECT "client_code" FROM "invoiceplane_clients" ORDER BY "id"`,
    );
    const codes = rows.map((r) => r.client_code);
    assert.equal(codes.filter((c) => c === "GTL001").length, 1);
    assert.equal(new Set(codes).size, 2);
    assert.ok(codes.some((c) => c.startsWith("GTL001-DUP-")));

    await client.query(OLD_0039_ADD_CONSTRAINT);
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

test("preflight heal keeps the active GTL001 when a soft-deleted row collides", async (t) => {
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
      `INSERT INTO "invoiceplane_clients" ("id", "user_id", "data_mode", "client_code", "deleted_at", "created_at")
       VALUES
         ('00000000-0000-0000-0000-000000000001', $1, 'live', 'GTL001', now(), '2024-01-01T00:00:00Z'),
         ('00000000-0000-0000-0000-000000000002', $1, 'live', 'GTL001', NULL, '2025-01-01T00:00:00Z')`,
      [userId],
    );

    await client.query(HEAL_DUPLICATE_CLIENT_CODES_SQL);

    const { rows } = await client.query<{ id: string; client_code: string; deleted_at: Date | null }>(
      `SELECT "id", "client_code", "deleted_at" FROM "invoiceplane_clients" ORDER BY "id"`,
    );
    const deleted = rows.find((r) => r.id.endsWith("0001"));
    const active = rows.find((r) => r.id.endsWith("0002"));
    assert.ok(deleted && active);
    assert.equal(active.client_code, "GTL001");
    assert.ok(deleted.client_code.startsWith("GTL001-DUP-"));
    assert.ok(deleted.deleted_at);
    assert.equal(active.deleted_at, null);

    await client.query(OLD_0039_ADD_CONSTRAINT);
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
