import { randomUUID } from "crypto";
import {
  ConvertQuotationParams,
  CreateQuotationBody,
  DeleteQuotationParams,
  GetInvoiceParams,
  GetQuotationParams,
  ListQuotationsQueryParams,
  UpdateQuotationBody,
  UpdateQuotationParams,
  UpdateQuotationResponse,
} from "@workspace/api-zod";
import { z as zz } from "zod";
import { logger } from "../../lib/logger";
import { auditLogTable, clientsTable, db, invoicesTable, quotationsTable, type LineItem } from "@workspace/db";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { stringify as csvStringify } from "csv-stringify/sync";
import { parse as csvParse } from "csv-parse/sync";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { assertClientOwnedByUser } from "../../lib/clientOwnership";
import { joinQuotationClient } from "../../lib/clientJoins";
import { currentDataMode } from "../../lib/dataMode";
import { withUniqueRetry } from "../../lib/withUniqueRetry";
import { parseShareTokenExpiryDays } from "../../lib/shareToken";
import {
  businessCalendarToday,
  canConvertQuotation,
  CONVERT_QUOTATION_ERROR,
  invoiceTransitionError,
  parseQuotationSearchQuery,
  quotationTransitionError,
} from "@workspace/invoice-utils";
import {
  assertConsultantIdsExist,
  ConsultantIdsInvalidError,
  INVOICE_CONSULTANTS,
  replaceConsultantIds,
} from "../../lib/consultantLinks";
import { INVOICE_ITEMS, loadLineItems, loadLineItemsByParent, QUOTATION_ITEMS, replaceLineItems } from "../../lib/lineItems";
import {
  BulkIdsBody,
  calculateTotals,
  type DocumentNumberSeq,
  handleCsvImportUpload,
  invoiceDto,
  logAuditEvent,
  money,
  nextDocumentNumber,
  quotationDto,
  quotationListDto,
  quotationListSelect,
  today,
  toNumber,
} from "./helpers";

const router: IRouter = Router();

/**
 * Generic JSON-array items parser used by the CSV import route below. Kept
 * here (rather than alongside the invoice CSV helpers) because it is only
 * used by POST /quotations/import.
 */
function parseItemsColumn(raw: string | undefined): LineItem[] | null {
  if (!raw || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item: Record<string, unknown>) => ({
      name: String(item.name ?? ""),
      description:
        item.description !== undefined ? String(item.description) : undefined,
      details: item.details !== undefined ? String(item.details) : undefined,
      quantity: toNumber(item.quantity ?? 1),
      price: toNumber(item.price ?? 0),
      taxRate: toNumber(item.taxRate ?? 0),
    }));
  } catch {
    return null;
  }
}

const QuotationStatusValues = [
  "draft", "pending_approval", "sent", "skip", "approved", "canceled", "confirmed", "invoiced",
] as const;

const QuotationBulkStatusBody = zz.object({ ids: zz.array(zz.string().uuid()), status: zz.enum(QuotationStatusValues) });

const ConvertQuotationBody = zz.object({
  clientId: zz.string().optional(),
  invoiceDate: zz.string().optional(),
  dueDate: zz.string().optional(),
  status: zz.enum(["draft", "pending_approval", "approved", "sent", "revised"]).optional(),
  currency: zz.enum(["HKD", "USD", "CNY", "MOP"]).optional(),
  discountAmount: zz.number().optional(),
  items: zz
    .array(
      zz.object({
        name: zz.string(),
        description: zz.string().optional(),
        details: zz.string().optional(),
        quantity: zz.number(),
        price: zz.number(),
        taxRate: zz.number().optional(),
      }),
    )
    .optional(),
  consultantIds: zz.array(zz.string()).optional(),
  serviceCategory: zz.enum(["setup", "main", "pen", "vscan", "others"]).optional(),
  notes: zz.string().optional(),
  internalNote: zz.string().optional(),
  termsConditions: zz.string().optional(),
  remark: zz.string().optional(),
});

