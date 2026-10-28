import PDFDocument from "pdfkit";
import {
  companySettingsTable,
  invoicesTable,
  clientsTable,
  type LineItem,
} from "@workspace/db";
import type { Response } from "express";
import { headerBannerLayoutWidthPt, layoutBrandingEffectiveContentOffset } from "@workspace/invoice-utils";
import { logoScaleFactor } from "./logoScale";
import { pdfBrandingBand, titleBlockBaseY } from "./pdfBrandingBand";
import { imageBufferAspectRatio } from "./imageBufferAspectRatio";
import { getLayoutsFromSettings, sectionOffsetX, sectionOffsetY, sectionShows } from "./pdfLayoutProfile";
import { renderInvoiceStyleLineTable } from "./pdfInvoiceLines";
import { billToFontSize, invoiceBillingColumns } from "./pdfBillToLayout";
import { padMinFieldLength, PDF_MIN_ADDRESS_BANK_FIELD_CHARS } from "./pdfTextMinField";
import { PDF_MAX_BANK_FIELD_CHARS, PDF_MAX_BILL_TO_FIELD_CHARS, truncatePdfFieldText } from "./pdfTextTruncate";
import { fetchImageBuffer } from "./fetchImageBuffer";
import { companyChopScaleColumns, companyChopStoredUrl } from "./companyChop";
import { clientStructuredAddressFourLines } from "./pdfClientAddress";
import { PDF_FOOTER_LINE_TO_TEXT_GAP_PT, pdfFooterLineAndTextY } from "./pdfFooterPosition";
import { setPdfDownloadHeaders } from "./pdfResponseHeaders";
import "./pdfTraditionalChinese";

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

