#!/usr/bin/env tsx
/**
 * One-time merge: reassign all scoped business rows to a single workspace Google sub.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... tsx scripts/merge-workspace-user-data.ts --target-sub=<google_sub> [--rename-duplicates] [--dry-run]
 *
 * Runs in a single transaction: either every table is moved and
 * company_settings.workspace_data_user_id is set, or nothing changes.
 *
 * Per-user numbering (client codes, invoice/quotation/job order/receipt numbers,
 * proposal numbers) usually overlaps between users — e.g. every user was seeded
 * with client ACM001. Those overlaps would violate the workspace-wide unique
 * indexes, so the script lists them and aborts unless --rename-duplicates is
 * given. With that flag the target user's rows (then the oldest row) keep their
 * number and the others get a "-2", "-3", … suffix.
 *
 * --dry-run performs the whole merge and then rolls it back, so the report
 * matches what a real run would do.
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

/** Columns that are unique per (user_id, data_mode) and therefore collide once users are merged. */
const NUMBERED = [
  { table: "invoiceplane_clients", column: "client_code", activeOnly: true },
  { table: "invoiceplane_invoices", column: "invoice_number", activeOnly: true },
  { table: "invoiceplane_quotations", column: "quotation_number", activeOnly: false },
  { table: "invoiceplane_job_orders", column: "job_order_number", activeOnly: false },
  { table: "invoiceplane_receipts", column: "receipt_number", activeOnly: false },
] as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class DryRunRollback extends Error {}

function parseArgs(): { targetSub: string; dryRun: boolean; renameDuplicates: boolean } {
  let targetSub = "";
  let dryRun = false;
  let renameDuplicates = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--rename-duplicates") renameDuplicates = true;
    else if (arg.startsWith("--target-sub=")) targetSub = arg.slice("--target-sub=".length).trim();
  }
  if (!targetSub) {
    console.error("Missing --target-sub=<google_sub>");
    process.exit(1);
  }
  return { targetSub, dryRun, renameDuplicates };
}

type Duplicate = { id: string; user_id: string; data_mode: string; value: string; rn: number };

async function findNumberDuplicates(
  tx: Tx,
  targetSub: string,
  spec: (typeof NUMBERED)[number],
): Promise<Duplicate[]> {
  const col = sql.identifier(spec.column);
  const where = spec.activeOnly ? sql`WHERE deleted_at IS NULL` : sql``;
  const result = await tx.execute(sql`
    SELECT id::text, user_id, data_mode, value, rn::int FROM (
      SELECT id, user_id, data_mode, ${col} AS value,
             row_number() OVER (
               PARTITION BY data_mode, ${col}
               ORDER BY (user_id = ${targetSub}) DESC, created_at, id
             ) AS rn
      FROM ${sql.identifier(spec.table)} ${where}
    ) ranked
    WHERE rn > 1
    ORDER BY data_mode, value, rn`);
  return result.rows as Duplicate[];
}

type ProposalDuplicate = { user_id: string; proposal_no: string; rnk: number };

/** Proposal numbers are unique per (user_id, proposal_no, proposal_revision); rename whole revision chains. */
async function findProposalDuplicates(tx: Tx, targetSub: string): Promise<ProposalDuplicate[]> {
  const result = await tx.execute(sql`
    SELECT user_id, proposal_no, rnk::int FROM (
      SELECT user_id, proposal_no,
             dense_rank() OVER (
               PARTITION BY proposal_no
               ORDER BY (user_id = ${targetSub}) DESC, min_created, user_id
             ) AS rnk
      FROM (
        SELECT user_id, proposal_no, min(created_at) AS min_created
        FROM invoiceplane_proposal_documents
        GROUP BY user_id, proposal_no
      ) chains
    ) ranked
    WHERE rnk > 1
    ORDER BY proposal_no, rnk`);
  return result.rows as ProposalDuplicate[];
}

async function resolveDuplicates(tx: Tx, targetSub: string, renameDuplicates: boolean): Promise<void> {
  let total = 0;
  for (const spec of NUMBERED) {
    const dups = await findNumberDuplicates(tx, targetSub, spec);
    total += dups.length;
    for (const d of dups) {
      const renamed = `${d.value}-${d.rn}`;
      console.log(`  ${spec.table}.${spec.column} [${d.data_mode}] "${d.value}" (user ${d.user_id}) → "${renamed}"`);
      if (renameDuplicates) {
        await tx.execute(sql`
          UPDATE ${sql.identifier(spec.table)} SET ${sql.identifier(spec.column)} = ${renamed}
          WHERE id = ${d.id}::uuid`);
      }
    }
  }

  const proposalDups = await findProposalDuplicates(tx, targetSub);
  total += proposalDups.length;
  for (const d of proposalDups) {
    const renamed = `${d.proposal_no}-${d.rnk}`;
    console.log(`  invoiceplane_proposal_documents.proposal_no "${d.proposal_no}" (user ${d.user_id}, all revisions) → "${renamed}"`);
    if (renameDuplicates) {
      await tx.execute(sql`
        UPDATE invoiceplane_proposal_documents SET proposal_no = ${renamed}
        WHERE user_id = ${d.user_id} AND proposal_no = ${d.proposal_no}`);
    }
  }

  if (total === 0) {
    console.log("No duplicate numbers across users.");
  } else if (!renameDuplicates) {
    throw new Error(
      `${total} duplicate number(s) across users (listed above) would violate unique indexes after the merge. ` +
        "Re-run with --rename-duplicates to suffix them, or fix them by hand. Nothing was changed.",
    );
  } else {
    console.log(`Renamed ${total} duplicate number(s).`);
  }
}

async function main() {
  const { targetSub, dryRun, renameDuplicates } = parseArgs();
  console.log(dryRun ? "[dry-run]" : "[apply]", "target sub:", targetSub);

  const target = await db.execute(
    sql`SELECT google_sub FROM invoiceplane_users WHERE google_sub = ${targetSub} LIMIT 1`,
  );
  if (target.rows.length === 0) {
    throw new Error(`--target-sub ${targetSub} does not match any invoiceplane_users.google_sub`);
  }

  try {
    await db.transaction(async (tx) => {
      console.log("Checking for duplicate numbers across users…");
      await resolveDuplicates(tx, targetSub, renameDuplicates || dryRun);

      for (const table of TABLES) {
        const result = await tx.execute(sql`
          UPDATE ${sql.identifier(table)} SET user_id = ${targetSub}
          WHERE user_id IS DISTINCT FROM ${targetSub}`);
        console.log(`${table}: ${result.rowCount ?? 0} row(s) reassigned`);
      }

      const settings = await tx.execute(
        sql`UPDATE invoiceplane_company_settings SET workspace_data_user_id = ${targetSub}`,
      );
      if ((settings.rowCount ?? 0) === 0) {
        throw new Error("invoiceplane_company_settings has no row; start the API once to create it, then re-run.");
      }
      console.log("Set invoiceplane_company_settings.workspace_data_user_id");

      if (dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (err instanceof DryRunRollback) {
      console.log("[dry-run] Rolled back; no changes were saved.");
      if (!renameDuplicates) {
        console.log("[dry-run] Any duplicates listed above need --rename-duplicates (or manual fixes) for a real run.");
      }
      return;
    }
    throw err;
  }

  console.log("Done. Restart the API (or wait 60s) so every instance picks up the new owner.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
