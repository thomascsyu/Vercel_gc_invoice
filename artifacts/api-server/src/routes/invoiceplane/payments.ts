import { randomUUID } from "crypto";
import { CreatePaymentBody, DeletePaymentParams, GenerateReceiptFromPaymentParams, ListPaymentsQueryParams } from "@workspace/api-zod";
import { z as zz } from "zod";
import {
  auditLogTable,
  clientsTable,
  db,
  invoicesTable,
  paymentReceiptsTable,
  paymentsTable,
  receiptsTable,
  type PaymentReceiptType,
} from "@workspace/db";
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { stringify as csvStringify } from "csv-stringify/sync";
import { parse as csvParse } from "csv-parse/sync";
import { ObjectStorageService, ObjectNotFoundError } from "../../lib/objectStorage";
import { logger } from "../../lib/logger";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { joinInvoiceClient } from "../../lib/clientJoins";
import { currentDataMode } from "../../lib/dataMode";
import { withUniqueRetry } from "../../lib/withUniqueRetry";
import {
  handleCsvImportUpload,
  logAuditEvent,
  money,
  nextReceiptNumber,
  paymentDto,
  PAYMENT_METHODS,
  paymentReceiptDto,
  receiptDto,
  receiptUpload,
  syncInvoicePayment,
  syncInvoicePaymentsBatch,
  toNumber,
} from "./helpers";
import { wouldOverpay } from "../../lib/invoicePaymentStatus";
import { contentDispositionAttachment, isAllowedPaymentReceiptMime } from "../../lib/uploadSafety";

const router: IRouter = Router();

router.get("/payments", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const query = ListPaymentsQueryParams.parse(req.query);
  const conditions: SQL<unknown>[] = [eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt)];

  // Invoice filters
  if (query.invoiceId) conditions.push(eq(paymentsTable.invoiceId, query.invoiceId));
  if (query.clientId) conditions.push(eq(invoicesTable.clientId, query.clientId));

  // Payment method filter
  if (query.paymentMethod) conditions.push(eq(paymentsTable.paymentMethod, query.paymentMethod));

  // Date range filters
  if (query.dateFrom) conditions.push(gte(paymentsTable.paymentDate, query.dateFrom));
  if (query.dateTo) conditions.push(lte(paymentsTable.paymentDate, query.dateTo));

  // Text search on cheque number, reference number, transaction ID
  const search = query.q?.trim();
  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(paymentsTable.chequeNumber ?? "", searchPattern),
        ilike(paymentsTable.referenceNumber ?? "", searchPattern),
        ilike(paymentsTable.transactionId ?? "", searchPattern),
        ilike(paymentsTable.bankName ?? "", searchPattern),
      ) ?? sql`false`
    );
  }

  // Invoice number search (partial match)
  if (query.invoiceNumber) {
    conditions.push(ilike(invoicesTable.invoiceNumber, `%${query.invoiceNumber}%`));
  }

  const where = and(...conditions);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const [{ total }] = await db
    .select({ total: count() })
    .from(paymentsTable)
    .leftJoin(
      invoicesTable,
      and(eq(paymentsTable.invoiceId, invoicesTable.id), eq(invoicesTable.dataMode, dataMode)),
    )
    .where(where);

  const rows = await db
    .select({
      payment: paymentsTable,
      invoiceNumber: invoicesTable.invoiceNumber,
      currency: invoicesTable.currency,
      clientId: invoicesTable.clientId,
      invoiceTotal: invoicesTable.total,
      invoicePaidAmount: invoicesTable.paidAmount,
    })
    .from(paymentsTable)
    .leftJoin(
      invoicesTable,
      and(eq(paymentsTable.invoiceId, invoicesTable.id), eq(invoicesTable.dataMode, dataMode)),
    )
    .leftJoin(clientsTable, joinInvoiceClient(userId, dataMode))
    .where(where)
    .orderBy(desc(paymentsTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  // Fetch client names separately since we can't easily join with aggregations
  const clientIds = [...new Set(rows.map(r => r.clientId).filter((id): id is string => !!id))];
  const clientNames = clientIds.length > 0
    ? await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable).where(inArray(clientsTable.id, clientIds))
    : [];
  const clientNameMap = new Map(clientNames.map(c => [c.id, c.name]));

  res.json({
    data: rows.map((row) => paymentDto(
      row.payment,
      row.invoiceNumber,
      row.currency,
      row.clientId,
      clientNameMap.get(row.clientId ?? "") ?? null,
      row.invoiceTotal ? toNumber(row.invoiceTotal) : null,
      row.invoicePaidAmount ? toNumber(row.invoicePaidAmount) : null,
    )),
    total: Number(total),
    page,
    pageSize,
  });
});

