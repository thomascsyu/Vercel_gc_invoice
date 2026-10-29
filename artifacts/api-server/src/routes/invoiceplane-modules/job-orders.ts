import {
  clientsTable,
  consultantsTable,
  db,
  invoicesTable,
  jobOrdersTable,
  proposalDocumentsTable,
  quotationsTable,
  type GmailAccount,
  type LineItem,
} from "@workspace/db";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import multer from "multer";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { assertClientOwnedByUser } from "../../lib/clientOwnership";
import { currentDataMode, type DataMode } from "../../lib/dataMode";
import {
  assertConsultantIdsExist,
  ConsultantIdsInvalidError,
  INVOICE_CONSULTANTS,
  JOB_ORDER_CONSULTANTS,
  loadConsultantIds,
  loadConsultantIdsByParent,
  replaceConsultantIds,
} from "../../lib/consultantLinks";
import {
  INVOICE_ITEMS,
  JOB_ORDER_ITEMS,
  loadLineItems,
  loadLineItemsByParent,
  QUOTATION_ITEMS,
  replaceLineItems,
} from "../../lib/lineItems";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { logger } from "../../lib/logger";
import {
  resolveSender,
  processTemplate,
  sendEmail,
} from "../../lib/emailHelpers";
import { fetchImageBuffer } from "../../lib/fetchImageBuffer";
import { streamJobOrderPdfToBuffer } from "../../lib/jobOrderPdfDraw";
import { setPdfDownloadHeaders } from "../../lib/pdfResponseHeaders";
import {
  extractProposalFieldsForJobOrder,
  extractTextFromProposalBuffer,
} from "../../lib/proposalExtraction";
import { withUniqueRetry } from "../../lib/withUniqueRetry";
import { DEFAULT_EMAIL_TEMPLATES, ensureCompanySettings, JobOrderItemSchema } from "./helpers";

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadProposal = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router: IRouter = Router();

// ---------- Job Orders ----------
const MAX_JOB_ORDER_CONSULTANTS = 3;

const JobOrderCreateSchema = z.object({
  clientId: z.string().uuid(),
  jobDate: z.string(),
  status: z.string().optional(),
  items: z.array(JobOrderItemSchema).default([]),
  notes: z.string().optional(),
  consultantIds: z
    .array(z.string().uuid())
    .max(MAX_JOB_ORDER_CONSULTANTS)
    .optional()
    .transform((a) => (a ? [...new Set(a)] : [])),
});

async function nextJobOrderNumber(
  userId: string,
  executor: Pick<typeof db, "select"> = db,
  dataMode?: DataMode,
) {
  const mode = dataMode ?? (await currentDataMode());
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [{ total }] = await executor
    .select({ total: count() })
    .from(jobOrdersTable)
    .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, mode)));
  return `JO${stamp}${String(Number(total) + 1).padStart(3, "0")}`;
}

function jobOrderDto(
  row: typeof jobOrdersTable.$inferSelect,
  consultantIds: string[],
  items: LineItem[],
  existingSourceIds?: Set<string>,
  clientName?: string | null,
  sourceNumbers?: Map<string, string>,
) {
  const sourceBroken =
    row.sourceType && row.sourceId
      ? existingSourceIds !== undefined
        ? !existingSourceIds.has(row.sourceId)
        : false
      : false;
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: clientName ?? undefined,
    jobOrderNumber: row.jobOrderNumber,
    jobDate: row.jobDate,
    status: row.status,
    sourceType: row.sourceType ?? undefined,
    sourceId: row.sourceId ?? undefined,
    sourceNumber: row.sourceId ? sourceNumbers?.get(row.sourceId) : undefined,
    sourceBroken: sourceBroken || undefined,
    items,
    consultantIds,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

const JobOrderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  search: z.string().optional(),
});

