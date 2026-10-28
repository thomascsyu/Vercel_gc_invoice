import type PDFDocument from "pdfkit";

/** Target character count for bill-to names and address rows. */
export const PDF_BILL_TO_CHARS_PER_ROW = 40;

/** Probe string for measuring minimum PDF width (digits ≈ average glyph width at 10pt Helvetica). */
const WIDTH_PROBE_40 = "0123456789012345678901234567890123456789";

/** Minimum right-column width (pt) when invoice bill-to shares a row with issuer details. */
const INVOICE_BILLING_RIGHT_COL_MIN_PT = 150;

/**
 * Baseline width (pt) for 40 digits at 10pt Helvetica; actual fields are measured separately.
 */
export function pdfBillToMinValueWidthPt(doc: InstanceType<typeof PDFDocument>, fontSize = 10): number {
  doc.fontSize(fontSize).font("Helvetica");
  return doc.widthOfString(WIDTH_PROBE_40);
}

export type InvoiceBillingColumns = {
  leftBillingValueWidth: number;
  billingSplitX: number;
  rightBlockX: number;
  rightBlockW: number;
};

/**
 * Invoice PDF: left bill-to values need room for 40 characters per row; issuer block stays in the right column.
 */
export function invoiceBillingColumns(
  doc: InstanceType<typeof PDFDocument>,
  opts: {
    marginL: number;
    contentW: number;
    addrValueX: number;
    billingBlockOffsetX?: number;
    billingColumnGapPt?: number;
    billToValues?: readonly string[];
  },
): InvoiceBillingColumns {
  const billingColumnGapPt = opts.billingColumnGapPt ?? 24;
  const blockRightX = opts.marginL + opts.contentW + (opts.billingBlockOffsetX ?? 0);
  const minValueW = Math.ceil(Math.max(
    pdfBillToMinValueWidthPt(doc),
    ...(opts.billToValues ?? []).map((value) =>
      doc.widthOfString(value.trim().slice(0, PDF_BILL_TO_CHARS_PER_ROW)) + 1,
    ),
  ));
  const minSplitX = opts.addrValueX + minValueW + billingColumnGapPt / 2;
  const defaultSplitX = opts.marginL + (opts.billingBlockOffsetX ?? 0) + opts.contentW / 2;
  const maxSplitX = blockRightX - INVOICE_BILLING_RIGHT_COL_MIN_PT - billingColumnGapPt / 2;
  const billingSplitX = Math.min(Math.max(minSplitX, defaultSplitX), maxSplitX);
  const leftValueRightX = billingSplitX - billingColumnGapPt / 2;
  const leftBillingValueWidth = Math.max(80, leftValueRightX - opts.addrValueX);
  const rightBlockX = billingSplitX + billingColumnGapPt / 2;
  const rightBlockW = Math.max(80, blockRightX - rightBlockX);
  return { leftBillingValueWidth, billingSplitX, rightBlockX, rightBlockW };
}

/** Keep the first 40 characters readable on one row when the issuer limits available width. */
export function billToFontSize(doc: InstanceType<typeof PDFDocument>, value: string, width: number): number {
  doc.font("Helvetica").fontSize(10);
  // PDFKit wraps individual words; leave a small allowance for word-boundary rounding.
  const measuredWidth = doc.widthOfString(value.slice(0, PDF_BILL_TO_CHARS_PER_ROW)) + 1;
  return measuredWidth > width ? 10 * width / (measuredWidth + 0.01) : 10;
}