router.get("/payments/export", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const rows = await db
    .select({ payment: paymentsTable, invoiceNumber: invoicesTable.invoiceNumber })
    .from(paymentsTable)
    .leftJoin(
      invoicesTable,
      and(eq(paymentsTable.invoiceId, invoicesTable.id), eq(invoicesTable.dataMode, dataMode)),
    )
    .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt)))
    .orderBy(desc(paymentsTable.createdAt));
  const csv = csvStringify(rows.map((r) => ({
    id: r.payment.id,
    invoiceNumber: r.invoiceNumber ?? "",
    amount: r.payment.amount,
    paymentDate: r.payment.paymentDate,
    paymentMethod: r.payment.paymentMethod,
    note: r.payment.note ?? "",
    createdAt: r.payment.createdAt.toISOString(),
  })), { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=payments.csv");
  res.send(csv);
});

router.post("/payments/import", handleCsvImportUpload, async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const userId = (req as unknown as AuthedRequest).userId;
    const dataMode = await currentDataMode();
    const commit = req.query.commit === "true";
    const records: Record<string, string>[] = csvParse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    const errors: string[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r.invoiceId) errors.push(`Row ${i + 1}: invoiceId is required`);
      if (!r.amount) errors.push(`Row ${i + 1}: amount is required`);
      if (!r.paymentDate) errors.push(`Row ${i + 1}: paymentDate is required`);
      if (!r.paymentMethod) errors.push(`Row ${i + 1}: paymentMethod is required`);
      else if (!(PAYMENT_METHODS as readonly string[]).includes(r.paymentMethod)) {
        errors.push(`Row ${i + 1}: paymentMethod must be one of ${PAYMENT_METHODS.join(", ")}`);
      }
    }
    const uniqueInvoiceIds = [...new Set(records.map((r) => r.invoiceId).filter(Boolean))];
    const invoiceBalance = new Map<string, { total: number; paid: number }>();
    if (uniqueInvoiceIds.length > 0) {
      const foundInvoices = await db
        .select({ id: invoicesTable.id, total: invoicesTable.total, paidAmount: invoicesTable.paidAmount })
        .from(invoicesTable)
        .where(
          and(
            eq(invoicesTable.userId, userId),
            eq(invoicesTable.dataMode, dataMode),
            inArray(invoicesTable.id, uniqueInvoiceIds),
          ),
        );
      const foundInvoiceIds = new Set(foundInvoices.map((inv) => inv.id));
      for (const inv of foundInvoices) {
        invoiceBalance.set(inv.id, { total: toNumber(inv.total), paid: toNumber(inv.paidAmount) });
      }
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.invoiceId && !foundInvoiceIds.has(r.invoiceId)) {
          errors.push(`Row ${i + 1}: invoiceId ${r.invoiceId} not found`);
        }
      }
    }
    const existingPayments = await db
      .select({ invoiceId: paymentsTable.invoiceId, amount: paymentsTable.amount, paymentDate: paymentsTable.paymentDate, paymentMethod: paymentsTable.paymentMethod })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt)));
    const existingKeys = new Set(
      existingPayments.map((p) => `${p.invoiceId}|${p.paymentDate}|${p.amount}|${p.paymentMethod}`)
    );
    if (!commit) {
      const probableSkippedRows: Array<{ row: number; reason: string }> = [];
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.invoiceId && r.amount && r.paymentDate && r.paymentMethod) {
          const key = `${r.invoiceId}|${r.paymentDate}|${Number(r.amount).toFixed(2)}|${r.paymentMethod}`;
          if (existingKeys.has(key)) {
            probableSkippedRows.push({ row: i + 1, reason: `duplicate payment (invoice ${r.invoiceId}, ${r.paymentDate}, ${r.amount})` });
          }
        }
      }
      res.json({ previewCount: records.length, errors, probableSkips: probableSkippedRows.length, probableSkippedRows });
      return;
    }
    if (errors.length > 0) {
      res.status(400).json({ error: "Validation errors must be resolved before importing", errors });
      return;
    }
    let inserted = 0;
    let skipped = 0;
    const skippedRows: Array<{ row: number; reason: string; data: Record<string, string> }> = [];
    const affectedInvoiceIds = new Set<string>();
    const pendingInserts: Array<typeof paymentsTable.$inferInsert> = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const key = `${r.invoiceId}|${r.paymentDate}|${Number(r.amount).toFixed(2)}|${r.paymentMethod}`;
      if (existingKeys.has(key)) {
        skipped++;
        skippedRows.push({ row: i + 1, reason: `duplicate payment (invoice ${r.invoiceId}, ${r.paymentDate}, ${r.amount})`, data: r });
        continue;
      }
      const balance = invoiceBalance.get(r.invoiceId);
      const amount = Number(r.amount);
      if (balance && wouldOverpay(balance.total, balance.paid, amount)) {
        skipped++;
        skippedRows.push({
          row: i + 1,
          reason: `overpayment (invoice ${r.invoiceId} remaining ${(balance.total - balance.paid).toFixed(2)})`,
          data: r,
        });
        continue;
      }
      if (balance) {
        balance.paid += amount;
      }
      pendingInserts.push({
        userId,
        dataMode,
        invoiceId: r.invoiceId,
        amount: money(amount),
        paymentDate: r.paymentDate,
        paymentMethod: r.paymentMethod,
        note: r.note ?? null,
      });
      existingKeys.add(key);
      affectedInvoiceIds.add(r.invoiceId);
      inserted++;
    }
    // Inserts + the paid-amount/status sync run in one transaction: a failure
    // partway through must not leave some payments recorded without invoices
    // reflecting them.
    const INSERT_CHUNK = 100;
    await db.transaction(async (tx) => {
      for (let i = 0; i < pendingInserts.length; i += INSERT_CHUNK) {
        await tx.insert(paymentsTable).values(pendingInserts.slice(i, i + INSERT_CHUNK));
      }
      await syncInvoicePaymentsBatch(userId, [...affectedInvoiceIds], tx);
    });
    res.json({ inserted, skipped, skippedRows, errors: [] });
  } catch (err) {
    logger.error({ err }, "Failed to parse payment CSV import");
    res.status(400).json({ error: "Failed to parse CSV. Check the file format and try again." });
  }
});