const QuotationStatusBody = zz.object({
  status: zz.enum(QuotationStatusValues),
  cancellationReason: zz.string().optional(),
});

router.get("/quotations", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const query = ListQuotationsQueryParams.parse(req.query);
  const conditions = [eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt)];
  if (query.status) conditions.push(eq(quotationsTable.status, query.status));
  if (query.clientId) conditions.push(eq(quotationsTable.clientId, query.clientId));
  const todayStr = businessCalendarToday();
  if (query.validityStatus === "active") conditions.push(gte(quotationsTable.validUntil, todayStr));
  if (query.validityStatus === "expired") conditions.push(lt(quotationsTable.validUntil, todayStr));
  const parsedSearch = query.q ? parseQuotationSearchQuery(query.q) : null;
  if (parsedSearch) {
    if (parsedSearch.mode === "quotation") {
      conditions.push(ilike(quotationsTable.quotationNumber, `%${parsedSearch.term}%`));
    } else if (parsedSearch.mode === "amount") {
      if (parsedSearch.amount === undefined) {
        conditions.push(sql`false`);
      } else {
        conditions.push(eq(quotationsTable.total, parsedSearch.amount.toFixed(2)));
      }
    } else {
      const searchPattern = `%${parsedSearch.term}%`;
      conditions.push(
        or(ilike(clientsTable.name, searchPattern), ilike(clientsTable.clientCode, searchPattern)) ??
          sql`false`,
      );
    }
  }
  const where = and(...conditions);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const expiredFirst = sql<number>`CASE WHEN ${quotationsTable.validUntil} IS NOT NULL AND ${quotationsTable.validUntil} < ${todayStr} AND ${quotationsTable.status} NOT IN ('canceled','confirmed','invoiced') AND ${quotationsTable.convertedInvoiceId} IS NULL THEN 0 ELSE 1 END`;
  const dir = query.sortDir === "asc" ? asc : desc;
  const orderCol = query.sortBy === "quotationNumber" ? quotationsTable.quotationNumber
    : query.sortBy === "quotationDate" ? quotationsTable.quotationDate
    : query.sortBy === "validUntil" ? quotationsTable.validUntil
    : query.sortBy === "total" ? quotationsTable.total
    : query.sortBy === "status" ? quotationsTable.status
    : query.sortBy === "createdAt" ? quotationsTable.createdAt
    : null;
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(quotationsTable)
      .leftJoin(clientsTable, joinQuotationClient(userId, dataMode))
      .where(where),
    db
      .select({ ...quotationListSelect, clientName: clientsTable.name })
      .from(quotationsTable)
      .leftJoin(clientsTable, joinQuotationClient(userId, dataMode))
      .where(where)
      .orderBy(
        ...(orderCol
          ? [dir(orderCol), asc(expiredFirst)]
          : [asc(expiredFirst), desc(quotationsTable.createdAt)]),
      )
      .limit(pageSize)
      .offset(offset),
  ]);
  res.json({
    data: rows.map((row) => {
      const { clientName, ...quotation } = row;
      return quotationListDto(quotation, clientName);
    }),
    total: Number(total),
    page,
    pageSize,
  });
});

// Registered before /quotations/:id so "deleted" isn't captured as an :id.
router.get("/quotations/deleted", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const query = zz.object({ page: zz.coerce.number().int().min(1).optional(), pageSize: zz.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
  const where = and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), sql`${quotationsTable.deletedAt} IS NOT NULL`);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(quotationsTable).leftJoin(clientsTable, joinQuotationClient(userId, dataMode)).where(where),
    db
      .select({ ...quotationListSelect, clientName: clientsTable.name, deletedAt: quotationsTable.deletedAt })
      .from(quotationsTable)
      .leftJoin(clientsTable, joinQuotationClient(userId, dataMode))
      .where(where)
      .orderBy(desc(quotationsTable.deletedAt))
      .limit(pageSize)
      .offset(offset),
  ]);
  res.json({
    data: rows.map((row) => {
      const { clientName, deletedAt, ...quotation } = row;
      return { ...quotationListDto(quotation, clientName), deletedAt: deletedAt?.toISOString() };
    }),
    total: Number(total),
    page,
    pageSize,
  });
});