/** Shared invoice PDF rendering (saved layouts from company_settings.pdf_document_layouts). */
export async function drawInvoicePdfDoc(
  doc: InstanceType<typeof PDFDocument>,
  invoice: typeof invoicesTable.$inferSelect & { items: LineItem[] },
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
): Promise<void> {
  const items = invoice.items ?? [];
  const total = toNumber(invoice.total);
  const paidAmount = toNumber(invoice.paidAmount);
  const currency = invoice.currency;

  const currencyAmountLabel = `Amount (${currency})`;

  const formatMoney = (n: number) =>
    `$  ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

  const formatDate = (dateStr: string): string => {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [y, m, d] = dateStr.split("-").map(Number);
    return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
  };

  const invoiceDateDisplay = formatDate(invoice.invoiceDate);

  const chopUrl = companyChopStoredUrl(settings);
  const [headerLogoBuffer, logoBuffer, stampBuffer] = await Promise.all([
    settings?.headerLogoUrl ? fetchImageBuffer(settings.headerLogoUrl) : Promise.resolve(null),
    settings?.logoUrl ? fetchImageBuffer(settings.logoUrl) : Promise.resolve(null),
    chopUrl ? fetchImageBuffer(chopUrl) : Promise.resolve(null),
  ]);
  const headerBannerAspect = await imageBufferAspectRatio(headerLogoBuffer);

  const layMaps = getLayoutsFromSettings(
    settings?.pdfDocumentLayouts,
    settings ? { ...settings, headerBannerAspectRatio: headerBannerAspect } : undefined,
  );
  const invLay = layMaps.invoice;

  const marginL = 50;
  const marginR = 50;
  const pageW = doc.page.width;
  const contentW = pageW - marginL - marginR;
  const rightCol = pageW / 2;
  const BLACK = "#000000";
  const GRAY = "#555555";

  const companyName = settings?.companyName || "Gabriel Consultant Limited";
  const companyAddressLines = [
    settings?.addressLine1,
    settings?.addressLine2,
    settings?.addressLine3,
    settings?.addressLine4,
  ].filter(Boolean) as string[];
  if (!companyAddressLines.length && settings?.address) {
    companyAddressLines.push(...settings.address.split("\n").filter(Boolean));
  }
  if (!companyAddressLines.length) {
    companyAddressLines.push("Suite E, 11/F.,", "Boton Technology Innovation Tower,", "368 Kwun Tong Road, Kowloon, Hong Kong.");
  }
  const companyPhone = settings?.phone || "2366 4622";
  const companyEmail = settings?.email || "info@gabriel.hk";

  const offLogoY = sectionOffsetY("showLogoRow", invLay);
  const offLogoX = sectionOffsetX("showLogoRow", invLay);
  const offHeaderBannerY = sectionOffsetY("showHeaderBannerLogo", invLay);
  const offHeaderBannerX = sectionOffsetX("showHeaderBannerLogo", invLay);
  const offTitleY = sectionOffsetY("showTitleBlock", invLay);
  const offTitleX = sectionOffsetX("showTitleBlock", invLay);
  const offBillingBlockY = sectionOffsetY("showBillingBlock", invLay);
  const offBillingBlockX = sectionOffsetX("showBillingBlock", invLay);
  const offLineItemsY = sectionOffsetY("lineItems", invLay);
  const offLineItemsX = sectionOffsetX("lineItems", invLay);
  const offTotalsY = sectionOffsetY("showTotals", invLay);
  const offTotalsX = sectionOffsetX("showTotals", invLay);
  const offBankY = sectionOffsetY("showBankAccounts", invLay);
  const offBankX = sectionOffsetX("showBankAccounts", invLay);
  const offSigY = sectionOffsetY("showSignatures", invLay);
  const offSigX = sectionOffsetX("showSignatures", invLay);
  const offFooterLineY = sectionOffsetY("showFooterAddress", invLay);
  const offFooterLineX = sectionOffsetX("showFooterAddress", invLay);
  const offPayAdviceY = sectionOffsetY("showPaymentAdvicePage", invLay);
  const offPayAdviceX = sectionOffsetX("showPaymentAdvicePage", invLay);

  const band = pdfBrandingBand({
    showLogoRow: sectionShows("showLogoRow", invLay),
    showHeaderBanner: sectionShows("showHeaderBannerLogo", invLay),
    hasCompanyLogo: Boolean(logoBuffer),
    hasHeaderLogo: Boolean(headerLogoBuffer),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    headerLogoWidthScale: settings?.headerLogoWidthScale,
  });
  if (sectionShows("showLogoRow", invLay) && logoBuffer) {
    doc.image(logoBuffer, marginL + offLogoX, 10 + offLogoY, {
      fit: [band.companyMaxW, band.companyMaxH],
    });
  }
  const LOGO_OFFSET = layoutBrandingEffectiveContentOffset({
    showLogoRow: sectionShows("showLogoRow", invLay),
    showHeaderBannerLogo: sectionShows("showHeaderBannerLogo", invLay),
    hasCompanyLogo: Boolean(logoBuffer),
    hasHeaderLogo: Boolean(headerLogoBuffer),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    offLogoY,
    offHeaderBannerY,
  });
  if (sectionShows("showHeaderBannerLogo", invLay) && headerLogoBuffer) {
    const headerW = headerBannerLayoutWidthPt({
      headerLogoWidthScale: settings?.headerLogoWidthScale,
      headerLogoScale: settings?.headerLogoScale,
      headerBannerAspectRatio: headerBannerAspect,
    });
    doc.image(headerLogoBuffer, marginL + offHeaderBannerX, 10 + band.logoRowInset + offHeaderBannerY, {
      width: headerW,
      height: band.headerH,
      fit: [headerW, band.headerH],
      valign: "center",
    });
  }

  const titleY = titleBlockBaseY(LOGO_OFFSET) + offTitleY;
  if (sectionShows("showTitleBlock", invLay)) {
    doc.fillColor(BLACK).fontSize(28).font("Helvetica-Bold").text("INVOICE", marginL + offTitleX, titleY);

    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold")
      .text(`Invoice No.  ${invoice.invoiceNumber}`, marginL + offTitleX, titleY + 5, { align: "right", width: contentW });
    doc.fillColor(BLACK).fontSize(10).font("Helvetica")
      .text(`Invoice Date:  ${invoiceDateDisplay}`, marginL + offTitleX, titleY + 20, { align: "right", width: contentW });
  }

  const addrTop = 110 + LOGO_OFFSET + offBillingBlockY;
  let leftY = addrTop;
  let rightY = addrTop;

  if (sectionShows("showBillingBlock", invLay)) {
    const addrLabelX = marginL + offBillingBlockX;
    const addrValueX = marginL + 70 + offBillingBlockX;
    const clientAddrSlots = clientStructuredAddressFourLines(client);
    /** Two columns: Bill To (left) and issuer (right) start at the same Y. */
    const { leftBillingValueWidth, rightBlockX, rightBlockW } = invoiceBillingColumns(doc, {
      marginL,
      contentW,
      addrValueX,
      billingBlockOffsetX: offBillingBlockX,
      billToValues: [client?.name ?? "—", ...clientAddrSlots, client?.contactPerson ?? ""],
    });

    const printLabeledLine = (
      label: string,
      value: string,
      y: number,
      truncateAt = PDF_MAX_BILL_TO_FIELD_CHARS,
    ): number => {
      const v = truncatePdfFieldText(value, truncateAt);
      const displayValue = v || " ";
      doc.fillColor(BLACK).fontSize(10).font("Helvetica").text(`${label}`, addrLabelX, y, { width: 65 });
      const valueFontSize = billToFontSize(doc, displayValue, leftBillingValueWidth);
      doc.fillColor(BLACK).fontSize(valueFontSize).font("Helvetica").text(displayValue, addrValueX, y, {
        width: leftBillingValueWidth,
        lineBreak: false,
      });
      const valueHeight = doc.heightOfString(displayValue, { width: leftBillingValueWidth, lineBreak: false });
      return y + Math.max(valueHeight, 12) + 2;
    };

    leftY = printLabeledLine("Bill To :", client?.name ?? "—", leftY);

    const hasAnyAddressSlot = clientAddrSlots.some((s) => s.length > 0);
    if (hasAnyAddressSlot) {
      for (let i = 0; i < clientAddrSlots.length; i++) {
        leftY = printLabeledLine(i === 0 ? "Address :" : "", clientAddrSlots[i], leftY);
      }
    }

    if (client?.contactPerson) {
      leftY = printLabeledLine("Attn :", client.contactPerson, leftY);
    }

    rightY = addrTop;
    const printIssuerLine = (value: string, bold = false): void => {
      doc.fillColor(BLACK).fontSize(10).font(bold ? "Helvetica-Bold" : "Helvetica");
      const options = { width: rightBlockW, align: "right" as const };
      const height = doc.heightOfString(value, options);
      doc.text(value, rightBlockX, rightY, options);
      rightY += Math.max(height, bold ? 14 : 12) + 2;
    };
    printIssuerLine(companyName, true);
    for (const line of companyAddressLines) printIssuerLine(line);
    if (companyPhone) printIssuerLine(`Tel : ${companyPhone}`);
    if (companyEmail) printIssuerLine(`Email : ${companyEmail}`);
  }

  let tableY = Math.max(leftY, rightY) + 20 + offLineItemsY;

  tableY = renderInvoiceStyleLineTable({
    doc,
    items,
    profile: invLay,
    marginL: marginL + offLineItemsX,
    contentW,
    tableStartY: tableY,
    currencyAmountLabel,
    formatMoney,
    BLACK,
    GRAY,
  });

  if (sectionShows("showTotals", invLay)) {
    tableY += offTotalsY;
    doc.moveTo(marginL + offTotalsX, tableY).lineTo(marginL + contentW + offTotalsX, tableY).strokeColor(BLACK).lineWidth(0.5).stroke();
    tableY += 10;

    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold").text(formatMoney(total), marginL + offTotalsX, tableY, { align: "right", width: contentW });
    tableY += 28;
  }

  const bankSectionTop = tableY + offBankY;
  let bankY = bankSectionTop;
  const bankLabelX = marginL + offBankX;
  const bankValueBase = marginL + 130 + offBankX;
  /** Full content width for bank values (company chop is drawn beside this section when both are shown). */
  const bankValueRightX = marginL + contentW + offBankX;
  const bankValueWidth = Math.max(180, bankValueRightX - bankValueBase);

  if (sectionShows("showBankAccounts", invLay)) {
    bankY = bankSectionTop;
    const renderBankAccount = (bank: NonNullable<typeof settings>["bankAccount1"]) => {
      if (!bank) return;
      let by = bankY;
      const row = (l: string, v: string) => {
        const vv = truncatePdfFieldText(v, PDF_MAX_BANK_FIELD_CHARS);
        const padded = padMinFieldLength(vv, PDF_MIN_ADDRESS_BANK_FIELD_CHARS);
        doc.fillColor(BLACK).fontSize(9).font("Helvetica").text(l, bankLabelX, by, { width: 125 });
        doc.fillColor(BLACK).fontSize(9).font("Helvetica").text(padded, bankValueBase, by, {
          width: bankValueWidth,
        });
        const valueHeight = doc.heightOfString(padded, { width: bankValueWidth });
        by += Math.max(valueHeight, 11) + 2;
      };
      if (bank.bankName) row("Bank :", bank.bankName);
      if (bank.bankCode) row("Bank Code :", bank.bankCode);
      if (bank.branchName) row("Branch Name :", bank.branchName);
      if (bank.swift) row("SWIFT Code :", bank.swift);
      if (bank.bankAddress) row("Bank Address :", bank.bankAddress);
      const acctName = bank.accountName || companyName;
      row("Bank Account Name :", acctName);
      if (bank.accountNumber) row("Account No. :", bank.accountNumber);
      bankY = by;
    };

    if (settings?.bankAccount1) {
      renderBankAccount(settings.bankAccount1);
    }
    if (settings?.bankAccount2) {
      bankY += 8;
      renderBankAccount(settings.bankAccount2);
    }
    bankY += 6;
    const bankNoteWidth = Math.max(200, bankValueRightX - bankLabelX);
    doc.fillColor(GRAY).fontSize(9).font("Helvetica-Oblique")
      .text("  Electronic Cheque or bank transfer is highly preferred.", bankLabelX, bankY, { width: bankNoteWidth });
    bankY += 13;
    doc.fillColor(GRAY).fontSize(9).font("Helvetica-Oblique")
      .text(padMinFieldLength(`  Make all cheques payable to ${companyName}`, 60), bankLabelX, bankY, { width: bankNoteWidth });
  }

  const footerCopy =
    invLay?.footerText?.trim() && invLay.footerText.trim().length > 0
      ? invLay.footerText.trim()
      : "Thank you for your business !";

  const pageH = doc.page.height;
  const bottomMargin = 50;
  /** Space reserved above payment advice when footer line is on the same page (stroke + text). */
  let footerBandH = 0;
  if (sectionShows("showFooterAddress", invLay)) {
    doc.fillColor(BLACK).fontSize(10).font("Helvetica");
    footerBandH = pdfFooterLineAndTextY(doc, footerCopy, contentW, { offsetY: offFooterLineY }).bandHeight;
  }

  const payAdviceBlockHeight = sectionShows("showPaymentAdvicePage", invLay)
    ? measureInvoicePaymentAdviceBlockHeight(
        invoice,
        client,
        settings,
        companyName,
        currency,
        total,
        paidAmount,
        invoiceDateDisplay,
        contentW,
        marginL,
        offPayAdviceX,
        formatMoney,
        formatDate,
      )
    : 0;

  const payAdviceTop =
    sectionShows("showPaymentAdvicePage", invLay)
      ? pageH - bottomMargin - payAdviceBlockHeight + offPayAdviceY
      : undefined;

  if (sectionShows("showSignatures", invLay)) {
    const sigBlockLeft = rightCol + offSigX;
    const sigBlockW = contentW / 2;
    const sigAnchorY = sectionShows("showBankAccounts", invLay) ? bankY + 12 : bankSectionTop;
    let sigY = sigAnchorY + offSigY;
    const ss = logoScaleFactor(companyChopScaleColumns(settings));
    const STAMP_MAX = 56 * ss;
    /** Keep chop above the payment-advice block; that block is painted later on page 1 and would cover the stamp. */
    if (payAdviceTop !== undefined) {
      const gapAbovePayAdvicePt = 12;
      const maxSigY = payAdviceTop - gapAbovePayAdvicePt - STAMP_MAX;
      if (Number.isFinite(maxSigY) && maxSigY > marginL && sigY > maxSigY) {
        sigY = maxSigY;
      }
    }
    const stampX = sigBlockLeft + sigBlockW - STAMP_MAX;
    if (stampBuffer) {
      doc.image(stampBuffer, stampX, sigY, { fit: [STAMP_MAX, STAMP_MAX] });
    }
  }

  if (sectionShows("showFooterAddress", invLay)) {
    doc.fillColor(BLACK).fontSize(10).font("Helvetica");
    let { lineY, textY } = pdfFooterLineAndTextY(doc, footerCopy, contentW, { offsetY: offFooterLineY });
    if (payAdviceTop !== undefined) {
      const maxLineY = payAdviceTop - footerBandH;
      if (lineY > maxLineY) {
        lineY = maxLineY;
        textY = lineY + PDF_FOOTER_LINE_TO_TEXT_GAP_PT;
      }
    }
    doc.moveTo(marginL + offFooterLineX, lineY).lineTo(marginL + contentW + offFooterLineX, lineY).strokeColor(BLACK).lineWidth(0.5).stroke();
    doc.text(footerCopy, marginL + offFooterLineX, textY, { align: "center", width: contentW });
  }

  if (sectionShows("showPaymentAdvicePage", invLay) && payAdviceTop !== undefined) {
    const range = doc.bufferedPageRange();
    const savedPageIndex = range.start + range.count - 1;
    doc.switchToPage(0);
    drawInvoicePaymentAdviceBlock(
      doc,
      BLACK,
      GRAY,
      invoice,
      client,
      settings,
      companyName,
      currency,
      total,
      paidAmount,
      invoiceDateDisplay,
      contentW,
      marginL,
      offPayAdviceX,
      payAdviceTop,
      formatMoney,
      formatDate,
    );
    doc.switchToPage(savedPageIndex);
  }

}

/** Height of the invoice payment-advice block (measured on a throwaway PDF). */
function measureInvoicePaymentAdviceBlockHeight(
  invoice: typeof invoicesTable.$inferSelect,
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  companyName: string,
  currency: string,
  total: number,
  paidAmount: number,
  invoiceDateDisplay: string,
  contentW: number,
  marginL: number,
  offPayAdviceX: number,
  formatMoney: (n: number) => string,
  formatDate: (dateStr: string) => string,
): number {
  const scratch = new PDFDocument({ size: "A4", margin: 50 });
  const bottomY = drawInvoicePaymentAdviceBlock(
    scratch,
    "#000000",
    "#555555",
    invoice,
    client,
    settings,
    companyName,
    currency,
    total,
    paidAmount,
    invoiceDateDisplay,
    contentW,
    marginL,
    offPayAdviceX,
    0,
    formatMoney,
    formatDate,
  );
  scratch.end();
  return bottomY;
}

/** Renders the invoice payment-advice block at `topY`; returns Y coordinate just below the block. */
function drawInvoicePaymentAdviceBlock(
  doc: InstanceType<typeof PDFDocument>,
  BLACK: string,
  GRAY: string,
  invoice: typeof invoicesTable.$inferSelect,
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  companyName: string,
  currency: string,
  total: number,
  paidAmount: number,
  invoiceDateDisplay: string,
  contentW: number,
  marginL: number,
  offPayAdviceX: number,
  topY: number,
  formatMoney: (n: number) => string,
  formatDate: (dateStr: string) => string,
): number {
  const dueDateDisplay = invoice.dueDate ? formatDate(invoice.dueDate) : "—";
  const payable = Math.max(total - paidAmount, 0);
  let py = topY;

  doc.fillColor(BLACK).fontSize(20).font("Helvetica-Bold").text("PAYMENT ADVICE", marginL + offPayAdviceX, py);
  py += 28;

  doc.fillColor(BLACK).fontSize(10).font("Helvetica");
  py = printPaymentAdviceKV(doc, BLACK, GRAY, marginL + offPayAdviceX, py, contentW, "Invoice No.", invoice.invoiceNumber);
  py = printPaymentAdviceKV(doc, BLACK, GRAY, marginL + offPayAdviceX, py, contentW, "Invoice Date", invoiceDateDisplay);
  py = printPaymentAdviceKV(doc, BLACK, GRAY, marginL + offPayAdviceX, py, contentW, "Due Date", dueDateDisplay);
  py = printPaymentAdviceKV(doc, BLACK, GRAY, marginL + offPayAdviceX, py, contentW, "Bill To", truncatePdfFieldText(client?.name ?? "—", PDF_MAX_BILL_TO_FIELD_CHARS));
  py += 8;

  doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold").text(`Amount payable (${currency})`, marginL + offPayAdviceX, py);
  doc.text(formatMoney(payable), marginL + offPayAdviceX, py, { align: "right", width: contentW });
  py += 24;

  doc.fillColor(GRAY).fontSize(9).font("Helvetica").text("Please remit using the following bank details.", marginL + offPayAdviceX, py, { width: contentW });
  py += 16;

  const paBankLabelX = marginL + offPayAdviceX;
  const paBankValueX = marginL + 130 + offPayAdviceX;

  const renderBankPaymentAdvice = (bank: NonNullable<typeof settings>["bankAccount1"]) => {
    if (!bank) return;
    let by = py;
    const row = (l: string, v: string) => {
      const vv = truncatePdfFieldText(v, PDF_MAX_BANK_FIELD_CHARS);
      const padded = padMinFieldLength(vv, PDF_MIN_ADDRESS_BANK_FIELD_CHARS);
      const valueWidth = contentW - 130;
      doc.fillColor(BLACK).fontSize(9).font("Helvetica").text(l, paBankLabelX, by, { width: 125 });
      doc.fillColor(BLACK).fontSize(9).font("Helvetica").text(padded, paBankValueX, by, {
        width: valueWidth,
      });
      const valueHeight = doc.heightOfString(padded, { width: valueWidth });
      by += Math.max(valueHeight, 11) + 2;
    };
    if (bank.bankName) row("Bank :", bank.bankName);
    if (bank.accountNumber) row("Account No. :", bank.accountNumber);
    py = by;
  };

  if (settings?.bankAccount1) renderBankPaymentAdvice(settings.bankAccount1);
  if (settings?.bankAccount2) {
    py += 8;
    renderBankPaymentAdvice(settings.bankAccount2);
  }

  py += 12;
  const refLine = truncatePdfFieldText(`Payment reference: Invoice ${invoice.invoiceNumber}`, PDF_MAX_BANK_FIELD_CHARS);
  doc.fillColor(BLACK).fontSize(8).font("Helvetica").text(refLine, marginL + offPayAdviceX, py, { width: contentW });
  const refH = doc.heightOfString(refLine, { width: contentW });
  return py + Math.max(refH, 10);
}

/** Label + value for the payment-advice slip (multi-line value). */
function printPaymentAdviceKV(
  doc: InstanceType<typeof PDFDocument>,
  BLACK: string,
  GRAY: string,
  x: number,
  y: number,
  contentW: number,
  label: string,
  value: string,
): number {
  const labelPx = `${label}:`;
  doc.fontSize(9).font("Helvetica-Bold");
  const labelW = doc.widthOfString(labelPx);
  doc.fillColor(GRAY).text(labelPx, x, y);
  const valueX = x + labelW + 6;
  doc.fillColor(BLACK).fontSize(9).font("Helvetica").text(value, valueX, y, { width: contentW - (valueX - x) });
  const h = doc.heightOfString(value, { width: contentW - (valueX - x) });
  return y + Math.max(h, 12) + 4;
}

export async function streamInvoicePdfToBuffer(
  invoice: typeof invoicesTable.$inferSelect & { items: LineItem[] },
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  await drawInvoicePdfDoc(doc, invoice, client, settings);
  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
}

export async function streamInvoicePdf(
  invoice: typeof invoicesTable.$inferSelect & { items: LineItem[] },
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  res: Response,
  inline: boolean,
): Promise<void> {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const safeNum = invoice.invoiceNumber.replace(/[^\w\-]/g, "_");
  setPdfDownloadHeaders(
    res,
    `${inline ? "inline" : "attachment"}; filename="invoice-${safeNum}.pdf"`,
  );
  doc.pipe(res);
  await drawInvoicePdfDoc(doc, invoice, client, settings);
  doc.end();
}
