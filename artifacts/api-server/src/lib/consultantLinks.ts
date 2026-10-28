import {
  consultantsTable,
  db,
  invoiceConsultantsTable,
  jobOrderConsultantsTable,
  proposalDocumentConsultantsTable,
} from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";

/** Minimal executor shape needed to read/write consultant links: either `db` or a `tx` from `db.transaction(...)`. */
export type ConsultantLinkExecutor = Pick<typeof db, "select" | "delete" | "insert">;
type SelectExecutor = Pick<typeof db, "select">;

/**
 * Identifies one of the three consultant join tables added by migration
 * 0036 (invoice/job-order/proposal <-> consultant), so the load/replace
 * helpers below are written once and reused for all three parents instead
 * of three near-identical copies.
 */
export type ConsultantLinkSpec = {
  table: AnyPgTable;
  parentIdColumn: PgColumn;
  consultantIdColumn: PgColumn;
  /** Insert-row property key for the parent id (matches the Drizzle column's JS property name). */
  parentIdKey: string;
  consultantIdKey: string;
};

export const INVOICE_CONSULTANTS: ConsultantLinkSpec = {
  table: invoiceConsultantsTable,
  parentIdColumn: invoiceConsultantsTable.invoiceId,
  consultantIdColumn: invoiceConsultantsTable.consultantId,
  parentIdKey: "invoiceId",
  consultantIdKey: "consultantId",
};

export const JOB_ORDER_CONSULTANTS: ConsultantLinkSpec = {
  table: jobOrderConsultantsTable,
  parentIdColumn: jobOrderConsultantsTable.jobOrderId,
  consultantIdColumn: jobOrderConsultantsTable.consultantId,
  parentIdKey: "jobOrderId",
  consultantIdKey: "consultantId",
};

export const PROPOSAL_CONSULTANTS: ConsultantLinkSpec = {
  table: proposalDocumentConsultantsTable,
  parentIdColumn: proposalDocumentConsultantsTable.proposalId,
  consultantIdColumn: proposalDocumentConsultantsTable.consultantId,
  parentIdKey: "proposalId",
  consultantIdKey: "consultantId",
};

/**
 * Replaces the full set of consultants linked to one parent row (invoice,
 * job order, or proposal document) with `consultantIds`. Matches the
 * "every write replaces the whole set" pattern already used throughout this
 * codebase — callers don't diff, they just resend the desired final set.
 * Always call inside a transaction alongside the parent row's own
 * insert/update so a crash between the two can't leave stale links.
 */
export async function replaceConsultantIds(
  exec: ConsultantLinkExecutor,
  spec: ConsultantLinkSpec,
  parentId: string,
  consultantIds: string[],
): Promise<void> {
  await exec.delete(spec.table).where(eq(spec.parentIdColumn, parentId));
  const uniqueIds = [...new Set(consultantIds)].filter(Boolean);
  if (uniqueIds.length === 0) return;
  await exec.insert(spec.table).values(
    uniqueIds.map((consultantId) => ({
      [spec.parentIdKey]: parentId,
      [spec.consultantIdKey]: consultantId,
    })),
  );
}

/**
 * Loads the consultant ids linked to one parent row, ordered by the
 * consultant's shortCode for a deterministic, stable order (these join
 * tables are unordered sets — see the PDF-ordering note in job-orders.ts).
 */
export async function loadConsultantIds(
  exec: SelectExecutor,
  spec: ConsultantLinkSpec,
  parentId: string,
): Promise<string[]> {
  const rows = await exec
    .select({ consultantId: spec.consultantIdColumn, shortCode: consultantsTable.shortCode })
    .from(spec.table)
    .innerJoin(consultantsTable, eq(spec.consultantIdColumn, consultantsTable.id))
    .where(eq(spec.parentIdColumn, parentId))
    .orderBy(asc(consultantsTable.shortCode));
  return rows.map((r) => r.consultantId as string);
}

/** Batch form of {@link loadConsultantIds}, for list endpoints that would otherwise issue one query per row. */
export async function loadConsultantIdsByParent(
  exec: SelectExecutor,
  spec: ConsultantLinkSpec,
  parentIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const uniqueIds = [...new Set(parentIds)];
  if (uniqueIds.length === 0) return result;
  const rows = await exec
    .select({
      parentId: spec.parentIdColumn,
      consultantId: spec.consultantIdColumn,
      shortCode: consultantsTable.shortCode,
    })
    .from(spec.table)
    .innerJoin(consultantsTable, eq(spec.consultantIdColumn, consultantsTable.id))
    .where(inArray(spec.parentIdColumn, uniqueIds))
    .orderBy(asc(consultantsTable.shortCode));
  for (const row of rows) {
    const parentId = row.parentId as string;
    const consultantId = row.consultantId as string;
    const arr = result.get(parentId);
    if (arr) arr.push(consultantId);
    else result.set(parentId, [consultantId]);
  }
  return result;
}

/** Thrown by {@link assertConsultantIdsExist} when one or more ids don't resolve to a real consultant row. */
export class ConsultantIdsInvalidError extends Error {
  constructor() {
    super("CONSULTANT_IDS_INVALID");
  }
}

/**
 * Validates that every id in `ids` resolves to a real invoiceplane_consultants
 * row, throwing {@link ConsultantIdsInvalidError} otherwise. Promoted from
 * job-orders.ts's former `assertJobOrderConsultantIds` (same behavior, now
 * shared across invoices/job orders/proposals) — invoices and proposals
 * previously only zod-validated `.uuid()` shape and never checked existence.
 */
export async function assertConsultantIdsExist(ids: string[], exec: SelectExecutor = db): Promise<void> {
  if (ids.length === 0) return;
  const uniqueIds = [...new Set(ids)];
  const found = await exec
    .select({ id: consultantsTable.id })
    .from(consultantsTable)
    .where(inArray(consultantsTable.id, uniqueIds));
  if (found.length !== uniqueIds.length) {
    throw new ConsultantIdsInvalidError();
  }
}