router.get("/quotations/export", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const rows = await db
    .select({ quotation: quotationsTable, clientName: clientsTable.name })
    .from(quotationsTable)
    .leftJoin(clientsTable, joinQuotationClient(userId, dataMode))
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt)))
    .orderBy(desc(quotationsTable.createdAt));
  const itemsByQuotation = await loadLineItemsByParent(db, QUOTATION_ITEMS, rows.map((r) => r.quotation.id));
  /** Columns match GET /quotations/import/template order; trailing fields are export-only. */
  const csv = csvStringify(rows.map((r) => ({
    clientId: r.quotation.clientId,
    quotationDate: r.quotation.quotationDate,
    validUntil: r.quotation.validUntil ?? "",
    currency: r.quotation.currency,
    discountAmount: r.quotation.discountAmount,
    quotationAttn: r.quotation.quotationAttn ?? "",
    items: JSON.stringify(itemsByQuotation.get(r.quotation.id) ?? []),
    id: r.quotation.id,
    quotationNumber: r.quotation.quotationNumber,
    clientName: r.clientName ?? "",
    status: r.quotation.status,
    subtotal: r.quotation.subtotal,
    total: r.quotation.total,
    createdAt: r.quotation.createdAt.toISOString(),
  })), { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=quotations.csv");
  res.send(csv);
});

router.post("/quotations/import", handleCsvImportUpload, async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const userId = (req as unknown as AuthedRequest).userId;
    const dataMode = await currentDataMode();
    const commit = req.query.commit === "true";
    const records: Record<string, string>[] = csvParse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    const errors: string[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r.clientId) errors.push(`Row ${i + 1}: clientId is required`);
      if (!r.quotationDate) errors.push(`Row ${i + 1}: quotationDate is required`);
      if (!r.currency) errors.push(`Row ${i + 1}: currency is required`);
      if (r.items !== undefined && r.items !== "") {
        if (parseItemsColumn(r.items) === null) {
          errors.push(`Row ${i + 1}: items must be a valid JSON array (e.g. [{"name":"Service","quantity":1,"price":100,"taxRate":0}])`);
        }
      }
    }
    const uniqueClientIds = [...new Set(records.map((r) => r.clientId).filter(Boolean))];
    if (uniqueClientIds.length > 0) {
      const foundClients = await db
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(
          and(
            eq(clientsTable.userId, userId),
            eq(clientsTable.dataMode, dataMode),
            inArray(clientsTable.id, uniqueClientIds),
          ),
        );
      const foundClientIds = new Set(foundClients.map((c) => c.id));
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.clientId && !foundClientIds.has(r.clientId)) {
          errors.push(`Row ${i + 1}: clientId ${r.clientId} not found`);
        }
      }
    }
    const existingQuotations = await db
      .select({ clientId: quotationsTable.clientId, quotationDate: quotationsTable.quotationDate, currency: quotationsTable.currency })
      .from(quotationsTable)
      .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt)));
    if (!commit) {
      const previewKeys = new Set(existingQuotations.map((q) => `${q.clientId}|${q.quotationDate}`));
      const probableSkippedRows: Array<{ row: number; reason: string }> = [];
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.clientId && r.quotationDate) {
          const key = `${r.clientId}|${r.quotationDate}`;
          if (previewKeys.has(key)) {
            probableSkippedRows.push({ row: i + 1, reason: `probable duplicate quotation (client ${r.clientId}, date ${r.quotationDate})` });
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
    const existingQuotationKeys = new Set(
      existingQuotations.map((q) => `${q.clientId}|${q.quotationDate}|${q.currency}`)
    );
    let inserted = 0;
    let skipped = 0;
    const skippedRows: Array<{ row: number; reason: string; data: Record<string, string> }> = [];
    const docSeq: DocumentNumberSeq = {};
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const key = `${r.clientId}|${r.quotationDate}|${r.currency}`;
      if (existingQuotationKeys.has(key)) {
        skipped++;
        skippedRows.push({ row: i + 1, reason: `duplicate quotation (client ${r.clientId}, ${r.quotationDate}, ${r.currency})`, data: r });
        continue;
      }
      const items: LineItem[] = parseItemsColumn(r.items) ?? [];
      const discountAmount = r.discountAmount ? toNumber(r.discountAmount) : 0;
      const totals = calculateTotals(items, discountAmount);
      const validCurrencies = ["HKD", "USD", "CNY", "MOP"] as const;
      const currency = validCurrencies.includes(r.currency as typeof validCurrencies[number])
        ? (r.currency as typeof validCurrencies[number])
        : "HKD";
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(quotationsTable)
          .values({
            userId,
            dataMode,
            clientId: r.clientId,
            quotationNumber: await nextDocumentNumber(userId, "quotation", docSeq, tx, dataMode),
            quotationDate: r.quotationDate,
            validUntil: r.validUntil ?? null,
            status: "draft",
            currency,
            subtotal: money(totals.subtotal),
            discountAmount: money(totals.discountAmount),
            total: money(totals.total),
            quotationAttn: r.quotationAttn?.trim() ? r.quotationAttn.trim() : null,
          })
          .returning();
        await replaceLineItems(tx, QUOTATION_ITEMS, row.id, items);
      });
      existingQuotationKeys.add(key);
      inserted++;
    }
    res.json({ inserted, skipped, skippedRows, errors: [] });
  } catch (err) {
    logger.error({ err }, "Failed to parse quotation CSV import");
    res.status(400).json({ error: "Failed to parse CSV. Check the file format and try again." });
  }
});