router.get("/job-orders", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const query = JobOrderListQuerySchema.parse(req.query);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const searchRaw = query.search?.trim() ?? "";
  const search = searchRaw.slice(0, 200);
  const clientJoin = and(
    eq(jobOrdersTable.clientId, clientsTable.id),
    eq(clientsTable.userId, userId),
    eq(clientsTable.dataMode, dataMode),
  );
  const baseFilter = and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode));
  const where = search
    ? and(
        baseFilter,
        or(
          ilike(jobOrdersTable.jobOrderNumber, `%${search}%`),
          ilike(jobOrdersTable.notes, `%${search}%`),
          ilike(clientsTable.name, `%${search}%`),
        ),
      )
    : baseFilter;
  const [{ total }] = await db
    .select({ total: count() })
    .from(jobOrdersTable)
    .leftJoin(clientsTable, clientJoin)
    .where(where);
  const rows = await db
    .select({ jo: jobOrdersTable, clientName: clientsTable.name })
    .from(jobOrdersTable)
    .leftJoin(clientsTable, clientJoin)
    .where(where)
    .orderBy(desc(jobOrdersTable.createdAt))
    .limit(pageSize)
    .offset(offset);

  const quotationSourceIds = rows
    .filter((r) => r.jo.sourceType === "quotation" && r.jo.sourceId)
    .map((r) => r.jo.sourceId as string);
  const invoiceSourceIds = rows
    .filter((r) => r.jo.sourceType === "invoice" && r.jo.sourceId)
    .map((r) => r.jo.sourceId as string);
  const proposalSourceIds = rows
    .filter((r) => r.jo.sourceType === "proposal" && r.jo.sourceId)
    .map((r) => r.jo.sourceId as string);

  const existingSourceIds = new Set<string>();
  const sourceNumbers = new Map<string, string>();

  if (quotationSourceIds.length > 0) {
    const found = await db
      .select({ id: quotationsTable.id, number: quotationsTable.quotationNumber })
      .from(quotationsTable)
      .where(
        and(
          eq(quotationsTable.userId, userId),
          eq(quotationsTable.dataMode, dataMode),
          inArray(quotationsTable.id, quotationSourceIds),
        ),
      );
    found.forEach((r) => { existingSourceIds.add(r.id); sourceNumbers.set(r.id, r.number); });
  }
  if (invoiceSourceIds.length > 0) {
    const found = await db
      .select({ id: invoicesTable.id, number: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.userId, userId),
          eq(invoicesTable.dataMode, dataMode),
          inArray(invoicesTable.id, invoiceSourceIds),
        ),
      );
    found.forEach((r) => { existingSourceIds.add(r.id); sourceNumbers.set(r.id, r.number); });
  }
  if (proposalSourceIds.length > 0) {
    const found = await db
      .select({ id: proposalDocumentsTable.id, number: proposalDocumentsTable.proposalNo })
      .from(proposalDocumentsTable)
      .where(and(eq(proposalDocumentsTable.userId, userId), inArray(proposalDocumentsTable.id, proposalSourceIds)));
    found.forEach((r) => { existingSourceIds.add(r.id); sourceNumbers.set(r.id, r.number); });
  }

  const consultantIdsByJobOrder = await loadConsultantIdsByParent(
    db,
    JOB_ORDER_CONSULTANTS,
    rows.map((r) => r.jo.id),
  );
  const itemsByJobOrder = await loadLineItemsByParent(db, JOB_ORDER_ITEMS, rows.map((r) => r.jo.id));
  res.json({
    data: rows.map((r) =>
      jobOrderDto(
        r.jo,
        consultantIdsByJobOrder.get(r.jo.id) ?? [],
        itemsByJobOrder.get(r.jo.id) ?? [],
        existingSourceIds,
        r.clientName,
        sourceNumbers,
      ),
    ),
    total: Number(total),
    page,
    pageSize,
  });
});

router.get("/job-orders/export", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const rows = await db
    .select({ jo: jobOrdersTable, clientName: clientsTable.name })
    .from(jobOrdersTable)
    .leftJoin(clientsTable, eq(jobOrdersTable.clientId, clientsTable.id))
    .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode)))
    .orderBy(desc(jobOrdersTable.createdAt));
  const csv = csvStringify(rows.map((r) => ({
    id: r.jo.id,
    jobOrderNumber: r.jo.jobOrderNumber,
    clientName: r.clientName ?? "",
    clientId: r.jo.clientId,
    jobDate: r.jo.jobDate,
    status: r.jo.status,
    sourceType: r.jo.sourceType ?? "",
    sourceId: r.jo.sourceId ?? "",
    notes: r.jo.notes ?? "",
    createdAt: r.jo.createdAt.toISOString(),
  })), { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=job-orders.csv");
  res.send(csv);
});

