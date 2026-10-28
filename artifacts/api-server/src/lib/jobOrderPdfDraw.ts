import PDFDocument from "pdfkit";
import {
  clientsTable,
  companySettingsTable,
  jobOrdersTable,
  type LineItem,
} from "@workspace/db";
import { headerBannerLayoutWidthPt, layoutBrandingEffectiveContentOffset } from "@workspace/invoice-utils";
import { pdfBrandingBand, titleBlockBaseY } from "./pdfBrandingBand";
import { imageBufferAspectRatio } from "./imageBufferAspectRatio";
import { getLayoutsFromSettings, sectionOffsetX, sectionOffsetY, sectionShows } from "./pdfLayoutProfile";
import { pdfFooterLineAndTextY } from "./pdfFooterPosition";
import { renderInvoiceStyleLineTable } from "./pdfInvoiceLines";
import { padMinFieldLength } from "./pdfTextMinField";
import { clientStructuredAddressFourLines } from "./pdfClientAddress";

function formatDDMonYYYY(dateStr: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${months[(m ?? 1) - 1]}-${y}`;
}

/** Layout-aware job order PDF (same output as `GET /job-orders/:id/pdf`). */
export async function drawJobOrderPdfDoc(
  doc: InstanceType<typeof PDFDocument>,
  jobOrder: typeof jobOrdersTable.$inferSelect & { items: LineItem[] },
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  logoBuffer: Buffer | null,
  headerLogoBuffer: Buffer | null,
  /** Consultant display names in job-order order (max 3 in app). Empty = omit line unless layout forces it off. */
  consultantNamesOrdered: string[] = [],
): Promise<void> {
  const items = jobOrder.items ?? [];
  const headerBannerAspect = await imageBufferAspectRatio(headerLogoBuffer);
  const layMaps = getLayoutsFromSettings(
    settings?.pdfDocumentLayouts,
    settings ? { ...settings, headerBannerAspectRatio: headerBannerAspect } : undefined,
  );
  const joLay = layMaps.jobOrder;

  const companyName = settings?.companyName || "Gabriel Consultant Limited";
  const companyLines = [
    settings?.addressLine1,
    settings?.addressLine2,
    settings?.addressLine3,
    settings?.addressLine4,
  ].filter(Boolean) as string[];
  if (!companyLines.length && settings?.address) {
    companyLines.push(...settings.address.split("\n").filter(Boolean));
  }
  const companyPhone = settings?.phone || "2366 4622";
  const companyEmail = settings?.email || "info@gabriel.hk";

  const formatMoney = (v: number) =>
    `$ ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
  const currencyAmountLabel = "Amount (HKD)";

  const pageW = doc.page.width;
  const marginL = 50;
  const marginR = 50;
  const contentW = pageW - marginL - marginR;
  const rightCol = pageW / 2;
  const DARK = "#000000";
  const GRAY = "#555555";

  const offLogoY = sectionOffsetY("showLogoRow", joLay);
  const offLogoX = sectionOffsetX("showLogoRow", joLay);
  const offHeaderBannerY = sectionOffsetY("showHeaderBannerLogo", joLay);
  const offHeaderBannerX = sectionOffsetX("showHeaderBannerLogo", joLay);
  const offTitleY = sectionOffsetY("showTitleBlock", joLay);
  const offTitleX = sectionOffsetX("showTitleBlock", joLay);
  const offBillingBlockY = sectionOffsetY("showBillingBlock", joLay);
  const offBillingBlockX = sectionOffsetX("showBillingBlock", joLay);
  const offLineItemsY = sectionOffsetY("lineItems", joLay);
  const offLineItemsX = sectionOffsetX("lineItems", joLay);
  const offTotalsY = sectionOffsetY("showTotals", joLay);
  const offTotalsX = sectionOffsetX("showTotals", joLay);
  const offSigY = sectionOffsetY("showSignatures", joLay);
  const offSigX = sectionOffsetX("showSignatures", joLay);
  const offFooterLineY = sectionOffsetY("showFooterAddress", joLay);
  const offFooterLineX = sectionOffsetX("showFooterAddress", joLay);
  const offConsultantsY = sectionOffsetY("jobOrderConsultants", joLay);
  const offConsultantsX = sectionOffsetX("jobOrderConsultants", joLay);

  const band = pdfBrandingBand({
    showLogoRow: sectionShows("showLogoRow", joLay),
    showHeaderBanner: sectionShows("showHeaderBannerLogo", joLay),
    hasCompanyLogo: Boolean(logoBuffer),
    hasHeaderLogo: Boolean(headerLogoBuffer),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    headerLogoWidthScale: settings?.headerLogoWidthScale,
  });
  if (sectionShows("showLogoRow", joLay) && logoBuffer) {
    doc.image(logoBuffer, marginL + offLogoX, 10 + offLogoY, {
      fit: [band.companyMaxW, band.companyMaxH],
    });
  }

  /** Vertical space reserved for headings (matches invoice / quotation stacking). */
  const LOGO_OFFSET = layoutBrandingEffectiveContentOffset({
    showLogoRow: sectionShows("showLogoRow", joLay),
    showHeaderBannerLogo: sectionShows("showHeaderBannerLogo", joLay),
    hasCompanyLogo: Boolean(logoBuffer),
    hasHeaderLogo: Boolean(headerLogoBuffer),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    offLogoY,
    offHeaderBannerY,
  });
  if (sectionShows("showHeaderBannerLogo", joLay) && headerLogoBuffer) {
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
  if (sectionShows("showTitleBlock", joLay)) {
    doc.fillColor(DARK).fontSize(24).font("Helvetica-Bold").text("JOB ORDER", marginL + offTitleX, titleY);
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text("Job Order No.", marginL + offTitleX, titleY, { align: "right", width: contentW });
    doc
      .fillColor(DARK)
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(jobOrder.jobOrderNumber, marginL + offTitleX, titleY + 10, { align: "right", width: contentW });
    doc
      .fillColor(GRAY)
      .fontSize(9)
      .font("Helvetica")
      .text(`Date: ${formatDDMonYYYY(jobOrder.jobDate)}`, marginL + offTitleX, titleY + 28, { align: "right", width: contentW });
  }

  const addrTop = 115 + LOGO_OFFSET + offBillingBlockY;
  let leftY = addrTop;
  let rightY = addrTop;

  const labelW = 70;
  const valueX = marginL + labelW + offBillingBlockX;
  const drawLabelRow = (
    label: string,
    value: string,
    xL: number,
    xV: number,
    yPos: number,
    colW: number,
    opts?: { singleLine?: boolean },
  ) => {
    const valueW = colW - labelW;
    const singleLine = opts?.singleLine === true;
    doc.fillColor(DARK).fontSize(9).font("Helvetica").text(`${label} :`, xL, yPos, { width: labelW });
    const textOpts = singleLine ? ({ width: valueW, lineBreak: false } as const) : { width: valueW };
    const h = doc.heightOfString(value, { width: valueW, lineBreak: singleLine ? false : undefined });
    doc.fillColor(DARK).fontSize(9).font("Helvetica").text(value, xV, yPos, textOpts);
    return Math.max(h, 12) + 3;
  };

  if (sectionShows("showBillingBlock", joLay)) {
    const addrValueW = contentW / 2 - 10 - labelW;
    /** Exactly four PDF rows aligned to structured address slots (legacy address maps to line 1). */
    const clientAddressFourLines = clientStructuredAddressFourLines(client);

    if (client?.name) {
      const nameOneLine = client.name.trim();
      leftY += drawLabelRow(
        "Customer",
        nameOneLine,
        marginL + offBillingBlockX,
        valueX,
        leftY,
        contentW / 2 - 10,
        { singleLine: true },
      );
    }
    const hasAnyAddressSlot = clientAddressFourLines.some((s) => s.length > 0);
    if (hasAnyAddressSlot) {
      doc.fillColor(DARK).fontSize(9).font("Helvetica").text("Address :", marginL + offBillingBlockX, leftY, { width: labelW });
      let addrY = leftY;
      let addrBlockH = 0;
      for (const addrLine of clientAddressFourLines) {
        doc.fillColor(DARK).fontSize(9).font("Helvetica").text(addrLine, valueX, addrY, {
          width: addrValueW,
          lineBreak: false,
        });
        const lineH = doc.heightOfString(addrLine, { width: addrValueW, lineBreak: false });
        const step = Math.max(lineH, 12) + 3;
        addrBlockH += step;
        addrY += step;
      }
      leftY += addrBlockH;
    }
    if (client?.contactPerson) {
      leftY += drawLabelRow("Attn", padMinFieldLength(client.contactPerson, 60), marginL + offBillingBlockX, valueX, leftY, contentW / 2 - 10);
    }

    const showIssuerRight =
      joLay?.sections?.showJobOrderIssuerBlock === true;
    /** Right column width (issuer / consultants); matches `rightCol` anchor. */
    const rightBlockW = contentW / 2;
    if (showIssuerRight) {
      doc.fillColor(DARK).fontSize(10).font("Helvetica-Bold").text(companyName, rightCol + offBillingBlockX, rightY, {
        width: rightBlockW,
        align: "right",
      });
      rightY += 14;
      for (const line of companyLines) {
        doc.fillColor(DARK).fontSize(9).font("Helvetica").text(line, rightCol + offBillingBlockX, rightY, {
          width: rightBlockW,
          align: "right",
        });
        rightY += 13;
      }
      if (companyPhone) {
        doc.fillColor(DARK).fontSize(9).font("Helvetica").text(`Tel : ${companyPhone}`, rightCol + offBillingBlockX, rightY, {
          width: rightBlockW,
          align: "right",
        });
        rightY += 13;
      }
      if (companyEmail) {
        doc.fillColor(DARK).fontSize(9).font("Helvetica").text(`Email : ${companyEmail}`, rightCol + offBillingBlockX, rightY, {
          width: rightBlockW,
          align: "right",
        });
        rightY += 13;
      }
    }
  }

  const consultantsLineShown = joLay?.sections?.showConsultantsLine === true;
  const consultantNamesForPdf = consultantNamesOrdered.filter(Boolean);
  if (consultantsLineShown && consultantNamesForPdf.length > 0) {
    const showIssuerRight = joLay?.sections?.showJobOrderIssuerBlock === true;
    const rightBlockW = contentW / 2;
    const colW = rightBlockW;
    const valueW = colW - labelW;
    const consultantsColLeft = rightCol + offBillingBlockX + offConsultantsX;
    const consultantsValueX = consultantsColLeft + labelW;
    /** Same vertical band as client name & address when issuer block is off; below issuer when it is on. */
    const consultantsStartY = (showIssuerRight ? rightY : addrTop) + offConsultantsY;

    doc.fillColor(DARK).fontSize(9).font("Helvetica").text("Consultants :", consultantsColLeft, consultantsStartY, {
      width: labelW,
    });
    let nameY = consultantsStartY;
    for (const name of consultantNamesForPdf) {
      const padded = padMinFieldLength(name, 80);
      doc.fillColor(DARK).fontSize(9).font("Helvetica").text(padded, consultantsValueX, nameY, { width: valueW, lineBreak: false });
      const h = doc.heightOfString(padded, { width: valueW, lineBreak: false });
      nameY += Math.max(h, 12) + 3;
    }
    rightY = Math.max(rightY, nameY + 3);
  }

  const divY = Math.max(leftY, rightY) + 12;
  doc.moveTo(marginL + offLineItemsX, divY).lineTo(marginL + contentW + offLineItemsX, divY).strokeColor("#aaaaaa").lineWidth(0.5).stroke();

  let tableY = divY + 14 + offLineItemsY;
  tableY = renderInvoiceStyleLineTable({
    doc,
    items,
    profile: joLay,
    marginL: marginL + offLineItemsX,
    contentW,
    tableStartY: tableY,
    currencyAmountLabel,
    formatMoney,
    BLACK: DARK,
    GRAY,
  });

  let subtotal = 0;
  for (const item of items) {
    subtotal += (item.quantity ?? 0) * (item.price ?? 0);
  }

  if (sectionShows("showTotals", joLay)) {
    tableY += 4 + offTotalsY;
    doc.moveTo(marginL + contentW * 0.55 + offTotalsX, tableY).lineTo(marginL + contentW + offTotalsX, tableY).strokeColor("#aaaaaa").lineWidth(0.5).stroke();
    tableY += 8;
    doc.fillColor(DARK).fontSize(10).font("Helvetica-Bold").text(formatMoney(subtotal), marginL + offTotalsX, tableY, {
      align: "right",
      width: contentW,
    });
    tableY += 20;
  }

  if (jobOrder.notes) {
    doc.moveTo(marginL + offLineItemsX, tableY).lineTo(marginL + contentW + offLineItemsX, tableY).strokeColor("#aaaaaa").lineWidth(0.5).stroke();
    tableY += 10;
    doc.fillColor(DARK).fontSize(10).font("Helvetica-Bold").text("Notes:", marginL + offLineItemsX, tableY);
    tableY += 14;
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(jobOrder.notes, marginL + offLineItemsX, tableY, { width: contentW });
    tableY += doc.heightOfString(jobOrder.notes, { width: contentW }) + 16;
  }

  if (sectionShows("showSignatures", joLay)) {
    tableY += offSigY + 24;
    doc.fillColor(DARK).fontSize(10).font("Helvetica").text(companyName, marginL + offSigX, tableY);
    doc.fillColor(DARK).fontSize(10).font("Helvetica").text("Official Signature", marginL + offSigX, tableY, {
      align: "right",
      width: contentW,
    });
    tableY += 50;
    doc.moveTo(marginL + contentW * 0.55 + offSigX, tableY).lineTo(marginL + contentW + offSigX, tableY).strokeColor(DARK).lineWidth(0.5).stroke();
  }

  const footerCopy =
    joLay?.footerText?.trim() && joLay.footerText.trim().length > 0
      ? joLay.footerText.trim()
      : "Thank you for your business !";

  if (sectionShows("showFooterAddress", joLay)) {
    doc.fillColor(GRAY).fontSize(9).font("Helvetica-Oblique");
    const { lineY, textY } = pdfFooterLineAndTextY(doc, footerCopy, contentW, { offsetY: offFooterLineY });
    doc.moveTo(marginL + offFooterLineX, lineY).lineTo(marginL + contentW + offFooterLineX, lineY).strokeColor("#cccccc").lineWidth(0.5).stroke();
    doc.fillColor(GRAY).fontSize(9).font("Helvetica-Oblique").text(footerCopy, marginL + offFooterLineX, textY, {
      align: "center",
      width: contentW,
    });
  }
}

export async function streamJobOrderPdfToBuffer(
  jobOrder: typeof jobOrdersTable.$inferSelect & { items: LineItem[] },
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  logoBuffer: Buffer | null,
  headerLogoBuffer: Buffer | null,
  consultantNamesOrdered: string[] = [],
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  await drawJobOrderPdfDoc(
    doc,
    jobOrder,
    client,
    settings,
    logoBuffer,
    headerLogoBuffer,
    consultantNamesOrdered,
  );
  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
}
