import PDFDocument from "pdfkit";
import {
  quotationsTable,
  receiptsTable,
  invoicesTable,
  clientsTable,
  companySettingsTable,
  type LineItem,
} from "@workspace/db";
import { headerBannerLayoutWidthPt, layoutBrandingEffectiveContentOffset } from "@workspace/invoice-utils";
import { logoScaleFactor } from "./logoScale";
import { pdfBrandingBand, titleBlockBaseY } from "./pdfBrandingBand";
import { imageBufferAspectRatio } from "./imageBufferAspectRatio";
import { getLayoutsFromSettings, sectionOffsetY, sectionOffsetX, sectionShows } from "./pdfLayoutProfile";
import { renderQuotationThreeColumnLineTable } from "./pdfInvoiceLines";
import { padMinFieldLength, PDF_MIN_ADDRESS_BANK_FIELD_CHARS, PDF_MIN_BILL_TO_FIELD_CHARS } from "./pdfTextMinField";
import { clientStructuredAddressFourLines, consolidateClientAddressParts } from "./pdfClientAddress";
import { fetchImageBuffer } from "./fetchImageBuffer";
import { companyChopScaleColumns, companyChopStoredUrl } from "./companyChop";
import { pdfFooterLineAndTextY } from "./pdfFooterPosition";
import { setPdfDownloadHeaders } from "./pdfResponseHeaders";
import "./pdfTraditionalChinese";

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

