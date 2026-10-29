import PDFDocument from "pdfkit";
import {
  CreateReceiptBody,
  DeleteReceiptParams,
  GetQuotationParams,
  GetReceiptParams,
  GetReceiptsStatsQueryParams,
  ListReceiptsQueryParams,
  UpdateReceiptBody,
  UpdateReceiptParams,
} from "@workspace/api-zod";
import { z as zz } from "zod";
import {
  auditLogTable,
  clientsTable,
  db,
  invoicesTable,
  paymentsTable,
  quotationsTable,
  receiptsTable,
  type DataMode,
  type LineItem,
} from "@workspace/db";
import { and, count, countDistinct, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { currentDataMode } from "../../lib/dataMode";
import { withUniqueRetry } from "../../lib/withUniqueRetry";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { setPdfDownloadHeaders } from "../../lib/pdfResponseHeaders";
import { drawReceiptPdfDoc } from "../../lib/quotationReceiptPdfDraw";
import { MONEY_EPS } from "../../lib/invoicePaymentStatus";
import {
  BulkIdsBody,
  calculateTotals,
  logAuditEvent,
  money,
  nextDocumentNumber,
  nextReceiptNumber,
  receiptDto,
  streamQuotationPdf,
  syncInvoicePayment,
  toNumber,
} from "./helpers";
import { INVOICE_ITEMS, loadLineItems, QUOTATION_ITEMS, replaceLineItems } from "../../lib/lineItems";

const router: IRouter = Router();

/**
 * Validates an optional paymentId supplied on receipt create/update: the
 * payment must exist, belong to the caller, and document the same invoice as
 * the receipt (a receipt for invoice A can't claim to document a payment on
 * invoice B). excludeReceiptId lets an update keep its own existing link.
 */
async function resolvePaymentLink(
  userId: string,
  dataMode: DataMode,
  invoiceId: string,
  paymentId: string | undefined,
  excludeReceiptId?: string,
): Promise<{ ok: true; paymentId: string | null } | { ok: false; status: number; error: string }> {
  if (!paymentId) return { ok: true, paymentId: null };
  const [payment] = await db
    .select({ invoiceId: paymentsTable.invoiceId })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt)));
  if (!payment) {
    return { ok: false, status: 400, error: "Payment not found or does not belong to you" };
  }
  if (payment.invoiceId !== invoiceId) {
    return { ok: false, status: 400, error: "That payment belongs to a different invoice." };
  }
  const existingLinkConditions = [eq(receiptsTable.paymentId, paymentId), eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt)];
  if (excludeReceiptId) existingLinkConditions.push(sql`${receiptsTable.id} != ${excludeReceiptId}`);
  const [existingLink] = await db.select({ id: receiptsTable.id }).from(receiptsTable).where(and(...existingLinkConditions));
  if (existingLink) {
    return { ok: false, status: 409, error: "This payment already has a linked receipt." };
  }
  return { ok: true, paymentId };
}

router.get("/receipts", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const query = ListReceiptsQueryParams.parse(req.query);
  const conditions = [eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt)];
  if (query.clientId) {
    conditions.push(eq(receiptsTable.clientId, query.clientId));
  }
  const search = query.q?.trim();
  const where = search
    ? and(
        ...conditions,
        or(
          ilike(receiptsTable.receiptNumber, `%${search}%`),
          ilike(clientsTable.name, `%${search}%`),
          ilike(receiptsTable.chequeNumber, `%${search}%`),
        ),
      )
    : and(...conditions);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const countQuery = db
    .select({ total: count() })
    .from(receiptsTable)
    .leftJoin(
      clientsTable,
      and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(where);
  const [{ total }] = await countQuery;
  const rows = await db
    .select({
      receipt: receiptsTable,
      invoiceNumber: invoicesTable.invoiceNumber,
      clientName: clientsTable.name,
    })
    .from(receiptsTable)
    .leftJoin(
      invoicesTable,
      and(eq(receiptsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)),
    )
    .leftJoin(
      clientsTable,
      and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(where)
    .orderBy(desc(receiptsTable.createdAt))
    .limit(pageSize)
    .offset(offset);
  res.json({
    data: rows.map((r) => receiptDto(r.receipt, r.invoiceNumber, r.clientName)),
    total: Number(total),
    page,
    pageSize,
  });
});

