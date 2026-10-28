/** Staff-only internal note comparison — kept free of @workspace/db runtime imports so unit tests can run without DATABASE_URL. */

import {
  normalizeInvoiceLineItemForCompare,
  type InvoiceLineItemLike,
} from "@workspace/invoice-utils";

export type InternalNoteLineItem = InvoiceLineItemLike;

function emptyText(value: string | null | undefined): string {
  return value ?? "";
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function lineItemsMatchForRevision(
  existing: InternalNoteLineItem[],
  incoming: InternalNoteLineItem[],
): boolean {
  if (existing.length !== incoming.length) return false;
  return existing.every((item, i) => {
    const a = normalizeInvoiceLineItemForCompare(item);
    const b = normalizeInvoiceLineItemForCompare(incoming[i]!);
    return (
      a.name === b.name &&
      a.description === b.description &&
      a.details === b.details &&
      a.quantity === b.quantity &&
      a.price === b.price &&
      a.taxRate === b.taxRate
    );
  });
}

export type InvoiceRevisionCompareExisting = {
  clientId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  status: string;
  currency: string;
  discountAmount: string | number;
  serviceCategory: string | null;
  cancellationReason: string | null;
  notes: string | null;
  internalNote: string | null;
  termsConditions: string | null;
  remark: string | null;
};

export type InvoiceRevisionCompareBody = {
  clientId: string;
  invoiceNumber?: string;
  invoiceDate: string;
  dueDate?: string | null;
  status?: string;
  currency: string;
  discountAmount?: number;
  items: InternalNoteLineItem[];
  consultantIds?: string[];
  serviceCategory?: string;
  cancellationReason?: string;
  notes?: string;
  internalNote?: string;
  termsConditions?: string;
  remark?: string;
};

function customerFacingFieldsMatch(
  existing: InvoiceRevisionCompareExisting,
  existingItems: InternalNoteLineItem[],
  existingConsultantIds: string[],
  body: InvoiceRevisionCompareBody,
  incomingConsultantIds?: string[],
): boolean {
  const incomingStatus = body.status ?? existing.status;
  if (incomingStatus !== existing.status) return false;
  if (body.clientId !== existing.clientId) return false;
  if (body.invoiceDate !== existing.invoiceDate) return false;
  if (emptyText(body.dueDate) !== emptyText(existing.dueDate)) return false;
  if (body.currency !== existing.currency) return false;
  if ((body.discountAmount ?? 0) !== toNumber(existing.discountAmount)) return false;
  const incomingNumber = body.invoiceNumber?.trim();
  if (incomingNumber && incomingNumber !== existing.invoiceNumber) return false;
  if ((body.serviceCategory ?? existing.serviceCategory ?? "others") !== (existing.serviceCategory ?? "others")) {
    return false;
  }
  if (body.cancellationReason !== undefined && emptyText(body.cancellationReason) !== emptyText(existing.cancellationReason)) {
    return false;
  }
  if (body.notes !== undefined && emptyText(body.notes) !== emptyText(existing.notes)) return false;
  if (body.termsConditions !== undefined && emptyText(body.termsConditions) !== emptyText(existing.termsConditions)) {
    return false;
  }
  if (body.remark !== undefined && emptyText(body.remark) !== emptyText(existing.remark)) return false;
  if (!lineItemsMatchForRevision(existingItems, body.items)) return false;
  const incomingConsultants = incomingConsultantIds ?? existingConsultantIds;
  const existingSorted = [...existingConsultantIds].sort();
  const incomingSorted = [...incomingConsultants].sort();
  if (existingSorted.length !== incomingSorted.length) return false;
  if (existingSorted.some((id, i) => id !== incomingSorted[i])) return false;
  return true;
}

/** True when the PATCH body matches the stored invoice exactly (including internal note). */
export function isNoOpInvoicePatch(
  existing: InvoiceRevisionCompareExisting,
  existingItems: InternalNoteLineItem[],
  existingConsultantIds: string[],
  body: InvoiceRevisionCompareBody,
  incomingConsultantIds?: string[],
): boolean {
  if (!customerFacingFieldsMatch(existing, existingItems, existingConsultantIds, body, incomingConsultantIds)) {
    return false;
  }
  if (body.internalNote !== undefined && emptyText(body.internalNote) !== emptyText(existing.internalNote)) {
    return false;
  }
  return true;
}

/**
 * True when the PATCH would change only `internalNote`.
 * Status / number / customer-facing fields must match the stored invoice.
 */
export function isInternalNoteOnlyInvoicePatch(
  existing: InvoiceRevisionCompareExisting,
  existingItems: InternalNoteLineItem[],
  existingConsultantIds: string[],
  body: InvoiceRevisionCompareBody,
  incomingConsultantIds?: string[],
): boolean {
  if (body.internalNote === undefined) return false;
  if (emptyText(body.internalNote) === emptyText(existing.internalNote)) return false;
  if (!customerFacingFieldsMatch(existing, existingItems, existingConsultantIds, body, incomingConsultantIds)) {
    return false;
  }
  return true;
}
