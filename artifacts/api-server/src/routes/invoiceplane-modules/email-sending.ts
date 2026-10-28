import {
  clientsTable,
  db,
  invoicesTable,
  quotationsTable,
  receiptsTable,
  type GmailAccount,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { getCompanySettings } from "../../lib/companySettingsCache";
import {
  resolveSender,
  processTemplate,
  sendEmail,
  formatAmount,
  formatDate,
  type SenderSlot,
} from "../../lib/emailHelpers";
import { DEFAULT_EMAIL_TEMPLATES } from "./helpers";
import { logger } from "../../lib/logger";
import { INVOICE_ITEMS, loadLineItems, QUOTATION_ITEMS } from "../../lib/lineItems";
import { currentDataMode } from "../../lib/dataMode";

const router: IRouter = Router();

// ---------- Email Sending (Gmail API) ----------

const EmailBodySchema = z.object({
  to: z.string().email().optional(),
  slot: z.coerce.number().int().min(1).max(2).optional(),
  cc: z.string().email().optional(),
  bcc: z.string().email().optional(),
  contactPersonOverride: z.string().max(500).optional(),
});

/** Build and stream invoice PDF for email attachment */
async function buildInvoicePdfBuffer(invoiceId: string, userId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const [row] = await db
    .select({ inv: invoicesTable, client: clientsTable })
    .from(invoicesTable)
    .leftJoin(clientsTable, and(eq(invoicesTable.clientId, clientsTable.id), eq(clientsTable.userId, userId)))
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.id, invoiceId)));
  if (!row) return null;

  // Reuse the existing PDF building logic by importing from invoiceplane.ts
  // Since PDF generation is complex, we'll import the streamInvoicePdf helper
  const { streamInvoicePdfToBuffer } = await import("../../lib/invoicePdfDraw");
  const settings = await getCompanySettings({ fresh: true });
  const items = await loadLineItems(db, INVOICE_ITEMS, row.inv.id);
  const buffer = await streamInvoicePdfToBuffer({ ...row.inv, items }, row.client, settings);
  return { buffer, filename: `invoice-${row.inv.invoiceNumber}.pdf` };
}

/** Build and stream quotation PDF for email attachment */
async function buildQuotationPdfBuffer(quotationId: string, userId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const [row] = await db
    .select({ q: quotationsTable, client: clientsTable })
    .from(quotationsTable)
    .leftJoin(clientsTable, and(eq(quotationsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId)))
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.id, quotationId)));
  if (!row) return null;

  const { streamQuotationPdfToBuffer } = await import("../invoiceplane-pdf");
  const settings = await getCompanySettings({ fresh: true });
  const items = await loadLineItems(db, QUOTATION_ITEMS, row.q.id);
  const buffer = await streamQuotationPdfToBuffer({ ...row.q, items }, row.client, settings);
  return { buffer, filename: `quotation-${row.q.quotationNumber}.pdf` };
}

/** Build and stream receipt PDF for email attachment */
async function buildReceiptPdfBuffer(receiptId: string, userId: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const [row] = await db
    .select({ r: receiptsTable, inv: invoicesTable, client: clientsTable })
    .from(receiptsTable)
    .leftJoin(invoicesTable, and(eq(receiptsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId)))
    .leftJoin(clientsTable, and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId)))
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.id, receiptId)));
  if (!row) return null;

  const { streamReceiptPdfToBuffer } = await import("../invoiceplane-pdf");
  const settings = await getCompanySettings({ fresh: true });
  const buffer = await streamReceiptPdfToBuffer(row.r, row.inv, row.client, settings);
  return { buffer, filename: `receipt-${row.r.receiptNumber}.pdf` };
}

// POST /invoices/:id/email - Send invoice to client

async function assertNotTestModeForEmail(res: import("express").Response): Promise<boolean> {
  if ((await currentDataMode()) === "test") {
    res.status(403).json({
      error: "Outbound email is disabled while company test mode is on. Turn off test mode to email clients.",
    });
    return false;
  }
  return true;
}

