import { GetInvoiceParams, GetQuotationParams } from "@workspace/api-zod";
import { clientsTable, db, invoicesTable, quotationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { joinInvoiceClientSameMode, joinQuotationClientSameMode } from "../../lib/clientJoins";
import { streamInvoicePdf } from "../../lib/invoicePdfDraw";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { streamQuotationPdf } from "./helpers";
import { INVOICE_ITEMS, loadLineItems, QUOTATION_ITEMS } from "../../lib/lineItems";
import { timingSafeEqualString } from "../../lib/timingSafeEqualString";
import { publicRateLimitGate } from "../../lib/rateLimit";

/**
 * Routes registered before `router.use(requireAuth)` in index.ts: CSV import
 * templates and the two public share-link PDF routes. These must stay
 * reachable without a session, so they are mounted un-gated.
 *
 * Rate-limit with `publicRateLimitGate`, not `publicRateLimiter` directly.
 * This router is mounted ahead of the authenticated Clients/Invoices/… routers,
 * so a bare limiter here would count those staff requests against the public
 * budget and the Clients list would return HTTP 429.
 */
const router: IRouter = Router();
router.use(publicRateLimitGate);

router.get("/clients/import/template", (_req, res) => {
  const csv = [
    "name,email,clientCode,phone,addressLine1,addressLine2,addressLine3,addressLine4,country,contactPerson",
    "# Only 'name' is required. 'clientCode' and 'email' are optional.",
    "# Duplicate company names will be skipped (or overwritten if enabled)",
    `Acme Corporation,billing@acme.com,ACM001,+852 1234 5678,123 Main Street,Floor 5,,,HK,Jane Smith`,
    `Tech Solutions Ltd,info@techsolutions.com,,+852 8765 4321,456 Business Ave,Suite 200,,,HK,Michael Chen`,
  ].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="clients-template.csv"');
  res.send(csv);
});

router.get("/invoices/import/template", (_req, res) => {
  /** Currency always defaults to HKD; use clientId/clientCode instead of Client name if it's ambiguous. */
  const csv = [
    "Invoice Number,Client name,Invoice Amount,Invoice Date,item1,item2",
    "INV-0001,Acme Corporation,1000,2026-04-17,First line of service,Another line item",
  ].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="invoices-template.csv"');
  res.send(csv);
});

router.get("/quotations/import/template", (_req, res) => {
  const itemsCell = `"${JSON.stringify([
    { name: "Consulting Service", quantity: 1, price: 1000, taxRate: 0 },
    { name: "Report Writing", quantity: 2, price: 500, taxRate: 0 },
  ]).replace(/"/g, '""')}"`;
  const csv = [
    "clientId,quotationDate,validUntil,currency,discountAmount,quotationAttn,items",
    `<client-uuid>,2026-04-17,2026-05-17,HKD,0,,${itemsCell}`,
  ].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="quotations-template.csv"');
  res.send(csv);
});

router.get("/payments/import/template", (_req, res) => {
  const csv = [
    "invoiceId,amount,paymentDate,paymentMethod,note",
    "<invoice-uuid>,1500.00,2026-04-17,bank_transfer,Monthly retainer",
  ].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="payments-template.csv"');
  res.send(csv);
});

// job-orders template is here (rather than invoiceplane-modules) because
// router.use(requireAuth) in this router runs before invoiceplane-modules.ts
// is reached; public templates must be declared here.
router.get("/job-orders/import/template", (_req, res) => {
  const csv = [
    "clientId,jobDate,status,notes",
    "<client-uuid>,2026-04-17,draft,Installation at client site",
  ].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="job-orders-template.csv"');
  res.send(csv);
});

router.get("/invoices/:id/pdf/public", async (req, res) => {
  const { id } = GetInvoiceParams.parse(req.params);
  const token = typeof req.query.token === "string" ? req.query.token : undefined;

  const [row] = await db
    .select({ invoice: invoicesTable, client: clientsTable })
    .from(invoicesTable)
    .leftJoin(clientsTable, joinInvoiceClientSameMode())
    .where(eq(invoicesTable.id, id));

  const { shareToken, shareTokenExpiresAt } = row?.invoice ?? {};

  if (!timingSafeEqualString(shareToken, token)) {
    res.status(410).json({ error: "This share link is no longer valid." });
    return;
  }

  if (shareTokenExpiresAt && shareTokenExpiresAt < new Date()) {
    res.status(410).json({ error: "This share link has expired." });
    return;
  }

  const settings = await getCompanySettings({ fresh: true });
  const items = await loadLineItems(db, INVOICE_ITEMS, row.invoice.id);
  await streamInvoicePdf({ ...row.invoice, items }, row.client, settings, res, true);
});

router.get("/quotations/:id/pdf/public", async (req, res) => {
  const { id } = GetQuotationParams.parse(req.params);
  const token = typeof req.query.token === "string" ? req.query.token : undefined;

  const [row] = await db
    .select({ quotation: quotationsTable, client: clientsTable })
    .from(quotationsTable)
    .leftJoin(clientsTable, joinQuotationClientSameMode())
    .where(eq(quotationsTable.id, id));

  const { shareToken, shareTokenExpiresAt } = row?.quotation ?? {};

  if (!timingSafeEqualString(shareToken, token)) {
    res.status(410).json({ error: "This share link is no longer valid." });
    return;
  }

  if (shareTokenExpiresAt && shareTokenExpiresAt < new Date()) {
    res.status(410).json({ error: "This share link has expired." });
    return;
  }

  const settings = await getCompanySettings({ fresh: true });
  const items = await loadLineItems(db, QUOTATION_ITEMS, row.quotation.id);
  await streamQuotationPdf({ ...row.quotation, items }, row.client, settings, res, true);
});

export default router;