router.post("/job-orders/import", upload.single("file"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const userId = (req as unknown as AuthedRequest).dataUserId!;
    const dataMode = await currentDataMode();
    const commit = req.query.commit === "true";
    const records: Record<string, string>[] = csvParse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    const errors: string[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r.clientId) errors.push(`Row ${i + 1}: clientId is required`);
      if (!r.jobDate) errors.push(`Row ${i + 1}: jobDate is required`);
      if (r.items !== undefined && r.items !== "") {
        if (parseItemsColumn(r.items) === null) {
          errors.push(`Row ${i + 1}: items must be a valid JSON array (e.g. [{"name":"Service","quantity":1,"price":100,"taxRate":0}])`);
        }
      }
      if (r.sourceType && !["quotation", "invoice"].includes(r.sourceType)) {
        errors.push(`Row ${i + 1}: sourceType must be 'quotation' or 'invoice'`);
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
    const uniqueQuotationSourceIds = [
      ...new Set(
        records
          .filter((r) => (r.sourceType ?? "").toLowerCase() === "quotation" && r.sourceId)
          .map((r) => r.sourceId)
      ),
    ];
    if (uniqueQuotationSourceIds.length > 0) {
      const foundQuotations = await db
        .select({ id: quotationsTable.id })
        .from(quotationsTable)
        .where(
          and(
            eq(quotationsTable.userId, userId),
            eq(quotationsTable.dataMode, dataMode),
            inArray(quotationsTable.id, uniqueQuotationSourceIds),
          ),
        );
      const foundQuotationIds = new Set(foundQuotations.map((q) => q.id));
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if ((r.sourceType ?? "").toLowerCase() === "quotation" && r.sourceId && !foundQuotationIds.has(r.sourceId)) {
          errors.push(`Row ${i + 1}: sourceId ${r.sourceId} not found as a quotation`);
        }
      }
    }
    const uniqueInvoiceSourceIds = [
      ...new Set(
        records
          .filter((r) => (r.sourceType ?? "").toLowerCase() === "invoice" && r.sourceId)
          .map((r) => r.sourceId)
      ),
    ];
    if (uniqueInvoiceSourceIds.length > 0) {
      const foundInvoices = await db
        .select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(
          and(
            eq(invoicesTable.userId, userId),
            eq(invoicesTable.dataMode, dataMode),
            inArray(invoicesTable.id, uniqueInvoiceSourceIds),
          ),
        );
      const foundInvoiceIds = new Set(foundInvoices.map((inv) => inv.id));
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if ((r.sourceType ?? "").toLowerCase() === "invoice" && r.sourceId && !foundInvoiceIds.has(r.sourceId)) {
          errors.push(`Row ${i + 1}: sourceId ${r.sourceId} not found as an invoice`);
        }
      }
    }
    const existingJobOrders = await db
      .select({ clientId: jobOrdersTable.clientId, jobDate: jobOrdersTable.jobDate })
      .from(jobOrdersTable)
      .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode)));
    if (!commit) {
      const previewKeys = new Set(existingJobOrders.map((jo) => `${jo.clientId}|${jo.jobDate}`));
      const probableSkippedRows: Array<{ row: number; reason: string }> = [];
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.clientId && r.jobDate) {
          const key = `${r.clientId}|${r.jobDate}`;
          if (previewKeys.has(key)) {
            probableSkippedRows.push({ row: i + 1, reason: `probable duplicate job order (client ${r.clientId}, date ${r.jobDate})` });
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
    const existingJobOrderKeys = new Set(
      existingJobOrders.map((jo) => `${jo.clientId}|${jo.jobDate}`)
    );
    let inserted = 0;
    let skipped = 0;
    const skippedRows: Array<{ row: number; reason: string; data: Record<string, string> }> = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const key = `${r.clientId}|${r.jobDate}`;
      if (existingJobOrderKeys.has(key)) {
        skipped++;
        skippedRows.push({ row: i + 1, reason: `duplicate job order (client ${r.clientId}, ${r.jobDate})`, data: r });
        continue;
      }
      const items: LineItem[] = parseItemsColumn(r.items) ?? [];
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(jobOrdersTable)
          .values({
            userId,
            dataMode,
            clientId: r.clientId,
            jobOrderNumber: await nextJobOrderNumber(userId, tx, dataMode),
            jobDate: r.jobDate,
            status: r.status ?? "draft",
            notes: r.notes ?? null,
            sourceType: r.sourceType || null,
            sourceId: r.sourceId || null,
          })
          .returning();
        await replaceLineItems(tx, JOB_ORDER_ITEMS, row.id, items);
      });
      existingJobOrderKeys.add(key);
      inserted++;
    }
    res.json({ inserted, skipped, skippedRows, errors: [] });
  } catch (err) {
    logger.error({ err }, "Failed to parse job order CSV import");
    res.status(400).json({ error: "Failed to parse CSV. Check the file format and try again." });
  }
});