router.post("/payments", async (req, res, next) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const body = CreatePaymentBody.parse(req.body);

  try {
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .select({
          id: invoicesTable.id,
          invoiceNumber: invoicesTable.invoiceNumber,
          currency: invoicesTable.currency,
          clientId: invoicesTable.clientId,
          total: invoicesTable.total,
          paidAmount: invoicesTable.paidAmount,
        })
        .from(invoicesTable)
        .where(
          and(
            eq(invoicesTable.id, body.invoiceId),
            eq(invoicesTable.userId, userId),
            eq(invoicesTable.dataMode, dataMode),
          ),
        )
        .for("update");

      if (!invoice) {
        return { kind: "not_found" as const };
      }

      const remaining = toNumber(invoice.total) - toNumber(invoice.paidAmount);
      if (wouldOverpay(toNumber(invoice.total), toNumber(invoice.paidAmount), body.amount)) {
        return { kind: "overpay" as const, remaining: Math.max(0, remaining) };
      }

      const [inserted] = await tx
        .insert(paymentsTable)
        .values({
          userId,
          dataMode,
          invoiceId: body.invoiceId,
          amount: money(body.amount),
          paymentDate: body.paymentDate,
          paymentMethod: body.paymentMethod,
          note: body.note,
          chequeNumber: body.chequeNumber ?? null,
          bankName: body.bankName ?? null,
          depositDate: body.depositDate ?? null,
          referenceNumber: body.referenceNumber ?? null,
          transactionId: body.transactionId ?? null,
        })
        .returning();

      await syncInvoicePayment(userId, body.invoiceId, tx);

      const [refreshedInvoice] = await tx
        .select({ total: invoicesTable.total, paidAmount: invoicesTable.paidAmount })
        .from(invoicesTable)
        .where(and(eq(invoicesTable.id, body.invoiceId), eq(invoicesTable.userId, userId)));

      return {
        kind: "ok" as const,
        row: inserted,
        updatedInvoice: refreshedInvoice,
        invoiceMeta: invoice,
      };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (result.kind === "overpay") {
      res.status(400).json({
        error: `Payment of ${body.amount} exceeds the remaining balance of ${result.remaining.toFixed(2)}.`,
      });
      return;
    }

    res.status(201).json(
      paymentDto(
        result.row,
        result.invoiceMeta.invoiceNumber,
        result.invoiceMeta.currency,
        result.invoiceMeta.clientId,
        null,
        result.updatedInvoice?.total ? toNumber(result.updatedInvoice.total) : null,
        result.updatedInvoice?.paidAmount ? toNumber(result.updatedInvoice.paidAmount) : null,
      ),
    );
  } catch (err) {
    next(err);
  }
});

