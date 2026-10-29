#!/usr/bin/env tsx
/**
 * One-time merge: reassign all scoped business rows to a single workspace Google sub.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... tsx scripts/merge-workspace-user-data.ts --target-sub=<google_sub> [--dry-run]
 *
 * Take a database backup before running without --dry-run.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const TABLES = [
  "invoiceplane_clients",
  "invoiceplane_invoices",
  "invoiceplane_quotations",
  "invoiceplane_payments",
  "invoiceplane_payment_receipts",
  "invoiceplane_receipts",
  "invoiceplane_job_orders",
  "invoiceplane_recurring_invoices",
  "invoiceplane_quotation_templates",
  "invoiceplane_client_proposals",
  "invoiceplane_proposal_documents",
  "invoiceplane_proposal_activity",
  "invoiceplane_proposal_questions",
  "invoiceplane_client_certifications",
] as const;

function parseArgs(): { targetSub: string; dryRun: boolean } {
  let targetSub = "";
  let dryRun = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--target-sub=")) targetSub = arg.slice("--target-sub=".length).trim();
  }
  if (!targetSub) {
    console.error("Missing --target-sub=<google_sub>");
    process.exit(1);
  }
  return { targetSub, dryRun };
}

async function main() {
  const { targetSub, dryRun } = parseArgs();
  console.log(dryRun ? "[dry-run]" : "[apply]", "target sub:", targetSub);

  for (const table of TABLES) {
    const countResult = await db.execute(
      sql.raw(`SELECT count(*)::int AS c FROM ${table} WHERE user_id IS DISTINCT FROM '${targetSub.replace(/'/g, "''")}'`),
    );
    const count = Number((countResult.rows[0] as { c: number })?.c ?? 0);
    console.log(`${table}: ${count} row(s) would update`);
    if (!dryRun && count > 0) {
      await db.execute(
        sql.raw(`UPDATE ${table} SET user_id = '${targetSub.replace(/'/g, "''")}' WHERE user_id IS DISTINCT FROM '${targetSub.replace(/'/g, "''")}'`),
      );
    }
  }

  if (!dryRun) {
    await db.execute(
      sql.raw(
        `UPDATE invoiceplane_company_settings SET workspace_data_user_id = '${targetSub.replace(/'/g, "''")}' WHERE id IS NOT NULL`,
      ),
    );
    console.log("Set invoiceplane_company_settings.workspace_data_user_id");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