router.post("/quotations", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const body = CreateQuotationBody.parse(req.body);
  const clientCheck = await assertClientOwnedByUser(userId, body.clientId, dataMode);
  if (!clientCheck.ok) {
    res.status(clientCheck.status).json({ error: clientCheck.error });
    return;
  }
  const createStatus = body.status ?? "draft";
  if (createStatus === "invoiced") {
    res.status(422).json({ error: "Create the quotation first, then convert it to an invoice." });
    return;
  }
  const createTransitionErr = quotationTransitionError("draft", createStatus);
  if (createTransitionErr) {
    res.status(422).json({ error: createTransitionErr });
    return;
  }
  const totals = calculateTotals(body.items, body.discountAmount ?? 0);
  const row = await withUniqueRetry(() =>
    db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(quotationsTable)
        .values({
          userId,
          dataMode,
          clientId: body.clientId,
          quotationNumber: await nextDocumentNumber(userId, "quotation", undefined, tx, dataMode),
          quotationDate: body.quotationDate,
          validUntil: body.validUntil,
          status: createStatus,
          currency: body.currency,
          serviceCategory: body.serviceCategory ?? "others",
          subtotal: money(totals.subtotal),
          discountAmount: money(totals.discountAmount),
          total: money(totals.total),
          termsConditions: body.termsConditions ?? null,
          remark: body.remark ?? null,
          quotationAttn: body.quotationAttn?.trim() ? body.quotationAttn.trim() : null,
          driveFileUrl: body.driveFileUrl?.trim() ? body.driveFileUrl.trim() : null,
        })
        .returning();
      await replaceLineItems(tx, QUOTATION_ITEMS, inserted.id, body.items);
      return inserted;
    }),
  );
  res.status(201).json(quotationDto(row, body.items));
});

router.post("/quotations/quick-draft", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    .limit(1);
  if (!client) {
    res.status(400).json({ error: "Add a client before creating a quotation." });
    return;
  }
  const todayStr = today();
  const validUntil = today(30);
  const items: LineItem[] = [{ name: "Description", quantity: 1, price: 0, taxRate: 0 }];
  const totals = calculateTotals(items, 0);
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(quotationsTable)
      .values({
        userId,
        dataMode,
        clientId: client.id,
        quotationNumber: await nextDocumentNumber(userId, "quotation", undefined, tx, dataMode),
        quotationDate: todayStr,
        validUntil: validUntil,
        status: "draft",
        currency: "HKD",
        serviceCategory: "others",
        subtotal: money(totals.subtotal),
        discountAmount: money(totals.discountAmount),
        total: money(totals.total),
      })
      .returning();
    await replaceLineItems(tx, QUOTATION_ITEMS, inserted.id, items);
    return inserted;
  });
  res.status(201).json(quotationDto(row, items));
});