router.delete("/payments/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = DeletePaymentParams.parse(req.params);
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt), eq(paymentsTable.id, id)));
  if (payment) {
    // Soft delete: the payment's own uploaded proof-of-payment attachments
    // (paymentReceiptsTable) are left in place — they'll be reachable again
    // if the payment is restored, rather than being lost with it.
    await db.transaction(async (tx) => {
      await tx
        .update(paymentsTable)
        .set({ deletedAt: new Date() })
        .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt), eq(paymentsTable.id, id)));
      await syncInvoicePayment(userId, payment.invoiceId, tx);
      await logAuditEvent({ userId, dataMode, entityType: "payment", entityId: id, eventType: "deleted" }, tx);
    });
  }
  res.status(204).send();
});

router.post("/payments/:id/restore", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = zz.object({ id: zz.string().uuid() }).parse(req.params);
  const row = await db.transaction(async (tx) => {
    const [restored] = await tx
      .update(paymentsTable)
      .set({ deletedAt: null })
      .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), eq(paymentsTable.id, id)))
      .returning();
    if (!restored) return null;
    await syncInvoicePayment(userId, restored.invoiceId, tx);
    await logAuditEvent({ userId, dataMode, entityType: "payment", entityId: id, eventType: "restored" }, tx);
    return restored;
  });
  if (!row) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const [invoice] = await db
    .select({ invoiceNumber: invoicesTable.invoiceNumber, currency: invoicesTable.currency, clientId: invoicesTable.clientId })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, row.invoiceId), eq(invoicesTable.userId, userId)));
  res.json(paymentDto(row, invoice?.invoiceNumber, invoice?.currency, invoice?.clientId, null));
});

