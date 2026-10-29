import { randomUUID } from "crypto";
import { z as zz } from "zod";
import {
  clientsTable,
  companySettingsTable,
  consultantsTable,
  db,
  invoicesTable,
  jobOrdersTable,
  quotationsTable,
  receiptsTable,
  type LineItem,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import { streamInvoicePdfToBuffer } from "../../lib/invoicePdfDraw";
import {
  streamQuotationPdfToBuffer,
  streamReceiptPdfToBuffer,
} from "../../lib/quotationReceiptPdfDraw";
import { streamJobOrderPdfToBuffer } from "../../lib/jobOrderPdfDraw";
import { mergePdfDocumentLayouts, patchPdfDocumentLayouts, type PdfLayoutBranding } from "../../lib/pdfLayoutProfile";
import { fetchImageBuffer } from "../../lib/fetchImageBuffer";
import { imageBufferAspectRatio } from "../../lib/imageBufferAspectRatio";
import { getCompanySettings, invalidateCompanySettingsCache } from "../../lib/companySettingsCache";
import { setPdfDownloadHeaders } from "../../lib/pdfResponseHeaders";
import { calculateTotals, money, today } from "./helpers";
import { logger } from "../../lib/logger";
import { layoutRateLimiter, previewRateLimiter } from "../../lib/rateLimit";

const router: IRouter = Router();

/**
 * Header banner width ÷ height for a settings row, when the image is
 * reachable. Narrows the section's page-edge bounds to the visible artwork
 * (matches the layout canvas) so a stored horizontal offset isn't clamped
 * back down against the wider full-content-width fallback.
 */
async function brandingWithHeaderAspect(
  settings: typeof companySettingsTable.$inferSelect,
): Promise<PdfLayoutBranding> {
  const headerLogoBuffer = settings.headerLogoUrl
    ? await fetchImageBuffer(settings.headerLogoUrl).catch(() => null)
    : null;
  const headerBannerAspectRatio = await imageBufferAspectRatio(headerLogoBuffer);
  return { ...settings, headerBannerAspectRatio };
}

const PdfDocumentLayoutsPatchSchema = zz.record(zz.record(zz.any()));
router.get("/pdf-document-layouts", layoutRateLimiter, async (_req, res) => {
  const row = await getCompanySettings();
  if (!row) {
    res.json({});
    return;
  }
  const branding = await brandingWithHeaderAspect(row);
  res.json(mergePdfDocumentLayouts(row.pdfDocumentLayouts ?? {}, branding));
});

router.patch("/pdf-document-layouts", layoutRateLimiter, requireAdmin, async (req, res) => {
  const parsed = PdfDocumentLayoutsPatchSchema.parse(req.body ?? {});
  const [current] = await db.select().from(companySettingsTable);
  if (!current) {
    res.status(500).json({ error: "Company settings row missing" });
    return;
  }
  const branding = await brandingWithHeaderAspect(current);
  const merged = patchPdfDocumentLayouts(
    mergePdfDocumentLayouts(current.pdfDocumentLayouts ?? {}, branding),
    parsed as Record<string, unknown>,
    branding,
  );
  const [row] = await db
    .update(companySettingsTable)
    .set({ pdfDocumentLayouts: merged as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(companySettingsTable.id, current.id))
    .returning();
  invalidateCompanySettingsCache();
  res.json(mergePdfDocumentLayouts(row!.pdfDocumentLayouts ?? {}, branding));
});

const PdfLayoutPreviewBody = zz.object({
  kind: zz.enum(["invoice", "quotation", "jobOrder", "receipt"]),
  /** Single-document layout profile (merged over saved layouts for this preview only). */
  profile: zz.record(zz.any()),
});

/** Generate a sample PDF reflecting the editor draft (does not persist). */
router.post("/pdf-document-layouts/preview", previewRateLimiter, async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const MAX_PREVIEW_JOB_CONSULTANTS = 3;
  const body = PdfLayoutPreviewBody.parse(req.body ?? {});
  const [current] = await db.select().from(companySettingsTable);
  if (!current) {
    res.status(500).json({ error: "Company settings row missing" });
    return;
  }
  const previewBranding = await brandingWithHeaderAspect(current);
  const mergedLayouts = patchPdfDocumentLayouts(
    mergePdfDocumentLayouts(current.pdfDocumentLayouts ?? {}, previewBranding),
    { [body.kind]: body.profile } as Record<string, unknown>,
    previewBranding,
  );
  const settingsForPreview = {
    ...current,
    pdfDocumentLayouts: mergedLayouts as Record<string, unknown>,
  };

  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.userId, userId))
    .limit(1);
  if (!client) {
    res.status(400).json({ error: "Add a client to render a sample PDF preview." });
    return;
  }

  const previewConsultants = await db
    .select({ id: consultantsTable.id, name: consultantsTable.name })
    .from(consultantsTable)
    .limit(MAX_PREVIEW_JOB_CONSULTANTS);

  const todayStr = today();
  const items: LineItem[] = [
    { name: "Professional services", description: "Sample description line.", quantity: 2, price: 150.5, taxRate: 0 },
    { name: "Materials & supplies", quantity: 1, price: 320, taxRate: 6 },
  ];
  const totals = calculateTotals(items, 0);

  try {
    if (body.kind === "invoice") {
      const invoiceSample = {
        id: randomUUID(),
        userId,
        clientId: client.id,
        invoiceNumber: "PREVIEW-INV",
        invoiceDate: todayStr,
        dueDate: today(14),
        status: "sent",
        statusBeforePaid: null,
        currency: "HKD",
        items,
        subtotal: money(totals.subtotal),
        taxAmount: money(totals.taxAmount),
        discountAmount: money(totals.discountAmount),
        total: money(totals.total),
        paidAmount: money(Math.min(totals.total * 0.3, totals.total)),
        serviceCategory: "others",
        cancellationReason: null,
        notes: null,
        internalNote: null,
        termsConditions: null,
        remark: null,
        shareToken: null,
        shareTokenExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as typeof invoicesTable.$inferSelect & { items: LineItem[] };
      const buffer = await streamInvoicePdfToBuffer(invoiceSample, client, settingsForPreview);
      setPdfDownloadHeaders(res, 'inline; filename="layout-preview-invoice.pdf"');
      res.send(buffer);
      return;
    }

    if (body.kind === "quotation") {
      const quotationSample = {
        id: randomUUID(),
        userId,
        clientId: client.id,
        quotationNumber: "PREVIEW-QT",
        quotationDate: todayStr,
        validUntil: today(30),
        status: "draft",
        currency: "HKD",
        items,
        subtotal: money(totals.subtotal),
        discountAmount: money(totals.discountAmount),
        total: money(totals.total),
        serviceCategory: "others",
        convertedInvoiceId: null,
        cancellationReason: null,
        termsConditions:
          "Sample terms: payment within 14 days of acceptance. This PDF is for layout preview only.",
        remark: "Sample remark text for layout preview.",
        quotationAttn: "Sample attention line",
        shareToken: null,
        shareTokenExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as typeof quotationsTable.$inferSelect & { items: LineItem[] };
      const buffer = await streamQuotationPdfToBuffer(quotationSample, client, settingsForPreview);
      setPdfDownloadHeaders(res, 'inline; filename="layout-preview-quotation.pdf"');
      res.send(buffer);
      return;
    }

    if (body.kind === "jobOrder") {
      const consultantNamesForPreview =
        previewConsultants.length > 0
          ? previewConsultants.map((c) => c.name)
          : ["Sample Consultant A", "Sample Consultant B"];
      const joSample = {
        id: randomUUID(),
        userId,
        clientId: client.id,
        jobOrderNumber: "PREVIEW-JO",
        jobDate: todayStr,
        status: "draft",
        sourceType: null,
        sourceId: null,
        items,
        notes: "Sample job order notes for layout preview.",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as typeof jobOrdersTable.$inferSelect & { items: LineItem[] };
      const [logoBuffer, headerLogoBuffer] = await Promise.all([
        settingsForPreview?.logoUrl ? fetchImageBuffer(settingsForPreview.logoUrl) : Promise.resolve(null),
        settingsForPreview?.headerLogoUrl ? fetchImageBuffer(settingsForPreview.headerLogoUrl) : Promise.resolve(null),
      ]);
      const buffer = await streamJobOrderPdfToBuffer(
        joSample,
        client,
        settingsForPreview,
        logoBuffer,
        headerLogoBuffer,
        consultantNamesForPreview,
      );
      setPdfDownloadHeaders(res, 'inline; filename="layout-preview-job-order.pdf"');
      res.send(buffer);
      return;
    }

    const receiptSample = {
      id: randomUUID(),
      userId,
      receiptNumber: `REC-PV-${randomUUID().slice(0, 8)}`,
      invoiceId: randomUUID(),
      clientId: client.id,
      amount: money(totals.total),
      currency: "HKD",
      chequeNumber: "000123456",
      chequeDetails: "Sample cheque / deposit details for preview",
      receiptDate: todayStr,
      notes: "Sample receipt notes for layout preview.",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof receiptsTable.$inferSelect;
    const buffer = await streamReceiptPdfToBuffer(receiptSample, null, client, settingsForPreview);
    setPdfDownloadHeaders(res, 'inline; filename="layout-preview-receipt.pdf"');
    res.send(buffer);
  } catch (e) {
    logger.error({ err: e }, "PDF layout preview failed");
    res.status(500).json({ error: "Preview failed" });
  }
});

export default router;