router.get("/quotations/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GetQuotationParams.parse(req.params);
  const [row] = await db
    .select({ quotation: quotationsTable, clientName: clientsTable.name })
    .from(quotationsTable)
    .leftJoin(clientsTable, joinQuotationClient(userId, dataMode))
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));
  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  const items = await loadLineItems(db, QUOTATION_ITEMS, row.quotation.id);
  res.json(quotationDto(row.quotation, items, row.clientName));
});

router.delete("/quotations/bulk-delete", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { ids } = BulkIdsBody.parse(req.body);
  if (ids.length === 0) { res.status(204).send(); return; }
  const deleted = await db
    .update(quotationsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), inArray(quotationsTable.id, ids)))
    .returning({ id: quotationsTable.id });
  if (deleted.length > 0) {
    await db.insert(auditLogTable).values(
      deleted.map((row) => ({ userId, dataMode, entityType: "quotation" as const, entityId: row.id, eventType: "deleted" as const })),
    );
  }
  res.status(204).send();
});

router.patch("/quotations/bulk-status", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { ids, status } = QuotationBulkStatusBody.parse(req.body);
  if (ids.length === 0) { res.status(204).send(); return; }
  if (status === "invoiced") {
    res.status(422).json({ error: "Mark a quotation invoiced by converting it to an invoice." });
    return;
  }
  const rows = await db
    .select({ id: quotationsTable.id, quotationNumber: quotationsTable.quotationNumber, status: quotationsTable.status })
    .from(quotationsTable)
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), inArray(quotationsTable.id, ids)));
  const blocked = rows
    .map((row) => {
      const err = quotationTransitionError(row.status, status);
      return err ? `${row.quotationNumber}: ${err}` : null;
    })
    .filter((msg): msg is string => Boolean(msg));
  if (blocked.length > 0) {
    res.status(422).json({ error: blocked.join(" ") });
    return;
  }
  await db.update(quotationsTable).set({ status, updatedAt: new Date() })
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), inArray(quotationsTable.id, ids)));
  const changed = rows.filter((row) => row.status !== status);
  if (changed.length > 0) {
    await db.insert(auditLogTable).values(
      changed.map((row) => ({
        userId,
        dataMode,
        entityType: "quotation" as const,
        entityId: row.id,
        eventType: "status_changed" as const,
        eventData: { from: row.status, to: status },
      })),
    );
  }
  res.status(204).send();
});

/** Status-only update — avoids round-tripping full line items from list rows. */
router.patch("/quotations/:id/status", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = UpdateQuotationParams.parse(req.params);
  const body = QuotationStatusBody.parse(req.body);

  const [existing] = await db
    .select({ status: quotationsTable.status })
    .from(quotationsTable)
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  if (existing.status === "invoiced") {
    res.status(422).json({ error: "Invoiced quotations cannot be edited." });
    return;
  }
  const transitionErr = quotationTransitionError(existing.status, body.status);
  if (transitionErr) {
    res.status(422).json({ error: transitionErr });
    return;
  }

  const [row] = await db
    .update(quotationsTable)
    .set({
      status: body.status,
      ...(body.cancellationReason !== undefined
        ? { cancellationReason: body.cancellationReason || null }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  if (existing.status !== body.status) {
    await logAuditEvent({
      userId,
      dataMode,
      entityType: "quotation",
      entityId: id,
      eventType: "status_changed",
      eventData: { from: existing.status, to: body.status },
    });
  }
  const [joined] = await db
    .select({ quotation: quotationsTable, clientName: clientsTable.name })
    .from(quotationsTable)
    .leftJoin(clientsTable, joinQuotationClient(userId, dataMode))
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));
  const items = await loadLineItems(db, QUOTATION_ITEMS, id);
  res.json(quotationDto(joined!.quotation, items, joined!.clientName));
});