router.post("/job-orders/extract-proposal", uploadProposal.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const settings = await ensureCompanySettings();
  const apiKey = (settings.deepseekApiKey ?? "").trim();
  const model = (settings.deepseekModel ?? "deepseek-v4-flashas").trim() || "deepseek-v4-flashas";
  const base = (process.env["DEEPSEEK_API_BASE"] || "https://api.deepseek.com").replace(/\/$/, "");

  const textResult = await extractTextFromProposalBuffer(req.file.buffer, {
    mimetype: req.file.mimetype,
    originalname: req.file.originalname,
  });
  if ("error" in textResult) {
    res.status(400).json({ error: textResult.error });
    return;
  }

  const extracted = await extractProposalFieldsForJobOrder({
    text: textResult.text,
    coverText: textResult.coverText,
    apiKey,
    model,
    apiBase: base,
  });
  if ("error" in extracted) {
    res.status(apiKey ? 502 : 400).json({ error: extracted.error, detail: extracted.detail });
    return;
  }

  req.log?.info?.(
    { userId, bytes: req.file.size, name: req.file.originalname, source: extracted.source },
    "job_order_proposal_extracted",
  );

  res.json({
    fields: extracted.fields,
    notes: extracted.notes,
    lineItem: extracted.lineItem,
    source: extracted.source,
    textPreview: textResult.text.slice(0, 2000),
  });
});

router.post("/job-orders", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  try {
    const body = JobOrderCreateSchema.parse(req.body);
    const clientCheck = await assertClientOwnedByUser(userId, body.clientId, dataMode);
    if (!clientCheck.ok) {
      res.status(clientCheck.status).json({ error: clientCheck.error });
      return;
    }
    await assertConsultantIdsExist(body.consultantIds ?? []);
    const row = await withUniqueRetry(() =>
      db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(jobOrdersTable)
          .values({
            userId,
            dataMode,
            clientId: body.clientId,
            jobOrderNumber: await nextJobOrderNumber(userId, tx, dataMode),
            jobDate: body.jobDate,
            status: body.status ?? "draft",
            notes: body.notes ?? null,
          })
          .returning();
        await replaceConsultantIds(tx, JOB_ORDER_CONSULTANTS, inserted.id, body.consultantIds ?? []);
        await replaceLineItems(tx, JOB_ORDER_ITEMS, inserted.id, body.items);
        return inserted;
      }),
    );
    res.status(201).json(jobOrderDto(row, body.consultantIds ?? [], body.items));
  } catch (e) {
    if (e instanceof ConsultantIdsInvalidError) {
      res.status(400).json({ error: "One or more consultants were not found." });
      return;
    }
    throw e;
  }
});

router.post("/job-orders/quick-draft", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    .limit(1);
  if (!client) {
    res.status(400).json({ error: "Add a client before creating a job order." });
    return;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const items: LineItem[] = [{ name: "Description", quantity: 1, price: 0, taxRate: 0 }];
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(jobOrdersTable)
      .values({
        userId,
        dataMode,
        clientId: client.id,
        jobOrderNumber: await nextJobOrderNumber(userId, tx, dataMode),
        jobDate: todayStr,
        status: "draft",
        notes: null,
      })
      .returning();
    await replaceLineItems(tx, JOB_ORDER_ITEMS, inserted.id, items);
    return inserted;
  });
  res.status(201).json(jobOrderDto(row, [], items));
});