// Registered before GET /receipts/:id so "stats" isn't captured as an :id.
router.get("/receipts/stats", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const query = GetReceiptsStatsQueryParams.parse(req.query);
  const conditions = [eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt)];
  if (query.clientId) {
    conditions.push(eq(receiptsTable.clientId, query.clientId));
  }
  const search = query.q?.trim();
  const where = search
    ? and(
        ...conditions,
        or(
          ilike(receiptsTable.receiptNumber, `%${search}%`),
          ilike(clientsTable.name, `%${search}%`),
          ilike(receiptsTable.chequeNumber, `%${search}%`),
        ),
      )
    : and(...conditions);
  const [row] = await db
    .select({
      totalAmount: sql<string>`COALESCE(SUM(${receiptsTable.amount}::numeric), 0)`.mapWith(String),
      count: count(),
      clientCount: countDistinct(receiptsTable.clientId),
      invoiceCount: countDistinct(receiptsTable.invoiceId),
    })
    .from(receiptsTable)
    .leftJoin(
      clientsTable,
      and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(where);
  res.json({
    totalAmount: toNumber(row.totalAmount),
    count: Number(row.count),
    clientCount: Number(row.clientCount),
    invoiceCount: Number(row.invoiceCount),
  });
});

router.delete("/receipts/bulk-delete", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { ids } = BulkIdsBody.parse(req.body);
  if (ids.length === 0) { res.status(204).send(); return; }
  const deleted = await db
    .update(receiptsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), inArray(receiptsTable.id, ids)))
    .returning({ id: receiptsTable.id });
  if (deleted.length > 0) {
    await db.insert(auditLogTable).values(
      deleted.map((row) => ({ userId, dataMode, entityType: "receipt" as const, entityId: row.id, eventType: "deleted" as const })),
    );
  }
  res.status(204).send();
});

// Registered before /receipts/:id so "deleted" isn't captured as an :id.
router.get("/receipts/deleted", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const query = zz.object({ page: zz.coerce.number().int().min(1).optional(), pageSize: zz.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
  const where = and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), sql`${receiptsTable.deletedAt} IS NOT NULL`);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(receiptsTable).where(where),
    db
      .select({
        receipt: receiptsTable,
        invoiceNumber: invoicesTable.invoiceNumber,
        clientName: clientsTable.name,
      })
      .from(receiptsTable)
      .leftJoin(invoicesTable, and(eq(receiptsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)))
      .leftJoin(clientsTable, and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
      .where(where)
      .orderBy(desc(receiptsTable.deletedAt))
      .limit(pageSize)
      .offset(offset),
  ]);
  res.json({
    data: rows.map((r) => ({ ...receiptDto(r.receipt, r.invoiceNumber, r.clientName), deletedAt: r.receipt.deletedAt?.toISOString() })),
    total: Number(total),
    page,
    pageSize,
  });
});

router.post("/receipts/quick-draft", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    .limit(1);
  if (!client) {
    res.status(400).json({ error: "Add a client before creating a receipt." });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const items: LineItem[] = [{ name: "Sample line", quantity: 1, price: 100, taxRate: 0 }];
  const totals = calculateTotals(items, 0);
  const inv = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(invoicesTable)
      .values({
        userId,
        dataMode,
        clientId: client.id,
        invoiceNumber: await nextDocumentNumber(userId, "invoice", undefined, tx, dataMode),
        invoiceDate: today,
        dueDate: today,
        status: "draft",
        currency: "HKD",
        subtotal: money(totals.subtotal),
        taxAmount: money(totals.taxAmount),
        discountAmount: money(totals.discountAmount),
        total: money(totals.total),
        paidAmount: money(0),
      })
      .returning();
    await replaceLineItems(tx, INVOICE_ITEMS, inserted.id, items);
    return inserted;
  });
  await db.insert(paymentsTable).values({
    userId,
    dataMode,
    invoiceId: inv.id,
    amount: money(totals.total),
    paymentDate: today,
    paymentMethod: "other",
    note: "Quick draft receipt",
  });
  await syncInvoicePayment(userId, inv.id);
  const rec = await withUniqueRetry(async () => {
    const receiptNumber = await nextReceiptNumber(userId, undefined, dataMode);
    const [inserted] = await db
      .insert(receiptsTable)
      .values({
        userId,
        dataMode,
        receiptNumber,
        invoiceId: inv.id,
        clientId: client.id,
        amount: money(totals.total),
        currency: "HKD",
        receiptDate: today,
        notes: "Sample receipt for layout preview",
      })
      .returning();
    return inserted;
  });
  const [cli] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, client.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)));
  res.status(201).json(receiptDto(rec, inv.invoiceNumber, cli?.name));
});