router.patch("/quotations/:id/archive", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = UpdateQuotationParams.parse(req.params);
  const reason = zz.string().optional().parse((req.body as { cancellationReason?: string })?.cancellationReason);
  const [existing] = await db
    .select({ status: quotationsTable.status })
    .from(quotationsTable)
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  const transitionErr = quotationTransitionError(existing.status, "skip");
  if (transitionErr) {
    res.status(422).json({ error: transitionErr });
    return;
  }
  const [row] = await db
    .update(quotationsTable)
    .set({
      status: "skip",
      cancellationReason: reason ?? "Archived",
      updatedAt: new Date(),
    })
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  await logAuditEvent({
    userId,
    dataMode,
    entityType: "quotation",
    entityId: id,
    eventType: "status_changed",
    eventData: { from: existing.status, to: "skip" },
  });
  const [joined] = await db
    .select({ quotation: quotationsTable, clientName: clientsTable.name })
    .from(quotationsTable)
    .leftJoin(clientsTable, joinQuotationClient(userId, dataMode))
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));
  const items = await loadLineItems(db, QUOTATION_ITEMS, id);
  res.json(UpdateQuotationResponse.parse(quotationDto(joined!.quotation, items, joined!.clientName)));
});

router.post("/quotations/:id/duplicate", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = UpdateQuotationParams.parse(req.params);
  const [src] = await db
    .select()
    .from(quotationsTable)
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));
  if (!src) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  const srcItems = await loadLineItems(db, QUOTATION_ITEMS, src.id);
  const totals = calculateTotals(srcItems, toNumber(src.discountAmount));
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(quotationsTable)
      .values({
        userId,
        dataMode,
        clientId: src.clientId,
        quotationNumber: await nextDocumentNumber(userId, "quotation", undefined, tx, dataMode),
        quotationDate: src.quotationDate,
        validUntil: src.validUntil,
        status: "draft",
        currency: src.currency as "HKD" | "USD" | "CNY" | "MOP",
        serviceCategory: src.serviceCategory ?? "others",
        subtotal: money(totals.subtotal),
        discountAmount: money(totals.discountAmount),
        total: money(totals.total),
        termsConditions: src.termsConditions,
        remark: src.remark,
        quotationAttn: src.quotationAttn,
      })
      .returning();
    await replaceLineItems(tx, QUOTATION_ITEMS, inserted.id, srcItems);
    return inserted;
  });
  res.status(201).json(quotationDto(row, srcItems));
});

router.patch("/quotations/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = UpdateQuotationParams.parse(req.params);
  const body = UpdateQuotationBody.parse(req.body);
  const clientCheck = await assertClientOwnedByUser(userId, body.clientId, dataMode);
  if (!clientCheck.ok) {
    res.status(clientCheck.status).json({ error: clientCheck.error });
    return;
  }

  const [existing] = await db
    .select({ status: quotationsTable.status })
    .from(quotationsTable)
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  if (existing.status === "invoiced") {
    res.status(422).json({ error: "Invoiced quotations cannot be edited." });
    return;
  }

  const nextStatus = body.status ?? existing.status;
  const transitionErr = quotationTransitionError(existing.status, nextStatus);
  if (transitionErr) {
    res.status(422).json({ error: transitionErr });
    return;
  }

  const totals = calculateTotals(body.items, body.discountAmount ?? 0);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(quotationsTable)
      .set({
        clientId: body.clientId,
        quotationDate: body.quotationDate,
        validUntil: body.validUntil,
        status: nextStatus,
        currency: body.currency,
        serviceCategory: body.serviceCategory ?? "others",
        subtotal: money(totals.subtotal),
        discountAmount: money(totals.discountAmount),
        total: money(totals.total),
        ...(body.cancellationReason !== undefined ? { cancellationReason: body.cancellationReason || null } : {}),
        termsConditions: body.termsConditions !== undefined ? (body.termsConditions || null) : undefined,
        remark: body.remark !== undefined ? (body.remark || null) : undefined,
        ...(body.quotationAttn !== undefined
          ? { quotationAttn: body.quotationAttn?.trim() ? body.quotationAttn.trim() : null }
          : {}),
        ...(body.driveFileUrl !== undefined
          ? { driveFileUrl: body.driveFileUrl?.trim() ? body.driveFileUrl.trim() : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)))
      .returning();
    if (updated) {
      await replaceLineItems(tx, QUOTATION_ITEMS, id, body.items);
    }
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  if (existing.status !== nextStatus) {
    await logAuditEvent({
      userId,
      dataMode,
      entityType: "quotation",
      entityId: id,
      eventType: "status_changed",
      eventData: { from: existing.status, to: nextStatus },
    });
  }
  res.json(UpdateQuotationResponse.parse(quotationDto(row, body.items)));
});

