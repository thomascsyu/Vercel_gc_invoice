import {
  db,
  invoiceItemsTable,
  jobOrderItemsTable,
  quotationItemsTable,
  quotationTemplateItemsTable,
  recurringInvoiceItemsTable,
  type LineItem,
} from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";
import type { AnyPgTable, PgColumn } from "drizzle-orm/pg-core";

/** Minimal executor shape needed to read/write line items: either `db` or a `tx` from `db.transaction(...)`. */
export type LineItemExecutor = Pick<typeof db, "select" | "delete" | "insert">;
type SelectExecutor = Pick<typeof db, "select">;

/**
 * Identifies one of the five line-item child tables added by migration 0037
 * (invoice/quotation/job-order/recurring-invoice/quotation-template <-> line
 * items), so the load/replace helpers below are written once and reused for
 * all five parents instead of five near-identical copies. Mirrors the
 * consultantLinks.ts Spec pattern from migration 0036.
 */
export type LineItemSpec = {
  table: AnyPgTable;
  parentIdColumn: PgColumn;
  positionColumn: PgColumn;
  nameColumn: PgColumn;
  descriptionColumn: PgColumn;
  detailsColumn: PgColumn;
  quantityColumn: PgColumn;
  priceColumn: PgColumn;
  taxRateColumn: PgColumn;
  /** Insert-row property key for the parent id (matches the Drizzle column's JS property name). */
  parentIdKey: string;
};

export const INVOICE_ITEMS: LineItemSpec = {
  table: invoiceItemsTable,
  parentIdColumn: invoiceItemsTable.invoiceId,
  positionColumn: invoiceItemsTable.position,
  nameColumn: invoiceItemsTable.name,
  descriptionColumn: invoiceItemsTable.description,
  detailsColumn: invoiceItemsTable.details,
  quantityColumn: invoiceItemsTable.quantity,
  priceColumn: invoiceItemsTable.price,
  taxRateColumn: invoiceItemsTable.taxRate,
  parentIdKey: "invoiceId",
};

export const QUOTATION_ITEMS: LineItemSpec = {
  table: quotationItemsTable,
  parentIdColumn: quotationItemsTable.quotationId,
  positionColumn: quotationItemsTable.position,
  nameColumn: quotationItemsTable.name,
  descriptionColumn: quotationItemsTable.description,
  detailsColumn: quotationItemsTable.details,
  quantityColumn: quotationItemsTable.quantity,
  priceColumn: quotationItemsTable.price,
  taxRateColumn: quotationItemsTable.taxRate,
  parentIdKey: "quotationId",
};

export const JOB_ORDER_ITEMS: LineItemSpec = {
  table: jobOrderItemsTable,
  parentIdColumn: jobOrderItemsTable.jobOrderId,
  positionColumn: jobOrderItemsTable.position,
  nameColumn: jobOrderItemsTable.name,
  descriptionColumn: jobOrderItemsTable.description,
  detailsColumn: jobOrderItemsTable.details,
  quantityColumn: jobOrderItemsTable.quantity,
  priceColumn: jobOrderItemsTable.price,
  taxRateColumn: jobOrderItemsTable.taxRate,
  parentIdKey: "jobOrderId",
};

export const RECURRING_INVOICE_ITEMS: LineItemSpec = {
  table: recurringInvoiceItemsTable,
  parentIdColumn: recurringInvoiceItemsTable.recurringInvoiceId,
  positionColumn: recurringInvoiceItemsTable.position,
  nameColumn: recurringInvoiceItemsTable.name,
  descriptionColumn: recurringInvoiceItemsTable.description,
  detailsColumn: recurringInvoiceItemsTable.details,
  quantityColumn: recurringInvoiceItemsTable.quantity,
  priceColumn: recurringInvoiceItemsTable.price,
  taxRateColumn: recurringInvoiceItemsTable.taxRate,
  parentIdKey: "recurringInvoiceId",
};