router.patch("/job-orders/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  try {
    // NOTE: JobOrderCreateSchema declares `items` with `.default([])` and
    // `consultantIds` with a `.transform` that coerces an absent value to
    // `[]` -- and zod v4's `.partial()` still applies both when the key is
    // absent from the request body, so `bodyRaw.items`/`bodyRaw.consultantIds`
    // are never `undefined`, even on a PATCH that never mentioned them.
    // Presence has to be checked against the raw, pre-parse request body
    // instead for both fields.
    const rawBodyObject = Boolean(req.body) && typeof req.body === "object" ? (req.body as object) : {};
    const itemsProvided = "items" in rawBodyObject;
    const consultantIdsProvided = "consultantIds" in rawBodyObject;
    const bodyRaw = JobOrderCreateSchema.partial().parse(req.body);
    if (bodyRaw.clientId) {
      const clientCheck = await assertClientOwnedByUser(userId, bodyRaw.clientId, dataMode);
      if (!clientCheck.ok) {
        res.status(clientCheck.status).json({ error: clientCheck.error });
        return;
      }
    }
    const consultantIds = consultantIdsProvided ? [...new Set(bodyRaw.consultantIds)] : undefined;
    if (consultantIds !== undefined && consultantIds.length > MAX_JOB_ORDER_CONSULTANTS) {
      res.status(400).json({ error: `At most ${MAX_JOB_ORDER_CONSULTANTS} consultants per job order.` });
      return;
    }
    if (consultantIds !== undefined) await assertConsultantIdsExist(consultantIds);
    const body = { ...bodyRaw, consultantIds };
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(jobOrdersTable)
        .set({
          clientId: body.clientId,
          jobDate: body.jobDate,
          status: body.status,
          notes: body.notes,
          updatedAt: new Date(),
        })
        .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode), eq(jobOrdersTable.id, id)))
        .returning();
      if (updated) {
        if (consultantIds !== undefined) {
          await replaceConsultantIds(tx, JOB_ORDER_CONSULTANTS, id, consultantIds);
        }
        // items is optional on this endpoint (.partial()) — a notes/status-only
        // PATCH must not wipe existing line items, so only replace when the
        // caller actually sent an `items` key (see itemsProvided note above).
        if (itemsProvided) {
          await replaceLineItems(tx, JOB_ORDER_ITEMS, id, body.items ?? []);
        }
      }
      return updated;
    });
    if (!row) {
      res.status(404).json({ error: "Job order not found" });
      return;
    }
    const responseConsultantIds =
      consultantIds !== undefined ? consultantIds : await loadConsultantIds(db, JOB_ORDER_CONSULTANTS, id);
    const responseItems = itemsProvided ? (body.items ?? []) : await loadLineItems(db, JOB_ORDER_ITEMS, id);
    res.json(jobOrderDto(row, responseConsultantIds, responseItems));
  } catch (e) {
    if (e instanceof ConsultantIdsInvalidError) {
      res.status(400).json({ error: "One or more consultants were not found." });
      return;
    }
    throw e;
  }
});

router.patch("/job-orders/:id/archive", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const [row] = await db
    .update(jobOrdersTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode), eq(jobOrdersTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Job order not found" });
    return;
  }
  const consultantIds = await loadConsultantIds(db, JOB_ORDER_CONSULTANTS, id);
  const items = await loadLineItems(db, JOB_ORDER_ITEMS, id);
  res.json(jobOrderDto(row, consultantIds, items));
});

router.post("/job-orders/:id/duplicate", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const [src] = await db
    .select()
    .from(jobOrdersTable)
    .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode), eq(jobOrdersTable.id, id)));
  if (!src) {
    res.status(404).json({ error: "Job order not found" });
    return;
  }
  const srcConsultantIds = await loadConsultantIds(db, JOB_ORDER_CONSULTANTS, src.id);
  const srcItems = await loadLineItems(db, JOB_ORDER_ITEMS, src.id);
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(jobOrdersTable)
      .values({
        userId,
        dataMode,
        clientId: src.clientId,
        jobOrderNumber: await nextJobOrderNumber(userId, tx, dataMode),
        jobDate: src.jobDate,
        status: "draft",
        notes: src.notes ?? null,
      })
      .returning();
    await replaceConsultantIds(tx, JOB_ORDER_CONSULTANTS, inserted.id, srcConsultantIds);
    await replaceLineItems(tx, JOB_ORDER_ITEMS, inserted.id, srcItems);
    return inserted;
  });
  res.status(201).json(jobOrderDto(row, srcConsultantIds, srcItems));
});