router.post("/invoices/:id/email", async (req, res) => {
  if (!(await assertNotTestModeForEmail(res))) return;
  const userId = (req as unknown as AuthedRequest).userId;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = EmailBodySchema.parse(req.body ?? {});

  const [row] = await db
    .select({ inv: invoicesTable, client: clientsTable })
    .from(invoicesTable)
    .leftJoin(clientsTable, and(eq(invoicesTable.clientId, clientsTable.id), eq(clientsTable.userId, userId)))
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.id, id)));

  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const { inv, client } = row;
  const to = body.to?.trim() || client?.email;
  if (!to) {
    res.status(400).json({ error: "No recipient email — provide 'to' or set client email" });
    return;
  }

  const settings = await getCompanySettings();
  const g1 = settings?.gmailAccount1 as GmailAccount | null;
  const g2 = settings?.gmailAccount2 as GmailAccount | null;
  const sender = resolveSender(g1, g2, (body.slot as SenderSlot) ?? 1);

  if (!sender) {
    res.status(400).json({
      error: "Gmail not connected — use Admin → Email → Email sending (Gmail API) to connect a mailbox.",
    });
    return;
  }

  const templates = settings?.emailTemplates ?? DEFAULT_EMAIL_TEMPLATES;
  const companyName = settings?.companyName || "InvoicePlane";
  const vars = {
    contact_person: client?.contactPerson || client?.name || "",
    invoice_number: inv.invoiceNumber,
    amount: formatAmount(inv.currency, Number(inv.total)),
    invoice_date: formatDate(inv.invoiceDate),
    due_date: formatDate(inv.dueDate || ""),
    company_name: companyName,
    client_name: client?.name || "",
  };
  const processed = processTemplate(templates.invoice, vars);

  try {
    const pdfResult = await buildInvoicePdfBuffer(id, userId);
    if (!pdfResult) {
      res.status(500).json({ error: "Failed to generate invoice PDF" });
      return;
    }

    await sendEmail({
      sender,
      fromName: companyName,
      to,
      subject: processed.subject,
      htmlBody: processed.body,
      attachments: [{ filename: pdfResult.filename, mimeType: "application/pdf", content: pdfResult.buffer }],
    });

    res.json({ ok: true, message: `Invoice sent to ${to}` });
  } catch (err) {
    logger.error({ err, invoiceId: id }, "Failed to send invoice email");
    res.status(500).json({ error: "Failed to send email" });
  }
});

// POST /invoices/:id/email/reminder - Send payment reminder
router.post("/invoices/:id/email/reminder", async (req, res) => {
  if (!(await assertNotTestModeForEmail(res))) return;
  const userId = (req as unknown as AuthedRequest).userId;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = EmailBodySchema.parse(req.body ?? {});

  const [row] = await db
    .select({ inv: invoicesTable, client: clientsTable })
    .from(invoicesTable)
    .leftJoin(clientsTable, and(eq(invoicesTable.clientId, clientsTable.id), eq(clientsTable.userId, userId)))
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.id, id)));

  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const { inv, client } = row;
  const to = body.to?.trim() || client?.email;
  if (!to) {
    res.status(400).json({ error: "No recipient email — provide 'to' or set client email" });
    return;
  }

  const settings = await getCompanySettings();
  const g1 = settings?.gmailAccount1 as GmailAccount | null;
  const g2 = settings?.gmailAccount2 as GmailAccount | null;
  const sender = resolveSender(g1, g2, (body.slot as SenderSlot) ?? 1);

  if (!sender) {
    res.status(400).json({
      error: "Gmail not connected — use Admin → Email → Email sending (Gmail API) to connect a mailbox.",
    });
    return;
  }

  const templates = settings?.emailTemplates ?? DEFAULT_EMAIL_TEMPLATES;
  const companyName = settings?.companyName || "InvoicePlane";
  const amountDue = Math.max(0, Number(inv.total) - Number(inv.paidAmount));
  const vars = {
    contact_person: client?.contactPerson || client?.name || "",
    invoice_number: inv.invoiceNumber,
    amount: formatAmount(inv.currency, amountDue),
    invoice_date: formatDate(inv.invoiceDate),
    due_date: formatDate(inv.dueDate || ""),
    company_name: companyName,
    client_name: client?.name || "",
  };
  const processed = processTemplate(templates.reminder, vars);

  try {
    const pdfResult = await buildInvoicePdfBuffer(id, userId);
    if (!pdfResult) {
      res.status(500).json({ error: "Failed to generate invoice PDF" });
      return;
    }

    await sendEmail({
      sender,
      fromName: companyName,
      to,
      subject: processed.subject,
      htmlBody: processed.body,
      attachments: [{ filename: pdfResult.filename, mimeType: "application/pdf", content: pdfResult.buffer }],
    });

    res.json({ ok: true, message: `Reminder sent to ${to}` });
  } catch (err) {
    logger.error({ err, invoiceId: id }, "Failed to send payment reminder email");
    res.status(500).json({ error: "Failed to send email" });
  }
});

