import { businessCalendarToday } from "./businessCalendar";

/** Statuses that can appear overdue once past due and still unpaid. */
export const OVERDUE_INVOICE_STATUSES = ["approved", "sent", "revised"] as const;

export type OverdueInvoiceStatus = (typeof OVERDUE_INVOICE_STATUSES)[number];

export function isOverdueEligibleStatus(status: string): status is OverdueInvoiceStatus {
  return (OVERDUE_INVOICE_STATUSES as readonly string[]).includes(status);
}

export function isInvoiceOverdue(
  invoice: {
    status: string;
    dueDate?: string | null;
    invoiceDate: string;
    paidAmount?: number;
    total: number;
  },
  today = businessCalendarToday(),
): boolean {
  if (!isOverdueEligibleStatus(invoice.status)) return false;
  if ((invoice.paidAmount ?? 0) + 0.005 >= invoice.total) return false;
  const due = invoice.dueDate || invoice.invoiceDate;
  if (!due) return false;
  return due < today;
}