router.delete("/quotations/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = DeleteQuotationParams.parse(req.params);
  const [row] = await db
    .update(quotationsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)))
    .returning({ id: quotationsTable.id });
  if (row) {
    await logAuditEvent({ userId, dataMode, entityType: "quotation", entityId: id, eventType: "deleted" });
  }
  res.status(204).send();
});

router.post("/quotations/:id/restore", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GetQuotationParams.parse(req.params);
  const [row] = await db
    .update(quotationsTable)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), eq(quotationsTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  await logAuditEvent({ userId, dataMode, entityType: "quotation", entityId: id, eventType: "restored" });
  const items = await loadLineItems(db, QUOTATION_ITEMS, id);
  res.json(quotationDto(row, items));
});

router.post("/quotations/:id/convert", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = ConvertQuotationParams.parse(req.params);
  const overrides =
    req.body && typeof req.body === "object" && Object.keys(req.body as object).length > 0
      ? ConvertQuotationBody.parse(req.body)
      : {};
  if (overrides.clientId) {
    const clientCheck = await assertClientOwnedByUser(userId, overrides.clientId, dataMode);
    if (!clientCheck.ok) {
      res.status(clientCheck.status).json({ error: clientCheck.error });
      return;
    }
  }
  let consultantIds = overrides.consultantIds;
  if (consultantIds && consultantIds.length > 3) {
    res.status(400).json({ error: "An invoice can have at most 3 consultants" });
    return;
  }
  try {
    if (consultantIds !== undefined) await assertConsultantIdsExist(consultantIds);
  } catch (err) {
    if (err instanceof ConsultantIdsInvalidError) {
      res.status(400).json({ error: "One or more consultants were not found." });
      return;
    }
    throw err;
  }

  const result = await withUniqueRetry(() =>
    db.transaction(async (tx) => {
      const [quotation] = await tx
        .select()
        .from(quotationsTable)
        .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)))
        .for("update");
      if (!quotation) {
        return { kind: "not_found" as const };
      }
      if (quotation.status === "invoiced" || quotation.convertedInvoiceId) {
        return { kind: "already" as const, convertedInvoiceId: quotation.convertedInvoiceId };
      }
      if (!canConvertQuotation(quotation.status)) {
        return { kind: "not_ready" as const };
      }
      const quotationItems = await loadLineItems(tx, QUOTATION_ITEMS, quotation.id);
      const invoiceItems = (overrides.items ?? quotationItems).map((it) => ({
        name: it.name,
        description: it.description ?? "",
        details: it.details ?? "",
        quantity: it.quantity,
        price: it.price,
        taxRate: it.taxRate,
      }));
      const discountAmount = overrides.discountAmount ?? toNumber(quotation.discountAmount);
      const totals = calculateTotals(invoiceItems, discountAmount);
      const invoiceStatus = overrides.status ?? "draft";
      const convertStatusErr = invoiceTransitionError("draft", invoiceStatus);
      if (convertStatusErr) {
        return { kind: "invalid_status" as const, error: convertStatusErr };
      }
      const [inserted] = await tx
        .insert(invoicesTable)
        .values({
          userId,
          dataMode,
          clientId: overrides.clientId ?? quotation.clientId,
          invoiceNumber: await nextDocumentNumber(userId, "invoice", undefined, tx, dataMode),
          invoiceDate: overrides.invoiceDate ?? today(),
          dueDate: overrides.dueDate ?? today(30),
          status: invoiceStatus,
          currency: overrides.currency ?? quotation.currency,
          serviceCategory: overrides.serviceCategory ?? quotation.serviceCategory ?? "others",
          subtotal: money(totals.subtotal),
          taxAmount: money(totals.taxAmount),
          discountAmount: money(totals.discountAmount),
          total: money(totals.total),
          paidAmount: money(0),
          notes: overrides.notes ?? null,
          internalNote: overrides.internalNote || null,
          termsConditions: overrides.termsConditions ?? quotation.termsConditions,
          remark: overrides.remark ?? quotation.remark,
        })
        .returning();
      await replaceLineItems(tx, INVOICE_ITEMS, inserted.id, invoiceItems);
      await replaceConsultantIds(tx, INVOICE_CONSULTANTS, inserted.id, consultantIds ?? []);
      await tx
        .update(quotationsTable)
        .set({ status: "invoiced", convertedInvoiceId: inserted.id, updatedAt: new Date() })
        .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));
      await logAuditEvent(
        { userId, dataMode, entityType: "quotation", entityId: id, eventType: "status_changed", eventData: { from: quotation.status, to: "invoiced" } },
        tx,
      );
      return { kind: "ok" as const, invoice: inserted, invoiceItems, consultantIds: consultantIds ?? [] };
    }),
  );
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }
  if (result.kind === "already") {
    res.status(409).json({
      error: "Quotation already converted",
      convertedInvoiceId: result.convertedInvoiceId,
    });
    return;
  }
  if (result.kind === "not_ready") {
    res.status(422).json({ error: CONVERT_QUOTATION_ERROR });
    return;
  }
  if (result.kind === "invalid_status") {
    res.status(422).json({ error: result.error });
    return;
  }
  res.status(201).json(invoiceDto(result.invoice, result.consultantIds, result.invoiceItems));
});

