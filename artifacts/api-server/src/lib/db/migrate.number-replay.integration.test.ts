import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import pg from "pg";

const migrations = new URL("../../../../../lib/db/migrations/", import.meta.url);

// Explicit opt-in: never run schema-changing tests against the application DB.
test("document number migrations survive reboot after sandbox and soft-delete reuse", {
  skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.MIGRATION_TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA migration_number_replay_test;
      SET LOCAL search_path TO migration_number_replay_test;`);
    for (const [table, number] of [
      ["invoices", "invoice_number"], ["quotations", "quotation_number"],
      ["job_orders", "job_order_number"], ["receipts", "receipt_number"],
    ]) {
      await client.query(`CREATE TABLE "invoiceplane_${table}" (
        user_id text NOT NULL, "${number}" text NOT NULL, deleted_at timestamptz
      )`);
    }
    for (const table of ["company_settings", "clients", "payments", "payment_receipts"]) {
      await client.query(`CREATE TABLE "invoiceplane_${table}" (user_id text NOT NULL)`);
    }
    const files = ["0031_document_number_uniqueness.sql", "0038_data_mode_test_sandbox.sql",
      "0046_invoices_number_partial_unique.sql"];
    const replay = async () => {
      for (const file of files) await client.query(await fs.readFile(new URL(file, migrations), "utf8"));
    };
    await replay(); // Fresh installation.
    await replay(); // Empty database reboot (used to fail with 42P07).
    for (const [table, number] of [
      ["invoices", "invoice_number"], ["quotations", "quotation_number"],
      ["job_orders", "job_order_number"], ["receipts", "receipt_number"],
    ]) {
      await client.query(`INSERT INTO "invoiceplane_${table}" (user_id, "${number}", data_mode)
        VALUES ('user-1', 'DOC-001', 'live'), ('user-1', 'DOC-001', 'test')`);
    }
    await client.query(`INSERT INTO invoiceplane_invoices
      (user_id, invoice_number, data_mode, deleted_at)
      VALUES ('user-1', 'DOC-001', 'live', now())`);
    await replay(); // Legitimate duplicate numbers must survive unchanged.
    assert.equal((await client.query("SELECT * FROM invoiceplane_invoices")).rowCount, 3);
    await client.query("SAVEPOINT duplicate_check");
    await assert.rejects(client.query(`INSERT INTO invoiceplane_invoices
      (user_id, invoice_number, data_mode) VALUES ('user-1', 'DOC-001', 'live')`),
      (err: any) => err.code === "23505");
    await client.query("ROLLBACK TO SAVEPOINT duplicate_check");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