export const QUOTATION_TEMPLATE_ITEMS: LineItemSpec = {
  table: quotationTemplateItemsTable,
  parentIdColumn: quotationTemplateItemsTable.quotationTemplateId,
  positionColumn: quotationTemplateItemsTable.position,
  nameColumn: quotationTemplateItemsTable.name,
  descriptionColumn: quotationTemplateItemsTable.description,
  detailsColumn: quotationTemplateItemsTable.details,
  quantityColumn: quotationTemplateItemsTable.quantity,
  priceColumn: quotationTemplateItemsTable.price,
  taxRateColumn: quotationTemplateItemsTable.taxRate,
  parentIdKey: "quotationTemplateId",
};

/**
 * Replaces the full set of line items for one parent row (invoice, quotation,
 * job order, recurring invoice, or quotation template) with `items`. Matches
 * the "every write replaces the whole set" pattern already used throughout
 * this codebase (see consultantLinks.ts) — every existing create/update/
 * duplicate/CSV-import/convert endpoint sends a complete new array, so
 * callers here don't diff either, they just resend the desired final list.
 * `position` is assigned from array index, preserving the order the old
 * jsonb array encoded implicitly (load-bearing for PDF rendering).
 * Always call inside a transaction alongside the parent row's own
 * insert/update so a crash between the two can't leave stale/missing items.
 */
export async function replaceLineItems(
  exec: LineItemExecutor,
  spec: LineItemSpec,
  parentId: string,
  items: LineItem[],
): Promise<void> {
  await exec.delete(spec.table).where(eq(spec.parentIdColumn, parentId));
  if (items.length === 0) return;
  await exec.insert(spec.table).values(
    items.map((item, index) => ({
      [spec.parentIdKey]: parentId,
      position: index,
      name: item.name ?? "",
      description: item.description?.trim() ? item.description : null,
      details: item.details?.trim() ? item.details : null,
      quantity: Number(item.quantity) || 0,
      price: Number(item.price) || 0,
      taxRate: item.taxRate === undefined ? null : Number(item.taxRate) || 0,
    })),
  );
}

/** Loads the line items for one parent row, in position order. */
export async function loadLineItems(
  exec: SelectExecutor,
  spec: LineItemSpec,
  parentId: string,
): Promise<LineItem[]> {
  const rows = await exec
    .select({
      name: spec.nameColumn,
      description: spec.descriptionColumn,
      details: spec.detailsColumn,
      quantity: spec.quantityColumn,
      price: spec.priceColumn,
      taxRate: spec.taxRateColumn,
    })
    .from(spec.table)
    .where(eq(spec.parentIdColumn, parentId))
    .orderBy(asc(spec.positionColumn));
  return rows.map(rowToLineItem);
}

/** Batch form of {@link loadLineItems}, for list/export endpoints that would otherwise issue one query per row. */
export async function loadLineItemsByParent(
  exec: SelectExecutor,
  spec: LineItemSpec,
  parentIds: string[],
): Promise<Map<string, LineItem[]>> {
  const result = new Map<string, LineItem[]>();
  const uniqueIds = [...new Set(parentIds)];
  if (uniqueIds.length === 0) return result;
  const rows = await exec
    .select({
      parentId: spec.parentIdColumn,
      name: spec.nameColumn,
      description: spec.descriptionColumn,
      details: spec.detailsColumn,
      quantity: spec.quantityColumn,
      price: spec.priceColumn,
      taxRate: spec.taxRateColumn,
    })
    .from(spec.table)
    .where(inArray(spec.parentIdColumn, uniqueIds))
    .orderBy(asc(spec.positionColumn));
  for (const row of rows) {
    const parentId = row.parentId as string;
    const item = rowToLineItem(row);
    const arr = result.get(parentId);
    if (arr) arr.push(item);
    else result.set(parentId, [item]);
  }
  return result;
}

/**
 * Reconstructs an in-memory LineItem from a loaded row. `description` /
 * `details` / `taxRate` come back as `undefined`, not `null`, to match the
 * original jsonb-array shape exactly (optional fields were simply absent,
 * never present-and-null).
 */
function rowToLineItem(row: {
  name: unknown;
  description: unknown;
  details: unknown;
  quantity: unknown;
  price: unknown;
  taxRate: unknown;
}): LineItem {
  return {
    name: (row.name as string) ?? "",
    description: (row.description as string | null) ?? undefined,
    details: (row.details as string | null) ?? undefined,
    quantity: row.quantity as number,
    price: row.price as number,
    taxRate: (row.taxRate as number | null) ?? undefined,
  };
}