const SHARE_TOKEN_EXPIRY_DAYS = parseShareTokenExpiryDays(process.env.SHARE_TOKEN_EXPIRY_DAYS);

router.post("/quotations/:id/share-token", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GetQuotationParams.parse(req.params);

  const [quotation] = await db
    .select({ id: quotationsTable.id })
    .from(quotationsTable)
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));

  if (!quotation) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }

  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SHARE_TOKEN_EXPIRY_DAYS);

  await db
    .update(quotationsTable)
    .set({ shareToken: token, shareTokenExpiresAt: expiresAt, updatedAt: new Date() })
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));

  res.json({ token, expiresAt: expiresAt.toISOString() });
});

router.delete("/quotations/:id/share-token", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GetQuotationParams.parse(req.params);

  const [quotation] = await db
    .select({ id: quotationsTable.id })
    .from(quotationsTable)
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));

  if (!quotation) {
    res.status(404).json({ error: "Quotation not found" });
    return;
  }

  await db
    .update(quotationsTable)
    .set({ shareToken: null, shareTokenExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), isNull(quotationsTable.deletedAt), eq(quotationsTable.id, id)));

  res.status(204).send();
});

router.post("/invoices/:id/share-token", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GetInvoiceParams.parse(req.params);

  const [invoice] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SHARE_TOKEN_EXPIRY_DAYS);

  await db
    .update(invoicesTable)
    .set({ shareToken: token, shareTokenExpiresAt: expiresAt, updatedAt: new Date() })
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), eq(invoicesTable.id, id)));

  res.json({ token, expiresAt: expiresAt.toISOString() });
});

router.delete("/invoices/:id/share-token", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GetInvoiceParams.parse(req.params);

  const [invoice] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  await db
    .update(invoicesTable)
    .set({ shareToken: null, shareTokenExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), eq(invoicesTable.id, id)));

  res.status(204).send();
});

export default router;
