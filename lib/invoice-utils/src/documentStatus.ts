import { isInvoiceFullyPaid } from "./lineItemTotals";

/** Invoice workflow statuses matching the OpenAPI InvoiceStatus enum. */
export const INVOICE_WORKFLOW_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "revised",
  "paid",
] as const;

export type InvoiceWorkflowStatus = (typeof INVOICE_WORKFLOW_STATUSES)[number];

/** Quotation workflow statuses matching the OpenAPI QuotationStatus enum. */
export const QUOTATION_WORKFLOW_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "skip",
  "canceled",
  "confirmed",
  "invoiced",
] as const;

export type QuotationWorkflowStatus = (typeof QUOTATION_WORKFLOW_STATUSES)[number];

/**
 * Allowed staff-driven invoice transitions. Same-status updates are always allowed.
 * `paid` is reachable from sent/revised only when payments already cover the total
 * (enforced by the status API). Staff may send a paid invoice back to `draft`
 * (including after soft-delete restore). Payment create/delete may still
 * promote/demote `paid` outside this table.
 */
export const INVOICE_TRANSITIONS: Record<InvoiceWorkflowStatus, readonly InvoiceWorkflowStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "draft"],
  approved: ["sent"],
  sent: ["revised", "paid"],
  revised: ["sent", "paid"],
  paid: ["draft"],
};

/**
 * Allowed staff-driven quotation transitions. Same-status updates are always allowed.
 * `invoiced` is only set by convert, not by PATCH/bulk-status.
 */
export const QUOTATION_TRANSITIONS: Record<
  QuotationWorkflowStatus,
  readonly QuotationWorkflowStatus[]
> = {
  draft: ["pending_approval", "canceled", "skip"],
  pending_approval: ["approved", "canceled", "draft", "skip"],
  approved: ["sent", "skip", "canceled"],
  sent: ["confirmed", "canceled", "skip"],
  skip: ["confirmed", "canceled", "sent"],
  confirmed: ["canceled"],
  invoiced: [],
  canceled: [],
};

const INVOICE_STATUS_SET = new Set<string>(INVOICE_WORKFLOW_STATUSES);
const QUOTATION_STATUS_SET = new Set<string>(QUOTATION_WORKFLOW_STATUSES);

export function isInvoiceWorkflowStatus(status: string): status is InvoiceWorkflowStatus {
  return INVOICE_STATUS_SET.has(status);
}

export function isQuotationWorkflowStatus(status: string): status is QuotationWorkflowStatus {
  return QUOTATION_STATUS_SET.has(status);
}

export function canTransitionInvoice(from: string, to: string): boolean {
  if (from === to) return true;
  if (!isInvoiceWorkflowStatus(from) || !isInvoiceWorkflowStatus(to)) return false;
  return INVOICE_TRANSITIONS[from].includes(to);
}

export function canTransitionQuotation(from: string, to: string): boolean {
  if (from === to) return true;
  if (!isQuotationWorkflowStatus(from) || !isQuotationWorkflowStatus(to)) return false;
  return QUOTATION_TRANSITIONS[from].includes(to);
}

function prettyStatus(status: string): string {
  return status.replace(/_/g, " ");
}

export function invoiceTransitionError(from: string, to: string): string | null {
  if (canTransitionInvoice(from, to)) return null;
  return `Cannot change invoice status from ${prettyStatus(from)} to ${prettyStatus(to)}.`;
}

export function quotationTransitionError(from: string, to: string): string | null {
  if (to === "invoiced") {
    return "Mark a quotation invoiced by converting it to an invoice.";
  }
  if (canTransitionQuotation(from, to)) return null;
  return `Cannot change quotation status from ${prettyStatus(from)} to ${prettyStatus(to)}.`;
}

/** Current status plus allowed next statuses, for document form pills. */
export function formInvoiceStatuses(current: string): InvoiceWorkflowStatus[] {
  const from = isInvoiceWorkflowStatus(current) ? current : "draft";
  const next = INVOICE_TRANSITIONS[from].filter((s) => s !== "paid");
  return [from, ...next.filter((s) => s !== from)];
}

export function formQuotationStatuses(current: string): QuotationWorkflowStatus[] {
  const from = isQuotationWorkflowStatus(current) ? current : "draft";
  const next = QUOTATION_TRANSITIONS[from].filter((s) => s !== "invoiced");
  return [from, ...next.filter((s) => s !== from)];
}

export function canConvertQuotation(status: string): boolean {
  return status === "confirmed";
}

export const CONVERT_QUOTATION_ERROR =
  "Only confirmed quotations can be converted to invoices. Confirm the quotation first.";

const QUOTATION_BULK_TARGETS: QuotationWorkflowStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "skip",
  "canceled",
  "confirmed",
];

const INVOICE_BULK_TARGETS: InvoiceWorkflowStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "revised",
  "paid",
];

/** Statuses every selected quotation can move to (excludes invoiced). */
export function bulkQuotationStatusTargets(currentStatuses: readonly string[]): QuotationWorkflowStatus[] {
  if (currentStatuses.length === 0) return [];
  return QUOTATION_BULK_TARGETS.filter((target) =>
    currentStatuses.every((from) => canTransitionQuotation(from, target)),
  );
}

/** Statuses every selected invoice can move to; paid requires full payment on each row. */
export function bulkInvoiceStatusTargets(
  rows: readonly { status: string; paidAmount: number; total: number }[],
): InvoiceWorkflowStatus[] {
  if (rows.length === 0) return [];
  return INVOICE_BULK_TARGETS.filter((target) =>
    rows.every((row) => {
      if (target === "paid" && !isInvoiceFullyPaid(row.paidAmount, row.total)) return false;
      return canTransitionInvoice(row.status, target);
    }),
  );
}