router.delete("/job-orders/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  await db
    .delete(jobOrdersTable)
    .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode), eq(jobOrdersTable.id, id)));
  res.status(204).send();
});

// ---------- Job Order PDF ----------
async function buildJobOrderPdf(
  jobOrderId: string,
  userId: string,
  dataMode: DataMode,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const [row] = await db
    .select({ jo: jobOrdersTable, client: clientsTable })
    .from(jobOrdersTable)
    .leftJoin(
      clientsTable,
      and(eq(jobOrdersTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode), eq(jobOrdersTable.id, jobOrderId)));
  if (!row) return null;

  const settings = await getCompanySettings({ fresh: true });
  const { jo, client } = row;

  // consultantIds is already ordered by shortCode (see loadConsultantIds) --
  // note this is a behavior change from the old jsonb array, which preserved
  // insertion/submission order; the PDF now lists consultants by shortCode.
  const consultantIds = await loadConsultantIds(db, JOB_ORDER_CONSULTANTS, jo.id);
  let consultantNamesOrdered: string[] = [];
  if (consultantIds.length > 0) {
    const consultants = await db
      .select({ id: consultantsTable.id, name: consultantsTable.name })
      .from(consultantsTable)
      .where(inArray(consultantsTable.id, consultantIds));
    const nameById = new Map(consultants.map((c) => [c.id, c.name]));
    consultantNamesOrdered = consultantIds
      .map((id) => nameById.get(id))
      .filter((name): name is string => Boolean(name));
  }

  const [logoBuffer, headerLogoBuffer] = await Promise.all([
    settings?.logoUrl ? fetchImageBuffer(settings.logoUrl) : Promise.resolve(null),
    settings?.headerLogoUrl ? fetchImageBuffer(settings.headerLogoUrl) : Promise.resolve(null),
  ]);

  const items = await loadLineItems(db, JOB_ORDER_ITEMS, jo.id);
  const buffer = await streamJobOrderPdfToBuffer(
    { ...jo, items },
    client,
    settings,
    logoBuffer,
    headerLogoBuffer,
    consultantNamesOrdered,
  );
  return { buffer, filename: `job-order-${jo.jobOrderNumber}.pdf` };
}

router.get("/job-orders/:id/pdf", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const result = await buildJobOrderPdf(id, userId, dataMode);
  if (!result) { res.status(404).json({ error: "Job order not found" }); return; }
  const inline = req.query.inline === "true" || req.query.inline === "1";
  setPdfDownloadHeaders(
    res,
    `${inline ? "inline" : "attachment"}; filename="${result.filename}"`,
  );
  res.send(result.buffer);
});

router.post("/job-orders/:id/email-consultant", async (req, res) => {
  if ((await currentDataMode()) === "test") {
    res.status(403).json({
      error: "Outbound email is disabled while company test mode is on. Turn off test mode to email consultants.",
    });
    return;
  }
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { consultantId } = z.object({ consultantId: z.string().uuid() }).parse(req.body);

  const [consultant] = await db
    .select()
    .from(consultantsTable)
    .where(eq(consultantsTable.id, consultantId));
  if (!consultant) { res.status(404).json({ error: "Consultant not found" }); return; }
  if (!consultant.email) { res.status(400).json({ error: "Consultant has no email address" }); return; }

  const settings = await getCompanySettings();

  const pdfResult = await buildJobOrderPdf(id, userId, dataMode);
  if (!pdfResult) { res.status(404).json({ error: "Job order not found" }); return; }

  const [joRow] = await db
    .select({ jo: jobOrdersTable, client: clientsTable })
    .from(jobOrdersTable)
    .leftJoin(
      clientsTable,
      and(eq(jobOrdersTable.clientId, clientsTable.id), eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)),
    )
    .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode), eq(jobOrdersTable.id, id)));

  const companyName = settings?.companyName || "Gabriel Consultant Limited";
  const joNumber = joRow?.jo.jobOrderNumber ?? id;
  const clientName = joRow?.client?.name ?? "—";
  const templates = settings?.emailTemplates ?? DEFAULT_EMAIL_TEMPLATES;
  const jobOrderTemplate = templates.jobOrder ?? DEFAULT_EMAIL_TEMPLATES.jobOrder;
  const processed = processTemplate(jobOrderTemplate, {
    consultant_name: consultant.name,
    job_order_number: joNumber,
    client_name: clientName,
    company_name: companyName,
  });
  const g1 = settings?.gmailAccount1 as GmailAccount | null;
  const g2 = settings?.gmailAccount2 as GmailAccount | null;
  const sender = resolveSender(g1, g2, 1);
  if (!sender) {
    res.status(400).json({
      error:
        "Gmail not connected — use Admin → Email → Email sending (Gmail API) to connect the primary mailbox.",
    });
    return;
  }

  try {
    await sendEmail({
      sender,
      fromName: companyName,
      to: consultant.email,
      subject: processed.subject,
      htmlBody: processed.body,
      attachments: [{ filename: pdfResult.filename, mimeType: "application/pdf", content: pdfResult.buffer }],
    });
    res.json({ ok: true, message: `Email sent to ${consultant.email}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to send email: ${msg}` });
  }
});