router.get("/payments/deleted", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const query = zz.object({ page: zz.coerce.number().int().min(1).optional(), pageSize: zz.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
  const where = and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), sql`${paymentsTable.deletedAt} IS NOT NULL`);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(paymentsTable).where(where),
    db
      .select({ payment: paymentsTable, invoiceNumber: invoicesTable.invoiceNumber, currency: invoicesTable.currency, clientId: invoicesTable.clientId })
      .from(paymentsTable)
      .leftJoin(invoicesTable, and(eq(paymentsTable.invoiceId, invoicesTable.id), eq(invoicesTable.dataMode, dataMode)))
      .where(where)
      .orderBy(desc(paymentsTable.deletedAt))
      .limit(pageSize)
      .offset(offset),
  ]);
  res.json({
    data: rows.map((row) => ({
      ...paymentDto(row.payment, row.invoiceNumber, row.currency, row.clientId, null),
      deletedAt: row.payment.deletedAt?.toISOString(),
    })),
    total: Number(total),
    page,
    pageSize,
  });
});

router.post("/payments/:id/receipt", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GenerateReceiptFromPaymentParams.parse(req.params);
  const [joined] = await db
    .select({
      payment: paymentsTable,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceCurrency: invoicesTable.currency,
      clientId: invoicesTable.clientId,
    })
    .from(paymentsTable)
    .leftJoin(
      invoicesTable,
      and(eq(paymentsTable.invoiceId, invoicesTable.id), eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)),
    )
    .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt), eq(paymentsTable.id, id)));
  if (!joined) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const [existingLink] = await db
    .select({ id: receiptsTable.id })
    .from(receiptsTable)
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode), isNull(receiptsTable.deletedAt), eq(receiptsTable.paymentId, id)));
  if (existingLink) {
    res.status(409).json({ error: "This payment already has a linked receipt.", receiptId: existingLink.id });
    return;
  }
  const row = await withUniqueRetry(async () => {
    const receiptNumber = await nextReceiptNumber(userId, undefined, dataMode);
    const [inserted] = await db
      .insert(receiptsTable)
      .values({
        userId,
        dataMode,
        receiptNumber,
        invoiceId: joined.payment.invoiceId,
        clientId: joined.clientId,
        paymentId: joined.payment.id,
        amount: joined.payment.amount,
        currency: (joined.invoiceCurrency ?? "HKD") as "HKD" | "USD" | "CNY" | "MOP",
        chequeNumber: joined.payment.chequeNumber ?? null,
        receiptDate: joined.payment.paymentDate,
      })
      .returning();
    return inserted;
  });
  const [client] = joined.clientId
    ? await db
        .select({ name: clientsTable.name })
        .from(clientsTable)
        .where(and(eq(clientsTable.id, joined.clientId), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    : [null];
  res.status(201).json(receiptDto(row, joined.invoiceNumber, client?.name));
});

// Payment Receipts Routes
router.get("/payments/:id/receipts", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = zz.object({ id: zz.string().uuid() }).parse(req.params);
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt), eq(paymentsTable.id, id)));
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const receipts = await db
    .select()
    .from(paymentReceiptsTable)
    .where(and(eq(paymentReceiptsTable.userId, userId), eq(paymentReceiptsTable.paymentId, id)))
    .orderBy(desc(paymentReceiptsTable.uploadedAt));
  res.json(receipts.map(paymentReceiptDto));
});

