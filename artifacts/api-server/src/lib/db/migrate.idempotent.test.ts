import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { HEAL_DUPLICATE_CLIENT_CODES_SQL } from "./healDuplicateClientCodes";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../../../lib/db/migrations");

test("startup SQL migrations do not use unguarded ADD CONSTRAINT", () => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  assert.ok(files.includes("0031_document_number_uniqueness.sql"));

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    // Startup re-runs every file. ADD CONSTRAINT is only safe inside a DO block
    // that checks pg_constraint first (PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS).
    const withoutComments = sql.replace(/--[^\n]*/g, "");
    const withoutDoBlocks = withoutComments.replace(/DO\s+\$\$[\s\S]*?END\s+\$\$/gi, "");
    assert.doesNotMatch(
      withoutDoBlocks,
      /ADD CONSTRAINT/i,
      `${file} has unguarded ADD CONSTRAINT (42P07 on second boot)`,
    );
  }
});

test("0039 must not add a full unique constraint on client_code", () => {
  const sql = fs.readFileSync(
    path.join(migrationsDir, "0039_receipt_payment_link_and_indexes.sql"),
    "utf8",
  );
  const withoutComments = sql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(
    withoutComments,
    /ADD CONSTRAINT\s+"invoiceplane_clients_user_mode_code_uniq"/i,
    "0039 ADD CONSTRAINT on client_code is 23505 on boot when GTL001 (or any code) is duplicated",
  );
});

test("0038 heal runs after data_mode and before 0039 ADD CONSTRAINT", () => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort((a, b) => a.localeCompare(b));
  const dataMode = "0038_data_mode_test_sandbox.sql";
  const heal = "0038_heal_duplicate_client_codes.sql";
  const constraint = "0039_receipt_payment_link_and_indexes.sql";
  assert.ok(files.includes(heal), "0038_heal_duplicate_client_codes.sql must exist");
  assert.ok(dataMode.localeCompare(heal) < 0, "heal must run after data_mode exists");
  assert.ok(heal.localeCompare(constraint) < 0, "heal must run before 0039");
  assert.ok(files.indexOf(dataMode) < files.indexOf(heal));
  assert.ok(files.indexOf(heal) < files.indexOf(constraint));
});

test("0038 heal SQL stays in lockstep with the JS preflight", () => {
  const fileSql = fs.readFileSync(
    path.join(migrationsDir, "0038_heal_duplicate_client_codes.sql"),
    "utf8",
  );
  const fileDo = fileSql.match(/DO\s+\$\$[\s\S]*?END\s+\$\$/i)?.[0];
  const tsDo = HEAL_DUPLICATE_CLIENT_CODES_SQL.match(/DO\s+\$\$[\s\S]*?END\s+\$\$/i)?.[0];
  assert.ok(fileDo, "0038 heal must include a DO block");
  assert.ok(tsDo, "JS preflight must include a DO block");
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  assert.equal(norm(fileDo), norm(tsDo));
});

test("migrate.ts heals client_code duplicates before replaying SQL files", () => {
  const src = fs.readFileSync(path.join(here, "migrate.ts"), "utf8");
  assert.match(src, /HEAL_DUPLICATE_CLIENT_CODES_SQL/);
  assert.match(src, /Healing duplicate invoiceplane_clients codes before SQL migrations/);
  const healIdx = src.indexOf("HEAL_DUPLICATE_CLIENT_CODES_SQL");
  const loopIdx = src.indexOf("for (const file of files)");
  assert.ok(healIdx > 0 && loopIdx > healIdx, "preflight heal must run before the SQL file loop");
});

test("0044 self-heals duplicate active client codes then adds a partial unique index", () => {
  const sql = fs.readFileSync(
    path.join(migrationsDir, "0044_clients_code_partial_unique.sql"),
    "utf8",
  );
  assert.match(sql, /invoiceplane_clients_user_mode_code_uniq/);
  assert.match(sql, /WHERE\s+"deleted_at"\s+IS\s+NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "invoiceplane_clients_user_mode_code_uniq"/);
  assert.match(sql, /rn > 1/);
  assert.match(sql, /-DUP-/);
  assert.doesNotMatch(
    sql.replace(/--[^\n]*/g, ""),
    /ADD CONSTRAINT\s+"invoiceplane_clients_user_mode_code_uniq"/i,
  );
});

test("0031 skips existing document-number unique constraints", () => {
  const sql = fs.readFileSync(
    path.join(migrationsDir, "0031_document_number_uniqueness.sql"),
    "utf8",
  );
  for (const name of [
    "invoiceplane_invoices_user_number_uniq",
    "invoiceplane_quotations_user_number_uniq",
    "invoiceplane_job_orders_user_number_uniq",
  ]) {
    assert.match(sql, new RegExp(`conname = '${name}'`));
    assert.match(sql, new RegExp(`ADD CONSTRAINT "${name}" UNIQUE`));
  }
});