router.post("/receipts", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const body = CreateReceiptBody.parse(req.body);
  const [invoice] = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber, clientId: invoicesTable.clientId, total: invoicesTable.total })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.id, body.invoiceId),
        eq(invoicesTable.userId, userId),
        eq(invoicesTable.dataMode, dataMode),
      ),
    );
  if (!invoice) {
    res.status(400).json({ error: "Invoice not found or does not belong to you" });
    return;
  }
  if (body.amount <= 0 || body.amount > toNumber(invoice.total) + MONEY_EPS) {
    res.status(400).json({
      error: `Receipt amount must be positive and cannot exceed the invoice total (${invoice.total}).`,
    });
    return;
  }
  const paymentLink = await resolvePaymentLink(userId, dataMode, body.invoiceId, body.paymentId);
  if (!paymentLink.ok) {
    res.status(paymentLink.status).json({ error: paymentLink.error });
    return;
  }
  const effectiveClientId = invoice.clientId;
  const row = await withUniqueRetry(async () => {
    const receiptNumber = await nextReceiptNumber(userId, undefined, dataMode);
    const [inserted] = await db
      .insert(receiptsTable)
      .values({
        userId,
        dataMode,
        receiptNumber,
        invoiceId: body.invoiceId,
        clientId: effectiveClientId,
        paymentId: paymentLink.paymentId,
        amount: money(body.amount),
        currency: body.currency,
        chequeNumber: body.chequeNumber ?? null,
        chequeDetails: body.chequeDetails ?? null,
        receiptDate: body.receiptDate,
        notes: body.notes ?? null,
      })
      .returning();
    return inserted;
  });
  const [client] = effectiveClientId
    ? await db
        .select({ name: clientsTable.name })
        .from(clientsTable)
        .where(and(eq(clientsTable.id, effectiveClientId), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    : [null];
  res.status(201).json(receiptDto(row, invoice.invoiceNumber, client?.name));
});

router.get("/receipts/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = GetReceiptParams.parse(req.params);
  const [row] = await db
    .select({
      receipt: receiptsTable,
      invoiceNumber: invoicesTable.invoiceNumber,
      clientName: clientsTable.name,
    })
    .from(receiptsTable)
    .leftJoin(
      invoicesTable,
      and(eq(receiptsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)),
    )
    .leftJoin(
      clientsTable,
      and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.id, id)));
  if (!row) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  res.json(receiptDto(row.receipt, row.invoiceNumber, row.clientName));
});

router.get("/quotations/:id/pdf", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = GetQuotationParams.parse(req.params);

  const [row] = await db
    .select({ quotation: quotationsTable, client: clientsTable })
    .from(quotationsTable)
    .leftJoin(
      clientsTable,
      and(eq(quotationsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), eq(quotationsTable.id, id)));

  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }

  const settings = await getCompanySettings({ fresh: true });
  const items = await loadLineItems(db, QUOTATION_ITEMS, row.quotation.id);
  const inline = req.query.inline === "true" || req.query.inline === "1";
  await streamQuotationPdf({ ...row.quotation, items }, row.client, settings, res, inline);
});

router.get("/receipts/:id/pdf", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = GetReceiptParams.parse(req.params);
  const [row] = await db
    .select({
      receipt: receiptsTable,
      invoiceNumber: invoicesTable.invoiceNumber,
      client: clientsTable,
    })
    .from(receiptsTable)
    .leftJoin(
      invoicesTable,
      and(eq(receiptsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)),
    )
    .leftJoin(
      clientsTable,
      and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.id, id)));
  if (!row) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }

  const { receipt, invoiceNumber, client } = row;
  const settings = await getCompanySettings({ fresh: true });

  const inline = req.query.inline === "true" || req.query.inline === "1";
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  setPdfDownloadHeaders(
    res,
    `${inline ? "inline" : "attachment"}; filename="receipt-${receipt.receiptNumber}.pdf"`,
  );
  doc.pipe(res);
  await drawReceiptPdfDoc(doc, receipt, invoiceNumber, client, settings);
  doc.end();
});