// POST /quotations/:id/email - Send quotation to client
router.post("/quotations/:id/email", async (req, res) => {
  if (!(await assertNotTestModeForEmail(res))) return;
  const userId = (req as unknown as AuthedRequest).userId;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = EmailBodySchema.parse(req.body ?? {});

  const [row] = await db
    .select({ q: quotationsTable, client: clientsTable })
    .from(quotationsTable)
    .leftJoin(clientsTable, and(eq(quotationsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId)))
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.id, id)));

  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }

  const { q, client } = row;
  const to = body.to?.trim() || client?.email;
  if (!to) {
    res.status(400).json({ error: "No recipient email — provide 'to' or set client email" });
    return;
  }

  const settings = await getCompanySettings();
  const g1 = settings?.gmailAccount1 as GmailAccount | null;
  const g2 = settings?.gmailAccount2 as GmailAccount | null;
  const sender = resolveSender(g1, g2, (body.slot as SenderSlot) ?? 1);

  if (!sender) {
    res.status(400).json({
      error: "Gmail not connected — use Admin → Email → Email sending (Gmail API) to connect a mailbox.",
    });
    return;
  }

  const templates = settings?.emailTemplates ?? DEFAULT_EMAIL_TEMPLATES;
  const companyName = settings?.companyName || "InvoicePlane";
  const contactPerson =
    body.contactPersonOverride?.trim() || client?.contactPerson || client?.name || "";
  const vars = {
    contact_person: contactPerson,
    quotation_number: q.quotationNumber,
    amount: formatAmount(q.currency, Number(q.total)),
    quotation_date: formatDate(q.quotationDate),
    company_name: companyName,
    client_name: client?.name || "",
  };
  const processed = processTemplate(templates.quotation, vars);

  try {
    const pdfResult = await buildQuotationPdfBuffer(id, userId);
    if (!pdfResult) {
      res.status(500).json({ error: "Failed to generate quotation PDF" });
      return;
    }

    await sendEmail({
      sender,
      fromName: companyName,
      to,
      subject: processed.subject,
      htmlBody: processed.body,
      attachments: [{ filename: pdfResult.filename, mimeType: "application/pdf", content: pdfResult.buffer }],
    });

    res.json({ ok: true, message: `Quotation sent to ${to}` });
  } catch (err) {
    logger.error({ err, quotationId: id }, "Failed to send quotation email");
    res.status(500).json({ error: "Failed to send email" });
  }
});

// POST /receipts/:id/email - Send receipt to client
router.post("/receipts/:id/email", async (req, res) => {
  if (!(await assertNotTestModeForEmail(res))) return;
  const userId = (req as unknown as AuthedRequest).userId;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = EmailBodySchema.parse(req.body ?? {});

  const [row] = await db
    .select({ r: receiptsTable, inv: invoicesTable, client: clientsTable })
    .from(receiptsTable)
    .leftJoin(invoicesTable, and(eq(receiptsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId)))
    .leftJoin(clientsTable, and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId)))
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.id, id)));

  if (!row) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }

  const { r, client } = row;
  const to = body.to?.trim() || client?.email;
  if (!to) {
    res.status(400).json({ error: "No recipient email — provide 'to' or set client email" });
    return;
  }

  const settings = await getCompanySettings();
  const g1 = settings?.gmailAccount1 as GmailAccount | null;
  const g2 = settings?.gmailAccount2 as GmailAccount | null;
  const sender = resolveSender(g1, g2, (body.slot as SenderSlot) ?? 1);

  if (!sender) {
    res.status(400).json({
      error: "Gmail not connected — use Admin → Email → Email sending (Gmail API) to connect a mailbox.",
    });
    return;
  }

  // Receipts don't have a template, use a default message
  const companyName = settings?.companyName || "InvoicePlane";
  const subject = `Payment Receipt ${r.receiptNumber} from ${companyName}`;
  const htmlBody = `<p>Dear ${client?.contactPerson || client?.name || "Customer"},</p>
<p>Please find your payment receipt <strong>${r.receiptNumber}</strong> attached.</p>
<p>Receipt date: ${formatDate(r.receiptDate)}<br/>
Amount: ${formatAmount(r.currency, Number(r.amount))}</p>
<p>Regards,<br/>${companyName}</p>`;

  try {
    const pdfResult = await buildReceiptPdfBuffer(id, userId);
    if (!pdfResult) {
      res.status(500).json({ error: "Failed to generate receipt PDF" });
      return;
    }

    await sendEmail({
      sender,
      fromName: companyName,
      to,
      subject,
      htmlBody,
      attachments: [{ filename: pdfResult.filename, mimeType: "application/pdf", content: pdfResult.buffer }],
    });

    res.json({ ok: true, message: `Receipt sent to ${to}` });
  } catch (err) {
    logger.error({ err, receiptId: id }, "Failed to send receipt email");
    res.status(500).json({ error: "Failed to send email" });
  }
});

export default router;