const ConvertJobOrderBodySchema = z.object({
  consultantIds: z
    .array(z.string().uuid())
    .max(MAX_JOB_ORDER_CONSULTANTS)
    .optional()
    .transform((a) => [...new Set(a ?? [])]),
});

router.post("/job-orders/from-quotation/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  try {
    const { consultantIds } = ConvertJobOrderBodySchema.parse(req.body ?? {});
    await assertConsultantIdsExist(consultantIds);
    const [q] = await db
      .select()
      .from(quotationsTable)
      .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode), eq(quotationsTable.id, id)));
    if (!q) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }
    const quotationItems = await loadLineItems(db, QUOTATION_ITEMS, q.id);
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(jobOrdersTable)
        .values({
          userId,
          dataMode,
          clientId: q.clientId,
          jobOrderNumber: await nextJobOrderNumber(userId, tx, dataMode),
          jobDate: new Date().toISOString().slice(0, 10),
          status: "draft",
          sourceType: "quotation",
          sourceId: q.id,
        })
        .returning();
      await replaceConsultantIds(tx, JOB_ORDER_CONSULTANTS, inserted.id, consultantIds);
      await replaceLineItems(tx, JOB_ORDER_ITEMS, inserted.id, quotationItems);
      return inserted;
    });
    res.status(201).json(jobOrderDto(row, consultantIds, quotationItems));
  } catch (e) {
    if (e instanceof ConsultantIdsInvalidError) {
      res.status(400).json({ error: "One or more consultants were not found." });
      return;
    }
    throw e;
  }
});

router.post("/job-orders/from-invoice/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  try {
    const { consultantIds } = ConvertJobOrderBodySchema.parse(req.body ?? {});
    const consultantIdsLimited = consultantIds.slice(0, MAX_JOB_ORDER_CONSULTANTS);
    const [inv] = await db
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), eq(invoicesTable.id, id)));
    if (!inv) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    let fromInvoiceConsultants = consultantIdsLimited;
    if (fromInvoiceConsultants.length === 0) {
      const invoiceConsultantIds = await loadConsultantIds(db, INVOICE_CONSULTANTS, inv.id);
      fromInvoiceConsultants = invoiceConsultantIds.slice(0, MAX_JOB_ORDER_CONSULTANTS);
    }
    if (fromInvoiceConsultants.length > 0) {
      await assertConsultantIdsExist(fromInvoiceConsultants);
    }
    const invoiceItems = await loadLineItems(db, INVOICE_ITEMS, inv.id);
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(jobOrdersTable)
        .values({
          userId,
          dataMode,
          clientId: inv.clientId,
          jobOrderNumber: await nextJobOrderNumber(userId, tx, dataMode),
          jobDate: new Date().toISOString().slice(0, 10),
          status: "draft",
          sourceType: "invoice",
          sourceId: inv.id,
        })
        .returning();
      await replaceConsultantIds(tx, JOB_ORDER_CONSULTANTS, inserted.id, fromInvoiceConsultants);
      await replaceLineItems(tx, JOB_ORDER_ITEMS, inserted.id, invoiceItems);
      return inserted;
    });
    res.status(201).json(jobOrderDto(row, fromInvoiceConsultants, invoiceItems));
  } catch (e) {
    if (e instanceof ConsultantIdsInvalidError) {
      res.status(400).json({ error: "One or more consultants were not found." });
      return;
    }
    throw e;
  }
});

export default router;