router.patch("/receipts/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = UpdateReceiptParams.parse(req.params);
  const body = UpdateReceiptBody.parse(req.body);
  const [invoice] = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber, clientId: invoicesTable.clientId, total: invoicesTable.total })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.id, body.invoiceId),
        eq(invoicesTable.userId, userId),
        eq(invoicesTable.dataMode, dataMode),
      ),
    );
  if (!invoice) {
    res.status(400).json({ error: "Invoice not found or does not belong to you" });
    return;
  }
  if (body.amount <= 0 || body.amount > toNumber(invoice.total) + MONEY_EPS) {
    res.status(400).json({
      error: `Receipt amount must be positive and cannot exceed the invoice total (${invoice.total}).`,
    });
    return;
  }
  const paymentLink = await resolvePaymentLink(userId, dataMode, body.invoiceId, body.paymentId, id);
  if (!paymentLink.ok) {
    res.status(paymentLink.status).json({ error: paymentLink.error });
    return;
  }
  const effectiveClientId = invoice.clientId;
  const [row] = await db
    .update(receiptsTable)
    .set({
      invoiceId: body.invoiceId,
      clientId: effectiveClientId,
      paymentId: paymentLink.paymentId,
      amount: money(body.amount),
      currency: body.currency,
      chequeNumber: body.chequeNumber ?? null,
      chequeDetails: body.chequeDetails ?? null,
      receiptDate: body.receiptDate,
      notes: body.notes ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  const [client] = effectiveClientId
    ? await db
        .select({ name: clientsTable.name })
        .from(clientsTable)
        .where(and(eq(clientsTable.id, effectiveClientId), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    : [null];
  res.json(receiptDto(row, invoice.invoiceNumber, client?.name));
});

router.post("/receipts/:id/duplicate", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = UpdateReceiptParams.parse(req.params);
  const [src] = await db
    .select()
    .from(receiptsTable)
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.id, id)));
  if (!src) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  const [invJoin] = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber, clientId: invoicesTable.clientId })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.id, src.invoiceId),
        eq(invoicesTable.userId, userId),
        eq(invoicesTable.dataMode, dataMode),
      ),
    );
  if (!invJoin) {
    res.status(400).json({ error: "Linked invoice missing" });
    return;
  }
  const newRow = await withUniqueRetry(async () => {
    const receiptNumber = await nextReceiptNumber(userId, undefined, dataMode);
    const [inserted] = await db
      .insert(receiptsTable)
      .values({
        userId,
        dataMode,
        receiptNumber,
        invoiceId: src.invoiceId,
        clientId: src.clientId ?? invJoin.clientId,
        amount: src.amount,
        currency: src.currency,
        chequeNumber: src.chequeNumber,
        chequeDetails: src.chequeDetails,
        receiptDate: src.receiptDate,
        notes: src.notes,
      })
      .returning();
    return inserted;
  });
  const [cli] = newRow.clientId
    ? await db
        .select({ name: clientsTable.name })
        .from(clientsTable)
        .where(and(eq(clientsTable.id, newRow.clientId), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    : [null];
  res.status(201).json(receiptDto(newRow, invJoin.invoiceNumber, cli?.name));
});

router.patch("/receipts/:id/archive", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = UpdateReceiptParams.parse(req.params);
  const tag = zz.string().optional().parse((req.body as { note?: string })?.note);
  const [existing] = await db
    .select()
    .from(receiptsTable)
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  const archivedNote =
    `[Archived${tag?.trim() ? `: ${tag.trim()}` : ""}]` +
    (existing.notes?.trim() ? `\n${existing.notes}` : "");
  await db
    .update(receiptsTable)
    .set({
      notes: archivedNote.trim(),
      updatedAt: new Date(),
    })
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.id, id)));

  const [joined] = await db
    .select({
      receipt: receiptsTable,
      invoiceNumber: invoicesTable.invoiceNumber,
      clientName: clientsTable.name,
    })
    .from(receiptsTable)
    .leftJoin(
      invoicesTable,
      and(eq(receiptsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)),
    )
    .leftJoin(
      clientsTable,
      and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.id, id)));
  res.json(receiptDto(joined!.receipt, joined!.invoiceNumber, joined!.clientName));
});

router.delete("/receipts/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = DeleteReceiptParams.parse(req.params);
  const [row] = await db
    .update(receiptsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.id, id)))
    .returning({ id: receiptsTable.id });
  if (row) {
    await logAuditEvent({ userId, dataMode, entityType: "receipt", entityId: id, eventType: "deleted" });
  }
  res.status(204).send();
});

router.post("/receipts/:id/restore", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = GetReceiptParams.parse(req.params);
  const [row] = await db
    .update(receiptsTable)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), eq(receiptsTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  await logAuditEvent({ userId, dataMode, entityType: "receipt", entityId: id, eventType: "restored" });
  const [joined] = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber, clientName: clientsTable.name })
    .from(receiptsTable)
    .leftJoin(invoicesTable, and(eq(receiptsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)))
    .leftJoin(clientsTable, and(eq(receiptsTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    .where(eq(receiptsTable.id, id));
  res.json(receiptDto(row, joined?.invoiceNumber, joined?.clientName));
});

export default router;
