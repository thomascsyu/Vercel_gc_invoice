import PDFDocument from "pdfkit";
import {
  clientsTable,
  companySettingsTable,
  consultantsTable,
  proposalDocumentsTable,
  type ProposalConsultantPortfolioItem,
  type ProposalJobReference,
  type ProposalPhase,
  type ProposalPaymentScheduleItem,
  type ProposalTestimonial,
} from "@workspace/db";
import { fetchImageBuffer } from "./fetchImageBuffer";
import { companyChopScaleColumns, companyChopStoredUrl } from "./companyChop";
import { logoScaleFactor } from "./logoScale";
import { pdfFooterLineAndTextY } from "./pdfFooterPosition";
import {
  OUR_CLIENTS_TAGLINE,
  TEAM_SECTION_INTRO,
  APPROACH_SECTION_INTRO,
} from "./proposalTemplateLibrary";
import {
  buildProposalTemplateContext,
  renderApproachPhase,
} from "./proposalTemplateVars";

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function formatMoney(currency: string, v: number): string {
  return `${currency} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
}

const HEADER_BG = "#B8D4E8";
const BAR_COLOR = "#1E3A5F";
const GRAY = "#555555";
const BRAND = "#1E3A5F";

function drawGanttChart(
  doc: InstanceType<typeof PDFDocument>,
  phases: ProposalPhase[],
  x: number,
  y: number,
  width: number,
): number {
  const totalMonths = 6;
  const rowH = 22;
  const headerH = 28;
  const labelW = width * 0.38;
  const monthW = (width - labelW) / totalMonths;

  doc.save();
  doc.rect(x, y, width, headerH).fill(HEADER_BG);
  doc.fillColor("#333333").fontSize(8).font("Helvetica-Bold");
  doc.text("Phase", x + 6, y + 14, { width: labelW - 12 });
  for (let m = 1; m <= totalMonths; m++) {
    doc.text(String(m), x + labelW + (m - 1) * monthW, y + 10, { width: monthW, align: "center" });
  }

  let cy = y + headerH;
  for (const phase of phases) {
    doc.rect(x, cy, width, rowH).stroke("#cccccc");
    doc.fillColor("#000000").fontSize(7).font("Helvetica");
    doc.text(phase.title || `Phase ${phase.phase}`, x + 6, cy + 7, { width: labelW - 12 });
    for (let m = 1; m <= totalMonths; m++) {
      const cellX = x + labelW + (m - 1) * monthW;
      if (m >= phase.startMonth && m < phase.startMonth + phase.spanMonths) {
        doc.rect(cellX + 2, cy + 4, monthW - 4, rowH - 8).fill(BAR_COLOR);
      }
    }
    cy += rowH;
  }
  doc.restore();
  return cy - y + 8;
}

function ensureSpace(doc: InstanceType<typeof PDFDocument>, needed: number, marginTop = 50): void {
  if (doc.y + needed > doc.page.height - 70) {
    doc.addPage();
    doc.y = marginTop;
  }
}

function sectionHeading(doc: InstanceType<typeof PDFDocument>, title: string): void {
  ensureSpace(doc, 40);
  doc.fillColor("#000000").fontSize(12).font("Helvetica-Bold").text(title, 50, doc.y, { width: doc.page.width - 100 });
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10);
}

/** Guard against PDFKit auto-pagination when drawing footers inside `pageAdded`. */
let drawingInnerPageFooter = false;

function drawInnerPageFooter(
  doc: InstanceType<typeof PDFDocument>,
  vars: Record<string, string>,
): void {
  if (drawingInnerPageFooter) return;
  drawingInnerPageFooter = true;
  try {
    const savedY = doc.y;
    const contentW = doc.page.width - 100;
    const contact = [vars["consultant.phone"], vars["consultant.email"], vars["consultant.website"]]
      .filter(Boolean)
      .join(" / ");
    const footerLine = `${vars["service.standards_short_display"]} Consultancy Service Proposal by ${vars["consultant.company_name"]} ${vars["proposal.revision"]}`;
    const footerCopy = [contact, footerLine].filter(Boolean).join("\n");
    const { textY } = pdfFooterLineAndTextY(doc, footerCopy, contentW);
    doc.fontSize(7).fillColor(GRAY).font("Helvetica");
    doc.text(footerCopy, 50, textY, { width: contentW, align: "center", lineBreak: false });
    doc.y = savedY;
  } finally {
    drawingInnerPageFooter = false;
  }
}

function bodyText(doc: InstanceType<typeof PDFDocument>, text: string, contentW: number): void {
  doc.fillColor("#000000").fontSize(10).font("Helvetica").text(text, { width: contentW });
}

export async function drawProposalPdfDoc(
  doc: InstanceType<typeof PDFDocument>,
  proposal: typeof proposalDocumentsTable.$inferSelect,
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  consultants: (typeof consultantsTable.$inferSelect)[],
): Promise<void> {
  const marginL = 50;
  const pageW = doc.page.width;
  const contentW = pageW - 100;

  const ctx = buildProposalTemplateContext({ proposal, client, settings, consultants });
  const { vars, standards, templateData, showCertificationBody, showOptionalMaintenance, showCertificationFees } = ctx;

  const showChop = settings?.proposalShowChop !== false;
  const chopUrl = showChop ? companyChopStoredUrl(settings) : null;
  const [coverPhoto, logoBuffer, chopBuffer, cbLogoBuffer] = await Promise.all([
    proposal.coverPhotoUrl ? fetchImageBuffer(proposal.coverPhotoUrl) : Promise.resolve(null),
    settings?.logoUrl ? fetchImageBuffer(settings.logoUrl) : Promise.resolve(null),
    chopUrl ? fetchImageBuffer(chopUrl) : Promise.resolve(null),
    templateData.certificationBody?.logoUrl
      ? fetchImageBuffer(templateData.certificationBody.logoUrl)
      : Promise.resolve(null),
  ]);

  const cs = logoScaleFactor(settings?.companyLogoScale);
  const ss = logoScaleFactor(companyChopScaleColumns(settings));
  const portfolio = (proposal.consultantPortfolio ?? []) as ProposalConsultantPortfolioItem[];
  const portfolioById = new Map(portfolio.map((p) => [p.consultantId, p]));
  const portfolioPhotos = await Promise.all(
    portfolio.filter((p) => p.photoUrl).map(async (p) => ({
      consultantId: p.consultantId,
      buffer: await fetchImageBuffer(p.photoUrl!),
    })),
  );
  const photoByConsultantId = new Map(
    portfolioPhotos.filter((p) => p.buffer).map((p) => [p.consultantId, p.buffer!]),
  );

  doc.on("pageAdded", () => drawInnerPageFooter(doc, vars));

  // ---- 1. Cover page ----
  if (logoBuffer) {
    doc.image(logoBuffer, marginL, 40, { fit: [120 * cs, 45 * cs] });
  }

  const photoY = 100;
  const photoH = 180;
  if (coverPhoto) {
    doc.image(coverPhoto, marginL, photoY, { fit: [contentW, photoH], align: "center", valign: "center" });
  } else {
    doc.rect(marginL, photoY, contentW, photoH).fill("#e8eef3");
    doc.fillColor(GRAY).fontSize(11).text("Consulting Proposal", marginL, photoY + photoH / 2 - 6, { width: contentW, align: "center" });
  }

  let cy = photoY + photoH + 24;
  doc.fillColor("#000000").fontSize(20).font("Helvetica-Bold").text("CONSULTING PROPOSAL", marginL, cy, { width: contentW, align: "center" });
  cy += 28;
  doc.fontSize(11).font("Helvetica-Bold").text(vars["proposal.title"], marginL, cy, { width: contentW, align: "center" });
  cy += 20;
  doc.fontSize(10).font("Helvetica");
  doc.text(`Proposal No. ${vars["proposal.number"]} ${vars["proposal.revision"]}`, marginL, cy, { width: contentW, align: "center" });
  cy += 28;
  doc.font("Helvetica-Bold").text("Prepared for:", marginL, cy, { width: contentW, align: "center" });
  cy += 14;
  if (vars["client.contact_name"]) {
    doc.font("Helvetica").text(vars["client.contact_name"], marginL, cy, { width: contentW, align: "center" });
    cy += 14;
  }
  doc.font("Helvetica-Bold").text(vars["client.company_name"], marginL, cy, { width: contentW, align: "center" });
  cy += 24;
  doc.font("Helvetica").text(`Proposal Issued:\n${vars["proposal.issue_date"]}`, marginL, cy, { width: contentW / 2 - 10, align: "center" });
  doc.text(`Proposal Valid To:\n${vars["proposal.valid_until"]}`, marginL + contentW / 2 + 10, cy, { width: contentW / 2 - 10, align: "center" });
  if (vars["sales_contact.name"]) {
    cy += 40;
    doc.fontSize(9).text(
      `Contact: ${vars["sales_contact.name"]}${vars["sales_contact.title"] ? `, ${vars["sales_contact.title"]}` : ""}${vars["sales_contact.phone"] ? `\n${vars["sales_contact.phone"]}` : ""}${vars["sales_contact.email"] ? ` · ${vars["sales_contact.email"]}` : ""}`,
      marginL,
      cy,
      { width: contentW, align: "center" },
    );
  }

  // ---- 2. Company profile ----
  doc.addPage();
  doc.y = 50;
  sectionHeading(doc, "The Company");
  bodyText(doc, ctx.companyProfile, contentW);
  if (ctx.serviceList) {
    doc.moveDown(0.5);
    doc.fontSize(9).text(`Services include: ${ctx.serviceList}`, { width: contentW });
  }
  doc.moveDown(1);

  // ---- 3. Team ----
  sectionHeading(doc, "The Team");
  bodyText(doc, TEAM_SECTION_INTRO, contentW);
  doc.moveDown(0.5);
  const portfolioEntries = consultants.map((c) => ({
    consultant: c,
    entry: portfolioById.get(c.id),
  }));
  for (const { consultant, entry } of portfolioEntries) {
    ensureSpace(doc, 90);
    const photo = photoByConsultantId.get(consultant.id);
    const blockY = doc.y;
    if (photo) doc.image(photo, marginL, blockY, { fit: [60, 60] });
    const textX = photo ? marginL + 70 : marginL;
    doc.fillColor("#000000").fontSize(10).font("Helvetica-Bold").text(consultant.name, textX, blockY, { width: contentW - (photo ? 70 : 0) });
    if (entry?.bio?.trim()) {
      doc.font("Helvetica").fontSize(9).text(entry.bio.trim(), textX, doc.y + 4, { width: contentW - (photo ? 70 : 0) });
    }
    doc.moveDown(0.75);
  }
  doc.moveDown(0.5);

  // ---- 4. Certification body (conditional) ----
  if (showCertificationBody) {
    const cb = templateData.certificationBody!;
    sectionHeading(doc, `Certification Body - ${cb.shortName || cb.name || "Certification Body"}`);
    if (cbLogoBuffer) {
      doc.image(cbLogoBuffer, marginL, doc.y, { fit: [80, 40] });
      doc.moveDown(3);
    }
    if (cb.description?.trim() || proposal.certificationBodyIntro?.trim()) {
      bodyText(doc, cb.description?.trim() || proposal.certificationBodyIntro!.trim(), contentW);
    }
    if (cb.accreditationName?.trim()) {
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").text(cb.accreditationName, { width: contentW });
      if (cb.accreditationDescription?.trim()) {
        doc.font("Helvetica").text(cb.accreditationDescription.trim(), { width: contentW });
      }
    }
    doc.moveDown(1);
  }

  // ---- 5. ISO benefits (conditional) ----
  for (const std of standards) {
    sectionHeading(doc, `Benefit of ${std.code}`);
    doc.fontSize(10).font("Helvetica-Bold").text(`${std.code}:${std.version} — ${std.systemName}`, { width: contentW });
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(9);
    for (const benefit of std.benefits) {
      doc.text(`• ${benefit}`, { width: contentW });
    }
    doc.moveDown(1);
  }

  // ---- 6. Introduction / scope ----
  sectionHeading(doc, "Introduction");
  bodyText(doc, ctx.introduction, contentW);
  doc.moveDown(1);

  // ---- 7. Consultancy approach ----
  const phases = (proposal.scopePhases ?? []) as ProposalPhase[];
  sectionHeading(doc, "The Approach");
  bodyText(doc, APPROACH_SECTION_INTRO, contentW);
  doc.moveDown(0.5);
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const rendered = renderApproachPhase(i, vars, {
      title: phase.title,
      description: phase.description,
      deliverable: phase.deliverable,
    });
    ensureSpace(doc, 80);
    doc.font("Helvetica-Bold").fontSize(10).text(`Phase ${i + 1}: ${rendered.title}`, { width: contentW });
    doc.moveDown(0.25);
    for (const block of rendered.blocks) {
      doc.font("Helvetica-Bold").fontSize(9).text(`${block.label}:`, { continued: false, width: contentW });
      doc.font("Helvetica").text(block.text, { width: contentW });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.5);
  }

  // ---- 8. Project timeline ----
  if (phases.length) {
    sectionHeading(doc, `Project Timeline for ${vars["service.standards_short_display"]}`);
    ensureSpace(doc, 30 + phases.length * 22 + 28);
    const ganttH = drawGanttChart(doc, phases, marginL, doc.y, contentW);
    doc.y += ganttH;
    doc.moveDown(1);
  }

  // ---- 9. Optional maintenance (conditional) ----
  if (showOptionalMaintenance) {
    sectionHeading(doc, "Optional Maintenance Service");
    for (const line of ctx.optionalMaintenance) {
      bodyText(doc, line, contentW);
      doc.moveDown(0.35);
    }
    doc.moveDown(0.5);
  }

  // PM tools & training (legacy optional blocks)
  if (proposal.pmToolsIntro?.trim()) {
    sectionHeading(doc, "Project Management Tools");
    bodyText(doc, proposal.pmToolsIntro.trim(), contentW);
    doc.moveDown(1);
  }
  if (proposal.trainingPlatformIntro?.trim()) {
    sectionHeading(doc, "Training Platform");
    bodyText(doc, proposal.trainingPlatformIntro.trim(), contentW);
    doc.moveDown(1);
  }

  // ---- 10. Client references ----
  const jobReferences = (proposal.jobReferences ?? []) as ProposalJobReference[];
  const testimonials = (proposal.testimonials ?? []) as ProposalTestimonial[];
  if (jobReferences.length || testimonials.length) {
    sectionHeading(doc, "Our Clients");
    bodyText(doc, OUR_CLIENTS_TAGLINE, contentW);
    doc.moveDown(0.75);
  }

  if (jobReferences.length) {
    const jobRefPhotos = await Promise.all(
      jobReferences.map(async (ref, idx) => ({
        idx,
        buffer: ref.photoUrl ? await fetchImageBuffer(ref.photoUrl) : null,
      })),
    );
    const jobRefPhotoByIdx = new Map(jobRefPhotos.filter((p) => p.buffer).map((p) => [p.idx, p.buffer!]));
    for (const [idx, ref] of jobReferences.entries()) {
      ensureSpace(doc, 90);
      const photo = jobRefPhotoByIdx.get(idx);
      const blockY = doc.y;
      if (photo) doc.image(photo, marginL, blockY, { fit: [120, 80] });
      const textX = photo ? marginL + 132 : marginL;
      const textW = contentW - (photo ? 132 : 0);
      doc.fillColor(BRAND).fontSize(11).font("Helvetica-Bold").text(ref.clientName, textX, blockY, { width: textW });
      doc.fillColor("#000000").fontSize(9).font("Helvetica").text(ref.projectTitle, textX, doc.y + 2, { width: textW });
      if (ref.description?.trim()) doc.fontSize(8).text(ref.description.trim(), textX, doc.y + 4, { width: textW });
      doc.y = Math.max(doc.y, blockY + (photo ? 80 : 0)) + 10;
    }
  }

  if (testimonials.length) {
    const testimonialPhotos = await Promise.all(
      testimonials.map(async (t, idx) => ({
        idx,
        buffer: t.photoUrl ? await fetchImageBuffer(t.photoUrl) : null,
      })),
    );
    const testimonialPhotoByIdx = new Map(testimonialPhotos.filter((p) => p.buffer).map((p) => [p.idx, p.buffer!]));
    for (const [idx, t] of testimonials.entries()) {
      ensureSpace(doc, 80);
      const photo = testimonialPhotoByIdx.get(idx);
      const blockY = doc.y;
      const avatarSize = 52;
      if (photo) {
        doc.save();
        doc.circle(marginL + avatarSize / 2, blockY + avatarSize / 2, avatarSize / 2).clip();
        doc.image(photo, marginL, blockY, { fit: [avatarSize, avatarSize] });
        doc.restore();
        doc.circle(marginL + avatarSize / 2, blockY + avatarSize / 2, avatarSize / 2).lineWidth(0.5).stroke("#cccccc");
      }
      const textX = photo ? marginL + avatarSize + 12 : marginL;
      const textW = contentW - (photo ? avatarSize + 12 : 0);
      const quote = t.quote?.trim() ?? "";
      if (quote) {
        doc.fillColor("#000000").font("Helvetica-Oblique").fontSize(9).text(`"${quote}"`, textX, blockY, { width: textW });
      }
      if (t.companyName?.trim()) {
        doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND).text(t.companyName.trim(), textX, doc.y + 6, { width: textW });
      }
      const attribution = [t.authorName, t.authorTitle?.trim()].filter(Boolean).join(", ");
      doc.fillColor(GRAY).font("Helvetica").fontSize(8).text(attribution, textX, doc.y + 4, { width: textW });
      doc.y = Math.max(doc.y, blockY + (photo ? avatarSize : 0)) + 12;
    }
  }

  // ---- 11. Terms & conditions ----
  sectionHeading(doc, "Terms & Conditions");
  doc.fontSize(9).text(ctx.terms, { width: contentW });
  doc.moveDown(1);
  doc.fontSize(10);

  // ---- 12. Acceptance of proposal ----
  sectionHeading(doc, "Acceptance of Proposal");
  bodyText(
    doc,
    `The table below shows the major items of the proposal No. ${vars["proposal.number"]} ${vars["proposal.revision"]} dated ${vars["proposal.issue_date"]}.`,
    contentW,
  );
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").text(`${vars["service.standards_short_display"]}`, { width: contentW });
  doc.text("Consultancy Service and Certification Fee", { width: contentW });
  doc.moveDown(0.5);

  const feeRows = templateData.feeRows ?? [];
  if (feeRows.length) {
    const cols = showCertificationFees ? 3 : 2;
    const colW = contentW / cols;
    doc.fontSize(8).font("Helvetica-Bold");
    doc.text("Year", marginL, doc.y, { width: colW, continued: true });
    doc.text("Consultancy Fee", { width: colW, continued: true });
    if (showCertificationFees) doc.text("Certification Fee", { width: colW });
    else doc.text("", { width: 0 });
    doc.moveDown(0.5);
    doc.font("Helvetica");
    for (const row of feeRows) {
      doc.text(row.year, marginL, doc.y, { width: colW, continued: true });
      doc.text(row.consultancyFee != null ? formatMoney(proposal.currency, row.consultancyFee) : "—", { width: colW, continued: true });
      if (showCertificationFees) {
        doc.text(row.certificationFee != null ? formatMoney(proposal.currency, row.certificationFee) : "—", { width: colW });
      } else doc.text("", { width: 0 });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.5);
  } else {
    doc.font("Helvetica-Bold").text("Consultancy Fee", { width: contentW });
    doc.font("Helvetica").text(formatMoney(proposal.currency, toNumber(proposal.totalAmount)), { width: contentW });
    doc.moveDown(0.5);
  }

  const schedule = (proposal.paymentSchedule ?? []) as ProposalPaymentScheduleItem[];
  if (schedule.length) {
    doc.font("Helvetica-Bold").text("Payment Schedule", { width: contentW });
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(9);
    for (const [i, row] of schedule.entries()) {
      const amt = (toNumber(proposal.totalAmount) * (row.percentage || 0)) / 100;
      doc.text(`Phase ${i + 1}: ${row.label} — ${row.percentage}% (${formatMoney(proposal.currency, amt)})`, { width: contentW });
    }
    doc.moveDown(0.5);
    doc.fontSize(10);
  }

  // ---- 13. Signature page ----
  ensureSpace(doc, 120);
  sectionHeading(doc, "Signing");
  const sigY = doc.y + 10;
  doc.fontSize(10).font("Helvetica").text("For and on behalf of", marginL, sigY);
  doc.font("Helvetica-Bold").text(vars["client.company_name"], marginL, sigY + 14);
  doc.font("Helvetica").fontSize(9).text("Authorised Signature", marginL, sigY + 50);
  if (proposal.clientSignatureName) {
    doc.font("Helvetica-Bold").fontSize(10).text(proposal.clientSignatureName, marginL, sigY + 66);
  } else {
    doc.moveTo(marginL, sigY + 70).lineTo(marginL + 200, sigY + 70).stroke();
  }

  doc.fontSize(10).font("Helvetica").text("For and on behalf of", pageW / 2, sigY);
  doc.font("Helvetica-Bold").text(vars["consultant.company_name"], pageW / 2, sigY + 14);
  if (chopBuffer) {
    doc.image(chopBuffer, pageW / 2, sigY + 30, { fit: [100 * ss, 60 * ss] });
  } else {
    doc.moveTo(pageW / 2, sigY + 70).lineTo(pageW / 2 + 200, sigY + 70).stroke();
  }

  drawInnerPageFooter(doc, vars);
}

export async function streamProposalPdfToBuffer(
  proposal: typeof proposalDocumentsTable.$inferSelect,
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  consultants: (typeof consultantsTable.$inferSelect)[],
): Promise<{ buffer: Buffer; filename: string }> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  await drawProposalPdfDoc(doc, proposal, client, settings, consultants);
  doc.end();
  const buffer = await done;
  const revision = `R${proposal.proposalRevision}`;
  const filename = `Proposal_${proposal.proposalNo}_${revision}.pdf`;
  return { buffer, filename };
}

export async function streamProposalPdf(
  proposal: typeof proposalDocumentsTable.$inferSelect,
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  consultants: (typeof consultantsTable.$inferSelect)[],
  res: import("express").Response,
): Promise<void> {
  const { buffer, filename } = await streamProposalPdfToBuffer(proposal, client, settings, consultants);
  const { setPdfDownloadHeaders } = await import("./pdfResponseHeaders");
  setPdfDownloadHeaders(res, `inline; filename="${filename}"`);
  res.send(buffer);
}