/** Layout-aware quotation PDF (same rules as streamed /pdf route). */
export async function drawQuotationPdfDoc(
  doc: InstanceType<typeof PDFDocument>,
  quotation: typeof quotationsTable.$inferSelect & { items: LineItem[] },
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
): Promise<void> {
  const currency = quotation.currency;

  const formatMoney = (v: number) =>
    `$  ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;

  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "—";
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [y, m, d] = dateStr.split("-").map(Number);
    return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
  };

  const chopUrl = companyChopStoredUrl(settings);
  const [headerLogoBuffer, logoBuffer, stampBuffer] = await Promise.all([
    settings?.headerLogoUrl ? fetchImageBuffer(settings.headerLogoUrl) : Promise.resolve(null),
    settings?.logoUrl ? fetchImageBuffer(settings.logoUrl) : Promise.resolve(null),
    chopUrl ? fetchImageBuffer(chopUrl) : Promise.resolve(null),
  ]);

  const pageW = doc.page.width;
  const marginL = 50;
  const marginR = 50;
  const contentW = pageW - marginL - marginR;
  const rightCol = pageW / 2;

  const BLACK = "#000000";
  const GRAY = "#555555";

  const companyName = settings?.companyName || "Gabriel Consultant Limited";
  const headerBannerAspect = await imageBufferAspectRatio(headerLogoBuffer);
  const layMaps = getLayoutsFromSettings(
    settings?.pdfDocumentLayouts,
    settings ? { ...settings, headerBannerAspectRatio: headerBannerAspect } : undefined,
  );
  const qLay = layMaps.quotation;

  const offLogoY = sectionOffsetY("showLogoRow", qLay);
  const offLogoX = sectionOffsetX("showLogoRow", qLay);
  const offHeaderBannerY = sectionOffsetY("showHeaderBannerLogo", qLay);
  const offHeaderBannerX = sectionOffsetX("showHeaderBannerLogo", qLay);
  const offTitleY = sectionOffsetY("showTitleBlock", qLay);
  const offTitleX = sectionOffsetX("showTitleBlock", qLay);
  const offBillingBlockY = sectionOffsetY("showBillingBlock", qLay);
  const offBillingBlockX = sectionOffsetX("showBillingBlock", qLay);
  const offLineItemsY = sectionOffsetY("lineItems", qLay);
  const offLineItemsX = sectionOffsetX("lineItems", qLay);
  const offTotalsY = sectionOffsetY("showTotals", qLay);
  const offTotalsX = sectionOffsetX("showTotals", qLay);
  const offSigY = sectionOffsetY("showSignatures", qLay);
  const offSigX = sectionOffsetX("showSignatures", qLay);
  const offFooterLineY = sectionOffsetY("showFooterAddress", qLay);
  const offFooterLineX = sectionOffsetX("showFooterAddress", qLay);
  const offBankY = sectionOffsetY("showBankAccounts", qLay);
  const offBankX = sectionOffsetX("showBankAccounts", qLay);

  const band = pdfBrandingBand({
    showLogoRow: sectionShows("showLogoRow", qLay),
    showHeaderBanner: sectionShows("showHeaderBannerLogo", qLay),
    hasCompanyLogo: Boolean(logoBuffer),
    hasHeaderLogo: Boolean(headerLogoBuffer),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    headerLogoWidthScale: settings?.headerLogoWidthScale,
  });
  if (sectionShows("showLogoRow", qLay) && logoBuffer) {
    doc.image(logoBuffer, marginL + offLogoX, 10 + offLogoY, {
      fit: [band.companyMaxW, band.companyMaxH],
    });
  }

  const LOGO_OFFSET = layoutBrandingEffectiveContentOffset({
    showLogoRow: sectionShows("showLogoRow", qLay),
    showHeaderBannerLogo: sectionShows("showHeaderBannerLogo", qLay),
    hasCompanyLogo: Boolean(logoBuffer),
    hasHeaderLogo: Boolean(headerLogoBuffer),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    offLogoY,
    offHeaderBannerY,
  });
  if (sectionShows("showHeaderBannerLogo", qLay) && headerLogoBuffer) {
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

  /** Two extra body-text rows of breathing room below the title before Bill To / Quotation No. line up. */
  const TITLE_TO_BILLING_EXTRA_ROWS = 2;
  const TITLE_TO_BILLING_ROW_H = 14;
  const addrTop =
    110 + TITLE_TO_BILLING_EXTRA_ROWS * TITLE_TO_BILLING_ROW_H + LOGO_OFFSET + offBillingBlockY;
  let leftY = addrTop;

  if (sectionShows("showTitleBlock", qLay)) {
    doc.fillColor(BLACK).fontSize(28).font("Helvetica-Bold").text("QUOTATION", marginL + offTitleX, titleY);

    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold")
      .text(`Quotation No.  ${quotation.quotationNumber}`, marginL + offTitleX, titleY + 5, { align: "right", width: contentW });
    doc.fillColor(BLACK).fontSize(10).font("Helvetica")
      .text(`Quotation Date:  ${formatDate(quotation.quotationDate)}`, marginL + offTitleX, titleY + 20, { align: "right", width: contentW });
    if (quotation.validUntil) {
      doc.fillColor(BLACK).fontSize(10).font("Helvetica")
        .text(`Valid Until:  ${formatDate(quotation.validUntil)}`, marginL + offTitleX, titleY + 35, { align: "right", width: contentW });
    }
  }

  const addrLabelX = marginL + offBillingBlockX;
  const addrValueX = marginL + 70 + offBillingBlockX;
  /** Use full content width so long Bill To / Address lines fit on one row where possible. */
  const billingValueRightX = marginL + contentW + offBillingBlockX;
  const billingValueWidth = Math.max(120, billingValueRightX - addrValueX);

  const printLabeledLine = (label: string, value: string, y: number): number => {
    const padded = padMinFieldLength(value, PDF_MIN_BILL_TO_FIELD_CHARS);
    doc.fillColor(BLACK).fontSize(10).font("Helvetica").text(`${label}`, addrLabelX, y, { width: 65 });
    doc.fillColor(BLACK).fontSize(10).font("Helvetica").text(padded, addrValueX, y, {
      width: billingValueWidth,
      lineBreak: false,
    });
    const valueHeight = doc.heightOfString(padded, { width: billingValueWidth, lineBreak: false });
    return y + Math.max(valueHeight, 12) + 2;
  };

  if (sectionShows("showBillingBlock", qLay)) {
    leftY = printLabeledLine("Bill To :", client?.name ?? "—", leftY);
    const clientAddrSlots = clientStructuredAddressFourLines(client);
    const hasAnyAddressSlot = clientAddrSlots.some((s) => s.length > 0);
    if (hasAnyAddressSlot) {
      for (let i = 0; i < clientAddrSlots.length; i++) {
        leftY = printLabeledLine(i === 0 ? "Address :" : "", clientAddrSlots[i], leftY);
      }
    }
    leftY += 14;
    const pdfAttn = (quotation.quotationAttn ?? "").trim();
    leftY = printLabeledLine("Attn :", pdfAttn || "—", leftY);
  }

  let tableY = leftY + 20 + offLineItemsY;

  const items = quotation.items;
  tableY = renderQuotationThreeColumnLineTable({
    doc,
    items,
    marginL: marginL + offLineItemsX,
    contentW,
    tableStartY: tableY,
    currencyCode: currency,
    formatMoney,
    BLACK,
    GRAY,
  });

  const total = toNumber(quotation.total);

  if (sectionShows("showTotals", qLay)) {
    tableY += offTotalsY;
    doc.moveTo(marginL + offTotalsX, tableY).lineTo(marginL + contentW + offTotalsX, tableY).strokeColor(BLACK).lineWidth(0.5).stroke();
    tableY += 10;

    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold").text(formatMoney(total), marginL + offTotalsX, tableY, {
      align: "right",
      width: contentW,
    });
    tableY += 28;
  }

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

  const bankSectionTop = tableY + offBankY;
  let bankY = bankSectionTop;
  const bankLabelX = marginL + offBankX;
  const bankValueBase = marginL + 130 + offBankX;
  const bankColWBase = contentW / 2 - 20;

  if (sectionShows("showBankAccounts", qLay)) {
    bankY = bankSectionTop;
    const renderBankAccount = (bank: NonNullable<typeof settings>["bankAccount1"]) => {
      if (!bank) return;
      let by = bankY;
      const row = (l: string, v: string) => {
        const valueWidth = bankColWBase - 130;
        const padded = padMinFieldLength(v, PDF_MIN_ADDRESS_BANK_FIELD_CHARS);
        doc.fillColor(BLACK).fontSize(9).font("Helvetica").text(l, bankLabelX, by, { width: 125 });
        doc.fillColor(BLACK).fontSize(9).font("Helvetica").text(padded, bankValueBase, by, {
          width: valueWidth,
        });
        const valueHeight = doc.heightOfString(padded, { width: valueWidth });
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
    doc.fillColor(GRAY).fontSize(9).font("Helvetica-Oblique")
      .text("  Electronic Cheque or bank transfer is highly preferred.", bankLabelX, bankY, { width: bankColWBase });
    bankY += 13;
    doc.fillColor(GRAY).fontSize(9).font("Helvetica-Oblique")
      .text(padMinFieldLength(`  Make all cheques payable to ${companyName}`, 60), bankLabelX, bankY, { width: bankColWBase });
    bankY += 13;
    tableY = bankY;
  }

  const offQuotationExtraY = sectionOffsetY("quotationExtra", qLay);
  const offQuotationExtraX = sectionOffsetX("quotationExtra", qLay);
  tableY += offQuotationExtraY;

  const showRemark = qLay?.quotation?.showRemarks !== false;
  const remark = (quotation as { remark?: string | null }).remark?.trim();

  const showTerms = qLay?.quotation?.showPaymentTerms !== false;
  const tnc = (quotation as { termsConditions?: string | null }).termsConditions?.trim();

  if (remark && showRemark) {
    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold").text("Remarks:", marginL + offQuotationExtraX, tableY);
    tableY += 14;
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(remark, marginL + offQuotationExtraX, tableY, { width: contentW });
    tableY += doc.heightOfString(remark, { width: contentW }) + 12;
  }

  if (tnc && showTerms) {
    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold").text("Terms & Conditions:", marginL + offQuotationExtraX, tableY);
    tableY += 14;
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(tnc, marginL + offQuotationExtraX, tableY, { width: contentW });
    tableY += doc.heightOfString(tnc, { width: contentW }) + 12;
  }

  const showSig = qLay?.quotation?.showSignatureBlock !== false;

  if (showSig && sectionShows("showSignatures", qLay)) {
    tableY += offSigY + 16;
    const sigLineW = contentW / 2 - 20;
    const sigLeftX = marginL + offSigX;
    const sigRightX = rightCol + offSigX;
    /** Extra gap below client name before signature lines (~6 body-text rows). */
    const SIG_GAP_BELOW_NAME_ROWS = 6;
    const SIG_GAP_ROW_HEIGHT = 12;
    const lineY = tableY + 52 + SIG_GAP_BELOW_NAME_ROWS * SIG_GAP_ROW_HEIGHT;
    const ss = logoScaleFactor(companyChopScaleColumns(settings));
    const STAMP_MAX = 56 * ss;

    doc.fillColor(BLACK).fontSize(10).font("Helvetica").text("For and on behalf of", sigRightX, tableY, { width: sigLineW });
    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold").text(padMinFieldLength(client?.name ?? "—", PDF_MIN_ADDRESS_BANK_FIELD_CHARS), sigRightX, tableY + 14, { width: sigLineW });

    const stampTop = lineY - STAMP_MAX - 4;
    if (stampBuffer) {
      doc.image(stampBuffer, sigLeftX, stampTop, { fit: [STAMP_MAX, STAMP_MAX] });
    }

    doc.moveTo(sigLeftX, lineY).lineTo(sigLeftX + sigLineW, lineY).strokeColor(BLACK).lineWidth(0.5).stroke();
    doc.moveTo(sigRightX, lineY).lineTo(sigRightX + sigLineW, lineY).strokeColor(BLACK).lineWidth(0.5).stroke();
    tableY = lineY + 6;
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text("Authorized Signature", sigLeftX, tableY);
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text("Authorized Signature", sigRightX, tableY);
    tableY += 20;
  }

  const footerCopy =
    qLay?.footerText?.trim() && qLay.footerText.trim().length > 0
      ? qLay.footerText.trim()
      : "Thank you for your consideration!";

  if (sectionShows("showFooterAddress", qLay)) {
    doc.fillColor(BLACK).fontSize(10).font("Helvetica");
    const { lineY, textY } = pdfFooterLineAndTextY(doc, footerCopy, contentW, { offsetY: offFooterLineY });
    doc.moveTo(marginL + offFooterLineX, lineY).lineTo(marginL + contentW + offFooterLineX, lineY).strokeColor(BLACK).lineWidth(0.5).stroke();
    doc.text(footerCopy, marginL + offFooterLineX, textY, {
      align: "center",
      width: contentW,
    });
  }
}

export async function streamQuotationPdfToBuffer(
  quotation: typeof quotationsTable.$inferSelect & { items: LineItem[] },
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  await drawQuotationPdfDoc(doc, quotation, client, settings);
  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
}

/** Receipt PDF aligned with `/receipts/:id/pdf` layout rules. */
export async function drawReceiptPdfDoc(
  doc: InstanceType<typeof PDFDocument>,
  receipt: typeof receiptsTable.$inferSelect,
  invoiceNumber: string | null | undefined,
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
): Promise<void> {
  const amount = toNumber(receipt.amount);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: receipt.currency,
  }).format(amount);

  const receiptChopUrl = companyChopStoredUrl(settings);
  const [logoBuffer, headerLogoBuffer] = await Promise.all([
    settings?.logoUrl ? fetchImageBuffer(settings.logoUrl) : Promise.resolve(null),
    settings?.headerLogoUrl ? fetchImageBuffer(settings.headerLogoUrl) : Promise.resolve(null),
  ]);
  const headerBannerAspect = await imageBufferAspectRatio(headerLogoBuffer);
  const layMaps = getLayoutsFromSettings(
    settings?.pdfDocumentLayouts,
    settings ? { ...settings, headerBannerAspectRatio: headerBannerAspect } : undefined,
  );
  const rLay = layMaps.receipt;
  const showCompanyChop = rLay?.receipt?.showCompanyChop === true;
  const stampBuffer = showCompanyChop && receiptChopUrl ? await fetchImageBuffer(receiptChopUrl) : null;
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
  const showAccent = rLay?.receipt?.showAccentHeader !== false;
  const showChequeRows = rLay?.receipt?.showChequeDetailRows !== false;

  const offLogoY = sectionOffsetY("showLogoRow", rLay);
  const offLogoX = sectionOffsetX("showLogoRow", rLay);
  const offHeaderBannerY = sectionOffsetY("showHeaderBannerLogo", rLay);
  const offHeaderBannerX = sectionOffsetX("showHeaderBannerLogo", rLay);
  const offTitleY = sectionOffsetY("showTitleBlock", rLay);
  const offTitleX = sectionOffsetX("showTitleBlock", rLay);
  const offBillingY = sectionOffsetY("showBillingBlock", rLay);
  const offBillingX = sectionOffsetX("showBillingBlock", rLay);
  const offLineItemsY = sectionOffsetY("lineItems", rLay);
  const offLineItemsX = sectionOffsetX("lineItems", rLay);
  const offTotalsY = sectionOffsetY("showTotals", rLay);
  const offTotalsX = sectionOffsetX("showTotals", rLay);
  const offFooterLineY = sectionOffsetY("showFooterAddress", rLay);
  const offFooterLineX = sectionOffsetX("showFooterAddress", rLay);

  const pageWidth = doc.page.width - 100;
  const DARK = "#1a1a2e";
  const ACCENT = "#4f46e5";
  const GRAY = "#6b7280";
  const LIGHT_GRAY = "#f3f4f6";
  const marginL = 50;

  const band = pdfBrandingBand({
    showLogoRow: sectionShows("showLogoRow", rLay),
    showHeaderBanner: sectionShows("showHeaderBannerLogo", rLay),
    hasCompanyLogo: Boolean(logoBuffer),
    hasHeaderLogo: Boolean(headerLogoBuffer),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    headerLogoWidthScale: settings?.headerLogoWidthScale,
  });

  if (sectionShows("showLogoRow", rLay) && logoBuffer) {
    doc.image(logoBuffer, marginL + offLogoX, 10 + offLogoY, {
      fit: [band.companyMaxW, band.companyMaxH],
    });
  }

  /** Vertical space for title band (matches invoice / quotation / job order stacking). */
  const LOGO_OFFSET = layoutBrandingEffectiveContentOffset({
    showLogoRow: sectionShows("showLogoRow", rLay),
    showHeaderBannerLogo: sectionShows("showHeaderBannerLogo", rLay),
    hasCompanyLogo: Boolean(logoBuffer),
    hasHeaderLogo: Boolean(headerLogoBuffer),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    offLogoY,
    offHeaderBannerY,
  });
  if (sectionShows("showHeaderBannerLogo", rLay) && headerLogoBuffer) {
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

  const [ryear, rmonth, rday] = receipt.receiptDate.split("-").map(Number);
  const displayDate = new Date(ryear, rmonth - 1, rday).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const contentShift = offBillingY + offLineItemsY;
  const titleY = titleBlockBaseY(LOGO_OFFSET) + offTitleY;

  if (sectionShows("showTitleBlock", rLay) && showAccent) {
    doc.rect(50 + offTitleX, titleY, pageWidth, 80).fill(ACCENT);

    doc
      .fillColor("#ffffff")
      .fontSize(26)
      .font("Helvetica-Bold")
      .text("RECEIPT", 70 + offTitleX, titleY + 20);

    doc
      .fillColor("rgba(255,255,255,0.75)")
      .fontSize(10)
      .font("Helvetica")
      .text("Official Payment Receipt", 70 + offTitleX, titleY + 51);

    doc
      .fillColor("#ffffff")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(receipt.receiptNumber, 70 + offTitleX, titleY + 20, { align: "right", width: pageWidth - 40 });

    doc
      .fillColor("rgba(255,255,255,0.75)")
      .fontSize(9)
      .font("Helvetica")
      .text("Receipt Number", 70 + offTitleX, titleY + 35, { align: "right", width: pageWidth - 40 });

    doc.fillColor("rgba(255,255,255,0.75)").fontSize(9).font("Helvetica").text(displayDate, 70 + offTitleX, titleY + 51, {
      align: "right",
      width: pageWidth - 40,
    });
  } else if (sectionShows("showTitleBlock", rLay)) {
    doc.fillColor(DARK).fontSize(28).font("Helvetica-Bold").text("RECEIPT", marginL + offTitleX, titleY);
    doc
      .fillColor(GRAY)
      .fontSize(10)
      .font("Helvetica")
      .text("Official Payment Receipt", marginL + offTitleX, titleY, { align: "right", width: pageWidth });
    doc.fillColor(DARK).fontSize(11).font("Helvetica-Bold").text(receipt.receiptNumber, marginL + offTitleX, titleY + 23, {
      align: "right",
      width: pageWidth,
    });
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(displayDate, marginL + offTitleX, titleY + 39, {
      align: "right",
      width: pageWidth,
    });
  }

  const infoTop = 150 + LOGO_OFFSET + contentShift;
  /** Same horizontal extent as header (date / receipt #) so issuer block is flush right on that margin. */
  const issuerX = marginL + offBillingX;
  const issuerW = pageWidth;
  doc.fillColor(DARK).fontSize(9).font("Helvetica-Bold").text("RECEIVED FROM", 50 + offBillingX, infoTop);
  let payerY = infoTop + 14;
  doc
    .fillColor(DARK)
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(padMinFieldLength(client?.name ?? "—", 60), 50 + offBillingX, payerY);
  payerY += 14;

  if (client?.email) {
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(client.email, 50 + offBillingX, payerY);
    payerY += 13;
  }

  const clientAddrLines = consolidateClientAddressParts(
    [
      client?.addressLine1 ?? client?.address,
      client?.addressLine2,
      client?.addressLine3,
      client?.addressLine4,
      client?.country,
    ].filter(Boolean) as string[],
    4,
  );
  for (const line of clientAddrLines) {
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(padMinFieldLength(line, 60), 50 + offBillingX, payerY, {
      width: 250,
      lineBreak: false,
    });
    payerY += 12;
  }

  let issuerY = infoTop;
  doc.fillColor(DARK).fontSize(10).font("Helvetica-Bold").text(companyName, issuerX, issuerY, {
    width: issuerW,
    align: "right",
  });
  issuerY += 14;
  for (const line of companyAddressLines) {
    doc.fillColor(DARK).fontSize(9).font("Helvetica").text(line, issuerX, issuerY, {
      width: issuerW,
      align: "right",
    });
    issuerY += 12;
  }
  if (companyPhone) {
    doc.fillColor(DARK).fontSize(9).font("Helvetica").text(`Tel : ${companyPhone}`, issuerX, issuerY, {
      width: issuerW,
      align: "right",
    });
    issuerY += 12;
  }
  if (companyEmail) {
    doc.fillColor(DARK).fontSize(9).font("Helvetica").text(`Email : ${companyEmail}`, issuerX, issuerY, {
      width: issuerW,
      align: "right",
    });
  }

  if (invoiceNumber) {
    doc.fillColor(DARK).fontSize(9).font("Helvetica-Bold").text("INVOICE REFERENCE", 350 + offBillingX, infoTop);
    doc.fillColor(DARK).fontSize(12).font("Helvetica-Bold").text(invoiceNumber, 350 + offBillingX, infoTop + 14);
  }

  const dividerY = 240 + LOGO_OFFSET + contentShift;
  doc.moveTo(50 + offLineItemsX, dividerY).lineTo(50 + pageWidth + offLineItemsX, dividerY).strokeColor("#e5e7eb").lineWidth(1).stroke();

  const amtBoxTop = 260 + LOGO_OFFSET + contentShift + offTotalsY;
  doc.rect(50 + offTotalsX, amtBoxTop, pageWidth, 80).fill(LIGHT_GRAY);
  doc
    .fillColor(GRAY)
    .fontSize(10)
    .font("Helvetica")
    .text("AMOUNT RECEIVED", 70 + offTotalsX, amtBoxTop + 14);
  doc
    .fillColor(ACCENT)
    .fontSize(30)
    .font("Helvetica-Bold")
    .text(formatted, 70 + offTotalsX, amtBoxTop + 28, { align: "left" });

  doc
    .rect(50 + pageWidth - 80 + offTotalsX, amtBoxTop + 20, 60, 28)
    .fill(ACCENT);
  doc
    .fillColor("#ffffff")
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(receipt.currency, 50 + pageWidth - 80 + offTotalsX, amtBoxTop + 28, { width: 60, align: "center" });

  const detailsTop = amtBoxTop + 110;
  const labelX = 50 + offLineItemsX;
  const valueX = 200 + offLineItemsX;
  const rowH = 22;
  let currentY = detailsTop;

  const detailRows: Array<[string, string | null | undefined]> = [];
  if (showChequeRows) {
    if (receipt.chequeNumber) detailRows.push(["Cheque Number", receipt.chequeNumber]);
    if (receipt.chequeDetails) detailRows.push(["Cheque Details", receipt.chequeDetails]);
  }
  if (receipt.notes) detailRows.push(["Notes", receipt.notes]);

  if (detailRows.length > 0) {
    doc.fillColor(DARK).fontSize(9).font("Helvetica-Bold").text("PAYMENT DETAILS", labelX, currentY);
    currentY += 16;
    doc.moveTo(labelX, currentY).lineTo(labelX + pageWidth, currentY).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
    currentY += 10;

    for (const [label, value] of detailRows) {
      doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(label, labelX, currentY);
      doc.fillColor(DARK).fontSize(9).font("Helvetica").text(value ?? "", valueX, currentY, { width: pageWidth - (valueX - labelX) });
      currentY += rowH;
    }
  }

  if (showCompanyChop) {
    const ss = logoScaleFactor(companyChopScaleColumns(settings));
    const STAMP_MAX = 56 * ss;
    let chopY = currentY + 24;
    const pageBottom = doc.page.height - 50;
    const footerReserve = sectionShows("showFooterAddress", rLay) ? 72 : 24;
    const maxChopTop = pageBottom - footerReserve - STAMP_MAX;
    if (chopY > maxChopTop) chopY = Math.max(detailsTop + 8, maxChopTop);
    const chopX = marginL + pageWidth - STAMP_MAX + offTotalsX;
    if (stampBuffer) {
      doc.image(stampBuffer, chopX, chopY, { fit: [STAMP_MAX, STAMP_MAX] });
    }
  }

  if (sectionShows("showFooterAddress", rLay)) {
    const footerCopy =
      rLay?.footerText?.trim() && rLay.footerText.trim().length > 0
        ? rLay.footerText.trim()
        : `This is an official receipt. Receipt ${receipt.receiptNumber} issued on ${displayDate}.`;
    doc.fillColor(GRAY).fontSize(8).font("Helvetica");
    const { lineY, textY } = pdfFooterLineAndTextY(doc, footerCopy, pageWidth, { offsetY: offFooterLineY });
    doc.moveTo(50 + offFooterLineX, lineY).lineTo(50 + pageWidth + offFooterLineX, lineY).strokeColor("#e5e7eb").lineWidth(1).stroke();
    doc.text(footerCopy, 50 + offFooterLineX, textY, {
      align: "center",
      width: pageWidth,
    });
  }
}

export async function streamReceiptPdfToBuffer(
  receipt: typeof receiptsTable.$inferSelect,
  invoice: typeof invoicesTable.$inferSelect | null,
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  await drawReceiptPdfDoc(doc, receipt, invoice?.invoiceNumber ?? null, client, settings);
  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
}