router.post("/payments/:id/receipts", receiptUpload.single("file"), async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = zz.object({ id: zz.string().uuid() }).parse(req.params);
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode), isNull(paymentsTable.deletedAt), eq(paymentsTable.id, id)));
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const receiptType = req.body.receiptType as PaymentReceiptType;
  const description = req.body.description as string | undefined;

  if (!receiptType || !["receipt", "screenshot", "cheque_deposit", "other"].includes(receiptType)) {
    res.status(400).json({ error: "Invalid receipt type. Must be one of: receipt, screenshot, cheque_deposit, other" });
    return;
  }

  if (!isAllowedPaymentReceiptMime(req.file.mimetype)) {
    res.status(400).json({ error: "File type not allowed. Upload a PDF or image (JPEG, PNG, WebP, GIF)." });
    return;
  }

  const objectStorage = new ObjectStorageService();
  const fileName = req.file.originalname;
  const fileExtension = fileName.split(".").pop() ?? "";
  const uniqueFileName = `${randomUUID()}.${fileExtension}`;
  const folder = `payment-receipts/${userId}/${id}`;

  try {
    const relativePath = `${folder}/${uniqueFileName}`;
    const { objectPath: filePath } = await objectStorage.uploadPrivateEntity({
      relativePath,
      contentType: req.file.mimetype,
      body: req.file.buffer,
    });

    const [receipt] = await db
      .insert(paymentReceiptsTable)
      .values({
        userId,
        dataMode,
        paymentId: id,
        invoiceId: payment.invoiceId,
        receiptType,
        fileName,
        filePath,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        description,
      })
      .returning();

    res.status(201).json(paymentReceiptDto(receipt));
  } catch (err) {
    logger.error({ err }, "Failed to upload payment receipt");
    res.status(500).json({ error: "Failed to upload receipt." });
  }
});

router.get("/payments/:paymentId/receipts/:receiptId", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { paymentId, receiptId } = zz.object({ paymentId: zz.string().uuid(), receiptId: zz.string().uuid() }).parse(req.params);
  const [receipt] = await db
    .select()
    .from(paymentReceiptsTable)
    .where(
      and(
        eq(paymentReceiptsTable.userId, userId),
        eq(paymentReceiptsTable.dataMode, dataMode),
        eq(paymentReceiptsTable.paymentId, paymentId),
        eq(paymentReceiptsTable.id, receiptId),
      ),
    );
  if (!receipt) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  res.json(paymentReceiptDto(receipt));
});

router.delete("/payments/:paymentId/receipts/:receiptId", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { paymentId, receiptId } = zz.object({ paymentId: zz.string().uuid(), receiptId: zz.string().uuid() }).parse(req.params);
  const [receipt] = await db
    .select()
    .from(paymentReceiptsTable)
    .where(
      and(
        eq(paymentReceiptsTable.userId, userId),
        eq(paymentReceiptsTable.dataMode, dataMode),
        eq(paymentReceiptsTable.paymentId, paymentId),
        eq(paymentReceiptsTable.id, receiptId),
      ),
    );
  if (!receipt) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }

  // Delete the file from object storage
  const objectStorage = new ObjectStorageService();
  try {
    const file = await objectStorage.getObjectEntityFile(receipt.filePath);
    await file.delete();
  } catch (err) {
    // Ignore errors when deleting files
  }

  await db
    .delete(paymentReceiptsTable)
    .where(
      and(
        eq(paymentReceiptsTable.userId, userId),
        eq(paymentReceiptsTable.dataMode, dataMode),
        eq(paymentReceiptsTable.paymentId, paymentId),
        eq(paymentReceiptsTable.id, receiptId),
      ),
    );
  res.status(204).send();
});

router.get("/payments/:paymentId/receipts/:receiptId/download", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { paymentId, receiptId } = zz.object({ paymentId: zz.string().uuid(), receiptId: zz.string().uuid() }).parse(req.params);
  const [receipt] = await db
    .select()
    .from(paymentReceiptsTable)
    .where(
      and(
        eq(paymentReceiptsTable.userId, userId),
        eq(paymentReceiptsTable.dataMode, dataMode),
        eq(paymentReceiptsTable.paymentId, paymentId),
        eq(paymentReceiptsTable.id, receiptId),
      ),
    );
  if (!receipt) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }

  const objectStorage = new ObjectStorageService();
  try {
    const file = await objectStorage.getObjectEntityFile(receipt.filePath);
    const response = await objectStorage.downloadObject(file);
    res.setHeader("Content-Type", receipt.mimeType);
    res.setHeader("Content-Disposition", contentDispositionAttachment(receipt.fileName));
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found" });
    } else {
      logger.error({ err }, "Failed to download payment receipt file");
      res.status(500).json({ error: "Failed to download file." });
    }
  }
});

export default router;
