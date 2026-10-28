import PDFDocument from "pdfkit";
import type { LineItem as DbLineItem } from "@workspace/db";
import {
  invoiceLineDescriptionText,
  quotationLineDescriptionText,
  quotationLineDetailsText,
} from "./lineItemText";
import {
  type LineTableColumnKind,
  type PdfDocumentLayoutProfile,
  isColumnVisible,
  normalizeLineColumnOrder,
  DEFAULT_LINE_ORDER,
  DEFAULT_SIMPLE_LINE_ORDER,
} from "./pdfLayoutProfile";

type DrawDoc = InstanceType<typeof PDFDocument>;

/** PDFs never show an Item column; strip it from layout while preserving column math for qty/rate/tax/amount. */
function columnsWithoutItem(cols: LineTableColumnKind[]): LineTableColumnKind[] {
  return cols.filter((c) => c !== "item");
}

/** Invoice line table (supports simple Description+Amount + optional extra columns). */
export function renderInvoiceStyleLineTable(opts: {
  doc: DrawDoc;
  items: DbLineItem[];
  profile: PdfDocumentLayoutProfile | undefined;
  marginL: number;
  contentW: number;
  tableStartY: number;
  /** Shown in amount column headers, e.g. "Amount (HKD)". */
  currencyAmountLabel: string;
  formatMoney: (n: number) => string;
  BLACK: string;
  GRAY: string;
}): number {
  const { doc, marginL, contentW } = opts;
  const detailed = opts.profile?.tableMode === "detailed";
  const lc = opts.profile?.lineColumns;
  const visible = lc?.visible;

  if (!detailed) {
    const orderRaw = lc?.order?.length ? normalizeLineColumnOrder(lc.order) : DEFAULT_SIMPLE_LINE_ORDER;
    const colsAll = orderRaw.filter((c) => isColumnVisible(c, orderRaw, visible));
    const cols = columnsWithoutItem(colsAll);

    const onlySimple =
      cols.includes("amount") &&
      !cols.includes("quantity") &&
      !cols.includes("rate") &&
      !cols.includes("tax");

    if (onlySimple) {
      let tableY = opts.tableStartY;
      doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica-Bold").text("Description", marginL, tableY);
      doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica-Bold")
        .text(opts.currencyAmountLabel, marginL, tableY, { align: "right", width: contentW });
      const headerDescH = doc.heightOfString("Description", { width: contentW * 0.68 });
      const headerAmtH = doc.heightOfString(opts.currencyAmountLabel, { width: contentW * 0.28 });
      tableY += Math.max(headerDescH, headerAmtH, 12) + 4;
      doc.moveTo(marginL, tableY).lineTo(marginL + contentW, tableY).strokeColor(opts.BLACK).lineWidth(0.5).stroke();
      tableY += 10;

      for (const item of opts.items) {
        const itemTotal = (item.quantity ?? 0) * (item.price ?? 0);
        const description = invoiceLineDescriptionText(item);
        const descW = contentW * 0.68;
        const nameH = doc.heightOfString(description, { width: descW });
        doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica").text(description, marginL, tableY, { width: descW });
        doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica")
          .text(opts.formatMoney(itemTotal), marginL, tableY, { align: "right", width: contentW });
        tableY += Math.max(nameH, 14) + 6;
      }
      return tableY;
    }

    /** Extended simple grid (no Item column; Description + Details rows in first column) */
    const qtyW = 48;
    const rateW = 72;
    const taxW = 48;
    const amtW = 84;

    let right = marginL + contentW;
    const xa = right - amtW;
    right = xa - 10;
    const xt = cols.includes("tax") ? right - taxW : null;
    if (cols.includes("tax")) right -= taxW + 8;
    const xr = cols.includes("rate") ? right - rateW : null;
    if (cols.includes("rate")) right -= rateW + 8;
    const xq = cols.includes("quantity") ? right - qtyW : null;
    if (cols.includes("quantity")) right -= qtyW + 8;
    const xi = marginL;
    const wi = Math.max(90, right - marginL);

    let tableY = opts.tableStartY;

    doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica-Bold");
    doc.text("Description", xi, tableY, { width: wi });
    if (xq !== null) doc.text("Qty", xq, tableY, { width: qtyW, align: "right" });
    if (xr !== null) doc.text("Rate", xr, tableY, { width: rateW, align: "right" });
    if (xt !== null) doc.text("Tax", xt, tableY, { width: taxW, align: "right" });
    if (cols.includes("amount"))
      doc.text(opts.currencyAmountLabel, xa, tableY, { width: amtW, align: "right" });

    tableY += 14;
    doc.moveTo(marginL, tableY).lineTo(marginL + contentW, tableY).strokeColor(opts.BLACK).lineWidth(0.5).stroke();
    tableY += 12;

    for (const item of opts.items) {
      const qty = Number(item.quantity ?? 0);
      const unit = Number(item.price ?? 0);
      const gross = qty * unit;
      const tx = typeof item.taxRate === "number" ? item.taxRate : 0;
      const description = invoiceLineDescriptionText(item);

      const nh = Math.max(doc.heightOfString(description, { width: wi }), 12);
      doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica").text(description, xi, tableY, { width: wi });
      if (xq !== null) doc.text(String(qty), xq!, tableY, { width: qtyW, align: "right" });
      if (xr !== null)
        doc.text(opts.formatMoney(unit), xr!, tableY, {
          width: rateW,
          align: "right",
        });
      if (xt !== null)
        doc.fillColor(opts.GRAY).fontSize(9).font("Helvetica").text(tx > 0 ? `${tx}%` : "—", xt!, tableY + 1, {
          width: taxW,
          align: "right",
        });
      if (cols.includes("amount"))
        doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica").text(opts.formatMoney(gross), xa, tableY, {
          width: amtW,
          align: "right",
        });

      tableY += nh + 8;
    }
    return tableY;
  }

  // ── Detailed mode (no Item column; Description row then Details row) ─────
  const order = lc?.order?.length ? normalizeLineColumnOrder(lc.order) : DEFAULT_LINE_ORDER;
  const orderNoItem = columnsWithoutItem(order);

  const descWd = Math.floor(contentW * 0.42);
  const qtyW = 44;
  const rateW = 66;
  const taxW = 44;
  const amtW = 78;

  const xi = marginL;
  const xq = xi + descWd + 14;
  const xr = xq + qtyW + 6;
  const xt = xr + rateW + 8;
  const xa = marginL + contentW - amtW;

  let tableY = opts.tableStartY;

  doc.fillColor(opts.BLACK).fontSize(9).font("Helvetica-Bold");
  doc.text("Description", xi, tableY, { width: descWd });
  if (isColumnVisible("quantity", orderNoItem, visible)) doc.text("Qty", xq, tableY, { width: qtyW, align: "right" });
  if (isColumnVisible("rate", orderNoItem, visible))
    doc.text("Rate", xr, tableY, { width: rateW, align: "right" });
  if (isColumnVisible("tax", orderNoItem, visible))
    doc.text("Tax%", xt, tableY, { width: taxW, align: "right" });
  if (isColumnVisible("amount", orderNoItem, visible))
    doc.text(opts.currencyAmountLabel.replace(/^Amount\b/i, "Amt"), xa, tableY, { width: amtW, align: "right" });

  tableY += 12;
  doc.moveTo(marginL, tableY).lineTo(marginL + contentW, tableY).strokeColor(opts.BLACK).lineWidth(0.5).stroke();
  tableY += 10;

  for (const item of opts.items) {
    const qty = Number(item.quantity ?? 0);
    const unit = Number(item.price ?? 0);
    const gross = qty * unit;
    const tp = typeof item.taxRate === "number" ? item.taxRate : 0;
    const description = invoiceLineDescriptionText(item);

    const h = Math.max(11, doc.heightOfString(description, { width: descWd }));
    doc.fillColor(opts.BLACK).fontSize(9).font("Helvetica").text(description, xi, tableY, { width: descWd });

    doc.fillColor(opts.BLACK).fontSize(9).font("Helvetica");
    if (isColumnVisible("quantity", orderNoItem, visible))
      doc.text(String(qty), xq, tableY, { width: qtyW, align: "right" });
    if (isColumnVisible("rate", orderNoItem, visible))
      doc.text(opts.formatMoney(unit), xr, tableY, { width: rateW, align: "right" });
    if (isColumnVisible("tax", orderNoItem, visible))
      doc.fillColor(opts.GRAY).fontSize(8).font("Helvetica").text(tp > 0 ? `${tp}%` : "—", xt, tableY + 1, {
        width: taxW,
        align: "right",
      });
    if (isColumnVisible("amount", orderNoItem, visible))
      doc.fillColor(opts.BLACK).fontSize(9).font("Helvetica").text(opts.formatMoney(gross), xa, tableY, {
        width: amtW,
        align: "right",
      });

    tableY += Math.max(h, 13) + 6;
  }

  return tableY;
}

