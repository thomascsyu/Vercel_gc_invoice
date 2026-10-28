import { clientsTable, invoicesTable, quotationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { DataMode } from "./dataMode";

/** Scoped client join for invoice list/detail queries (authenticated user). */
export function joinInvoiceClient(userId: string, dataMode: DataMode) {
  return and(
    eq(invoicesTable.clientId, clientsTable.id),
    eq(clientsTable.userId, userId),
    eq(clientsTable.dataMode, dataMode),
    eq(invoicesTable.dataMode, dataMode),
  );
}

/** Scoped client join when the invoice row already carries `userId` / `dataMode`. */
export function joinInvoiceClientForOwner(dataMode: DataMode) {
  return and(
    eq(invoicesTable.clientId, clientsTable.id),
    eq(clientsTable.userId, invoicesTable.userId),
    eq(clientsTable.dataMode, dataMode),
    eq(invoicesTable.dataMode, dataMode),
  );
}

/**
 * Cross-mode FK safety without a known caller mode (e.g. public share-link
 * routes, which serve either "live" or "test" invoices depending on what
 * was shared): requires the joined client to be in the same sandbox as the
 * invoice, whichever that is.
 */
export function joinInvoiceClientSameMode() {
  return and(
    eq(invoicesTable.clientId, clientsTable.id),
    eq(clientsTable.userId, invoicesTable.userId),
    eq(clientsTable.dataMode, invoicesTable.dataMode),
  );
}

/** Scoped client join for quotation list/detail queries (authenticated user). */
export function joinQuotationClient(userId: string, dataMode: DataMode) {
  return and(
    eq(quotationsTable.clientId, clientsTable.id),
    eq(clientsTable.userId, userId),
    eq(clientsTable.dataMode, dataMode),
    eq(quotationsTable.dataMode, dataMode),
  );
}

/** Scoped client join when the quotation row already carries `userId` / `dataMode`. */
export function joinQuotationClientForOwner(dataMode: DataMode) {
  return and(
    eq(quotationsTable.clientId, clientsTable.id),
    eq(clientsTable.userId, quotationsTable.userId),
    eq(clientsTable.dataMode, dataMode),
    eq(quotationsTable.dataMode, dataMode),
  );
}

/** Same-mode counterpart of {@link joinInvoiceClientSameMode} for quotations. */
export function joinQuotationClientSameMode() {
  return and(
    eq(quotationsTable.clientId, clientsTable.id),
    eq(clientsTable.userId, quotationsTable.userId),
    eq(clientsTable.dataMode, quotationsTable.dataMode),
  );
}