/** Quotation PDF: Description (with details stacked underneath) + Amounts (no Item / Qty / Rate / Tax). */
export function renderQuotationThreeColumnLineTable(opts: {
  doc: DrawDoc;
  items: DbLineItem[];
  marginL: number;
  contentW: number;
  tableStartY: number;
  /** ISO-style code for amounts column header (e.g. HKD → "Amounts (HKD)"). */
  currencyCode: string;
  formatMoney: (n: number) => string;
  BLACK: string;
  GRAY: string;
}): number {
  const { doc, marginL, contentW } = opts;
  const gap = 12;
  const amtW = 96;
  const descW = contentW - amtW - gap;
  const xDesc = marginL;
  const xAmt = marginL + contentW - amtW;

  let tableY = opts.tableStartY;
  doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica-Bold");
  doc.text("Description", xDesc, tableY, { width: descW });
  const amountsHdr = `Amounts (${opts.currencyCode})`;
  doc.text(amountsHdr, xAmt, tableY, { width: amtW, align: "right" });
  tableY +=
    Math.max(
      doc.heightOfString("Description", { width: descW }),
      doc.heightOfString(amountsHdr, { width: amtW }),
    ) + 4;
  doc.moveTo(marginL, tableY).lineTo(marginL + contentW, tableY).strokeColor(opts.BLACK).lineWidth(0.5).stroke();
  tableY += 10;

  for (const item of opts.items) {
    const itemTotal = (item.quantity ?? 0) * (item.price ?? 0);
    const description = quotationLineDescriptionText(item);
    const detailsText = quotationLineDetailsText(item);

    let rowY = tableY;
    const hPrimary = Math.max(doc.heightOfString(description, { width: descW }), 14);
    doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica").text(description, xDesc, rowY, { width: descW });
    rowY += hPrimary + 2;

    if (detailsText) {
      const hSecondary = Math.max(doc.heightOfString(detailsText, { width: descW }), 12);
      doc.fillColor(opts.GRAY).fontSize(9).font("Helvetica").text(detailsText, xDesc, rowY, { width: descW });
      rowY += hSecondary;
    }

    const descBlockH = rowY - tableY;
    const hAmt = Math.max(doc.heightOfString(opts.formatMoney(itemTotal), { width: amtW }), 14);
    const amountY = tableY;
    doc.fillColor(opts.BLACK).fontSize(10).font("Helvetica").text(opts.formatMoney(itemTotal), xAmt, amountY, {
      width: amtW,
      align: "right",
    });

    tableY += Math.max(descBlockH, hAmt) + 6;
  }

  return tableY;
}
