import {
  CreateInvoiceBody,
  DeleteInvoiceParams,
  GetInvoiceParams,
  ListInvoicesQueryParams,
  UpdateInvoiceBody,
  UpdateInvoiceParams,
  UpdateInvoiceResponse,
} from "@workspace/api-zod";
import { z as zz } from "zod";
import {
  auditLogTable,
  clientsTable,
  consultantsTable,
  db,
  invoicesTable,
  paymentsTable,
  quotationsTable,
  receiptsTable,
  type LineItem,
} from "@workspace/db";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Router, type IRouter, type ErrorRequestHandler } from "express";
import { logger } from "../../lib/logger";
import { stringify as csvStringify } from "csv-stringify/sync";
import { parse as csvParse } from "csv-parse/sync";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { assertClientOwnedByUser } from "../../lib/clientOwnership";
import { joinInvoiceClient } from "../../lib/clientJoins";
import { currentDataMode } from "../../lib/dataMode";
import { streamInvoicePdf } from "../../lib/invoicePdfDraw";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { syncMilestoneInvoiceNumber } from "../../lib/proposalMilestoneBilling";
import { isUniqueViolation } from "../../lib/pgErrors";
import { withUniqueRetry } from "../../lib/withUniqueRetry";
import {
  assertConsultantIdsExist,
  ConsultantIdsInvalidError,
  INVOICE_CONSULTANTS,
  loadConsultantIds,
  loadConsultantIdsByParent,
  replaceConsultantIds,
} from "../../lib/consultantLinks";
import { INVOICE_ITEMS, loadLineItems, loadLineItemsByParent, replaceLineItems } from "../../lib/lineItems";
import {
  BulkIdsBody,
  calculateTotals,
  type DocumentNumberSeq,
  handleCsvImportUpload,
  invoiceDto,
  invoiceListDto,
  invoiceListSelect,
  invoiceNumberForRevisedStatus,
  isInternalNoteOnlyInvoicePatch,
  isNoOpInvoicePatch,
  isInvoiceNumberInUse,
  logAuditEvent,
  money,
  nextDocumentNumber,
  revisedInvoiceNumber,
  revisedInvoiceNumberConflictError,
  syncInvoicePayment,
  toNumber,
} from "./helpers";
import { isInvoiceFullyPaid } from "../../lib/invoicePaymentStatus";
import { businessCalendarToday, OVERDUE_INVOICE_STATUSES, invoiceTransitionError, verifyInvoiceContinuity } from "@workspace/invoice-utils";

const router: IRouter = Router();

/** Plain-text invoice CSV: separates multiple line items; each block can use additional lines for description. */
const INVOICE_CSV_ITEM_SEPARATOR = "\n---\n";

class ConsultantLimitError extends Error {}

function parseConsultantIds(body: unknown): string[] | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = (body as { consultantIds?: unknown }).consultantIds;
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((v): v is string => typeof v === "string");
  if (ids.length > 3) {
    throw new ConsultantLimitError("An invoice can have at most 3 consultants");
  }
  return ids;
}

const InvoiceStatusValues = ["draft", "pending_approval", "approved", "sent", "revised", "paid"] as const;
const InvoiceBulkStatusBody = zz.object({ ids: zz.array(zz.string().uuid()), status: zz.enum(InvoiceStatusValues) });
const InvoicesListQuery = ListInvoicesQueryParams.extend({
  sortBy: zz.enum(["invoiceNumber", "invoiceDate", "dueDate", "total", "status", "createdAt"]).optional(),
  sortDir: zz.enum(["asc", "desc"]).optional(),
  dateFrom: zz.string().optional(),
  dateTo: zz.string().optional(),
  overdue: zz.enum(["true", "1"]).optional(),
});
router.get("/invoices", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const query = InvoicesListQuery.parse(req.query);
  const conditions = [eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt)];
  if (query.status) conditions.push(eq(invoicesTable.status, query.status));
  if (query.clientId) conditions.push(eq(invoicesTable.clientId, query.clientId));
  if (query.dateFrom) conditions.push(gte(invoicesTable.invoiceDate, query.dateFrom));
  if (query.dateTo) conditions.push(lte(invoicesTable.invoiceDate, query.dateTo));
  if (query.overdue) {
    const todayStr = businessCalendarToday();
    conditions.push(inArray(invoicesTable.status, [...OVERDUE_INVOICE_STATUSES]));
    conditions.push(
      sql`COALESCE(${invoicesTable.dueDate}, ${invoicesTable.invoiceDate}) < ${todayStr}`,
    );
    conditions.push(sql`${invoicesTable.paidAmount}::numeric < ${invoicesTable.total}::numeric`);
  }
  const search = query.q?.trim();
  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      or(
        ilike(invoicesTable.invoiceNumber, searchPattern),
        ilike(clientsTable.name, searchPattern),
        ilike(clientsTable.clientCode, searchPattern),
        ilike(sql`${invoicesTable.total}::text`, searchPattern),
      ) ?? sql`false`,
    );
  }
  const where = and(...conditions);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const dir = query.sortDir === "asc" ? asc : desc;
  const orderCol = query.sortBy === "invoiceNumber" ? invoicesTable.invoiceNumber
    : query.sortBy === "invoiceDate" ? invoicesTable.invoiceDate
    : query.sortBy === "dueDate" ? invoicesTable.dueDate
    : query.sortBy === "total" ? invoicesTable.total
    : query.sortBy === "status" ? invoicesTable.status
    : invoicesTable.createdAt;
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(invoicesTable)
      .leftJoin(clientsTable, joinInvoiceClient(userId, dataMode))
      .where(where),
    db
      .select({ ...invoiceListSelect, clientName: clientsTable.name })
      .from(invoicesTable)
      .leftJoin(clientsTable, joinInvoiceClient(userId, dataMode))
      .where(where)
      .orderBy(dir(orderCol))
      .limit(pageSize)
      .offset(offset),
  ]);
  const consultantIdsByInvoice = await loadConsultantIdsByParent(
    db,
    INVOICE_CONSULTANTS,
    rows.map((row) => row.id),
  );
  res.json({
    data: rows.map((row) => {
      const { clientName, ...invoice } = row;
      return invoiceListDto(invoice, consultantIdsByInvoice.get(row.id) ?? [], clientName);
    }),
    total: Number(total),
    page,
    pageSize,
  });
});

// Preview only: the unique index resolves concurrent saves of the same number.
router.get("/invoices/next-number", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  res.setHeader("Cache-Control", "no-store");
  res.json({ invoiceNumber: await nextDocumentNumber(userId, "invoice") });
});

router.get("/invoices/number-availability", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { invoiceNumber } = zz.object({ invoiceNumber: zz.string().trim().min(1) }).parse(req.query);
  res.setHeader("Cache-Control", "no-store");
  res.json({ available: !await isInvoiceNumberInUse(userId, invoiceNumber) });
});

// Registered before /invoices/:id so "deleted" isn't captured as an :id.
router.get("/invoices/deleted", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const query = zz.object({ page: zz.coerce.number().int().min(1).optional(), pageSize: zz.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
  const where = and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), sql`${invoicesTable.deletedAt} IS NOT NULL`);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(invoicesTable).leftJoin(clientsTable, joinInvoiceClient(userId, dataMode)).where(where),
    db
      .select({ ...invoiceListSelect, clientName: clientsTable.name, deletedAt: invoicesTable.deletedAt })
      .from(invoicesTable)
      .leftJoin(clientsTable, joinInvoiceClient(userId, dataMode))
      .where(where)
      .orderBy(desc(invoicesTable.deletedAt))
      .limit(pageSize)
      .offset(offset),
  ]);
  const consultantIdsByInvoice = await loadConsultantIdsByParent(db, INVOICE_CONSULTANTS, rows.map((row) => row.id));
  res.json({
    data: rows.map((row) => {
      const { clientName, deletedAt, ...invoice } = row;
      return { ...invoiceListDto(invoice, consultantIdsByInvoice.get(row.id) ?? [], clientName), deletedAt: deletedAt?.toISOString() };
    }),
    total: Number(total),
    page,
    pageSize,
  });
});

// Registered before /invoices/:id so "continuity" isn't captured as an :id.
// Includes soft-deleted rows (voided) but not permanently purged invoices.
router.get("/invoices/continuity", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate,
      status: invoicesTable.status,
      deletedAt: invoicesTable.deletedAt,
      cancellationReason: invoicesTable.cancellationReason,
    })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)));
  res.json(
    verifyInvoiceContinuity(
      rows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        invoiceDate: row.invoiceDate,
        status: row.status,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        cancellationReason: row.cancellationReason,
      })),
    ),
  );
});

/** Invoice CSV `items`: plain text blocks separated by a line containing only `---`; inside a block, first line is the description headline, further lines are additional description. */
function formatInvoiceItemsForCsv(items: LineItem[] | null | undefined): string {
  const list = items ?? [];
  const blocks = list
    .map((item) => {
      const name = String(item.name ?? "").trim();
      const desc = String(item.description ?? "").trim().replace(/\r\n/g, "\n");
      if (!name && !desc) return "";
      if (!desc) return name;
      if (!name) return desc;
      return `${name}\n${desc}`;
    })
    .filter((s) => s !== "");
  return blocks.join(INVOICE_CSV_ITEM_SEPARATOR);
}

function parseInvoicePlainTextItemsCell(trimmed: string): LineItem[] {
  const normalized = trimmed.replace(/\r\n/g, "\n");

  const parseBlock = (block: string): LineItem | null => {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    if (lines.length === 0) return null;
    if (lines.length === 1) {
      return { name: lines[0], quantity: 1, price: 0, taxRate: 0 };
    }
    return {
      name: lines[0],
      description: lines.slice(1).join("\n"),
      quantity: 1,
      price: 0,
      taxRate: 0,
    };
  };

  if (normalized.includes("\n---\n")) {
    const out: LineItem[] = [];
    for (const b of normalized.split("\n---\n")) {
      const row = parseBlock(b);
      if (row) out.push(row);
    }
    return out;
  }

  const one = parseBlock(normalized);
  return one ? [one] : [];
}

function parseInvoiceItemsJsonArray(parsed: unknown[]): LineItem[] | null {
  const out: LineItem[] = [];
  for (const el of parsed) {
    if (typeof el === "string") {
      out.push({ name: el, quantity: 1, price: 0, taxRate: 0 });
      continue;
    }
    if (el === null || typeof el !== "object") return null;
    const item = el as Record<string, unknown>;
    const hasLegacyPricing =
      item.quantity !== undefined || item.price !== undefined || item.taxRate !== undefined;
    if (hasLegacyPricing) {
      out.push({
        name: String(item.name ?? ""),
        description: item.description !== undefined ? String(item.description) : undefined,
        details: item.details !== undefined ? String(item.details) : undefined,
        quantity: toNumber(item.quantity ?? 1),
        price: toNumber(item.price ?? 0),
        taxRate: toNumber(item.taxRate ?? 0),
      });
      continue;
    }
    const name = String(item.name ?? "");
    const desc = item.description !== undefined ? String(item.description) : undefined;
    const descTrim = desc?.trim();
    if (!name.trim() && descTrim) {
      out.push({ name: descTrim, quantity: 1, price: 0, taxRate: 0 });
      continue;
    }
    out.push({
      name,
      ...(descTrim ? { description: desc } : {}),
      quantity: 1,
      price: 0,
      taxRate: 0,
    });
  }
  return out;
}

/**
 * Invoice CSV: primary format is newline-separated descriptions (e.g. `ISO 9001` or two lines for two items).
 * Optional legacy: JSON array of strings or objects with optional quantity/price/taxRate.
 */
function parseInvoiceItemsColumn(raw: string | undefined): LineItem[] | null {
  if (!raw || raw.trim() === "") return [];
  const trimmed = raw.trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parseInvoiceItemsJsonArray(parsed);
      }
    } catch {
      // treat as plain text below
    }
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      const item = parsed;
      const hasLegacyPricing =
        item.quantity !== undefined || item.price !== undefined || item.taxRate !== undefined;
      if (hasLegacyPricing) {
        return [
          {
            name: String(item.name ?? ""),
            description: item.description !== undefined ? String(item.description) : undefined,
            details: item.details !== undefined ? String(item.details) : undefined,
            quantity: toNumber(item.quantity ?? 1),
            price: toNumber(item.price ?? 0),
            taxRate: toNumber(item.taxRate ?? 0),
          },
        ];
      }
      const name = String(item.name ?? "");
      const descVal = item.description !== undefined ? String(item.description) : undefined;
      if (!name.trim() && descVal?.trim()) {
        return [{ name: descVal.trim(), quantity: 1, price: 0, taxRate: 0 }];
      }
      return [
        {
          name,
          ...(descVal !== undefined && descVal.trim() !== "" ? { description: descVal } : {}),
          quantity: 1,
          price: 0,
          taxRate: 0,
        },
      ];
    } catch {
      // treat as plain text below
    }
  }

  return parseInvoicePlainTextItemsCell(trimmed);
}

router.get("/invoices/export", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const [rows, allConsultants] = await Promise.all([
    db
      .select({
        invoice: invoicesTable,
        clientName: clientsTable.name,
        clientCode: clientsTable.clientCode,
      })
      .from(invoicesTable)
      .leftJoin(clientsTable, joinInvoiceClient(userId, dataMode))
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt)))
      .orderBy(desc(invoicesTable.createdAt)),
    db.select({ id: consultantsTable.id, shortCode: consultantsTable.shortCode }).from(consultantsTable),
  ]);
  const consultantMap = new Map(allConsultants.map((c) => [c.id, c.shortCode]));
  const consultantIdsByInvoice = await loadConsultantIdsByParent(
    db,
    INVOICE_CONSULTANTS,
    rows.map((r) => r.invoice.id),
  );
  const itemsByInvoice = await loadLineItemsByParent(db, INVOICE_ITEMS, rows.map((r) => r.invoice.id));
  /** Exports full canonical fields; POST /invoices/import also accepts these camelCase headers alongside the simplified template format. */
  const csv = csvStringify(rows.map((r) => ({
    clientId: r.invoice.clientId,
    clientCode: r.clientCode ?? "",
    clientName: r.clientName ?? "",
    invoiceNumber: r.invoice.invoiceNumber,
    invoiceDate: r.invoice.invoiceDate,
    dueDate: r.invoice.dueDate ?? "",
    currency: r.invoice.currency,
    discountAmount: r.invoice.discountAmount,
    items: formatInvoiceItemsForCsv(itemsByInvoice.get(r.invoice.id) ?? []),
    subtotal: r.invoice.subtotal,
    total: r.invoice.total,
    notes: r.invoice.notes ?? "",
    internalNote: r.invoice.internalNote ?? "",
    id: r.invoice.id,
    status: r.invoice.status,
    paidAmount: r.invoice.paidAmount,
    consultants: (consultantIdsByInvoice.get(r.invoice.id) ?? [])
      .map((id) => consultantMap.get(id) ?? id)
      .join(", "),
    createdAt: r.invoice.createdAt.toISOString(),
  })), { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=invoices.csv");
  res.send(csv);
});

const INVOICE_IMPORT_CURRENCY_CODES = ["HKD", "USD", "CNY", "MOP"] as const;

/** Normalize CSV currency: blank defaults to HKD; unknown codes fall back to HKD (same as legacy import). */
function normalizeInvoiceImportCurrency(raw: string | undefined): (typeof INVOICE_IMPORT_CURRENCY_CODES)[number] {
  const t = (raw ?? "").trim().toUpperCase();
  if (!t) return "HKD";
  return INVOICE_IMPORT_CURRENCY_CODES.includes(t as (typeof INVOICE_IMPORT_CURRENCY_CODES)[number])
    ? (t as (typeof INVOICE_IMPORT_CURRENCY_CODES)[number])
    : "HKD";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isInvoiceImportUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function csvInvoiceLookupCell(record: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const v = record[key];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Reads a cell by header name, matching case/whitespace-insensitively against any of the given aliases. */
function csvInvoiceLookupByAlias(record: Record<string, string>, aliases: string[]): string {
  const wanted = new Set(aliases.map((a) => a.toLowerCase()));
  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(key.trim().toLowerCase()) && value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

/**
 * Maps the simplified "Invoice Number, Client name, Invoice Amount, Invoice Date, item1, item2"
 * import format (currency always defaults to HKD) onto the canonical field names the rest of the
 * import pipeline expects. Legacy camelCase headers (invoiceNumber, clientName, subtotal/total,
 * items, ...) keep working as-is so previously exported CSVs remain importable.
 */
function mapInvoiceImportRow(raw: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = { ...raw };

  const invoiceNumber = csvInvoiceLookupByAlias(raw, ["Invoice Number", "invoiceNumber"]);
  if (invoiceNumber) mapped.invoiceNumber = invoiceNumber;

  const clientName = csvInvoiceLookupByAlias(raw, ["Client name", "Client Name", "clientName"]);
  if (clientName) mapped.clientName = clientName;

  const invoiceDate = csvInvoiceLookupByAlias(raw, ["Invoice Date", "invoiceDate"]);
  if (invoiceDate) mapped.invoiceDate = invoiceDate;

  const invoiceAmount = csvInvoiceLookupByAlias(raw, ["Invoice Amount", "Amount"]);
  if (invoiceAmount) {
    if (!(mapped.subtotal ?? "").trim()) mapped.subtotal = invoiceAmount;
    if (!(mapped.total ?? "").trim()) mapped.total = invoiceAmount;
  }

  if (!(mapped.items ?? "").trim()) {
    const item1 = csvInvoiceLookupByAlias(raw, ["item1", "Item 1"]);
    const item2 = csvInvoiceLookupByAlias(raw, ["item2", "Item 2"]);
    const items = [item1, item2].filter((s) => s !== "");
    if (items.length > 0) mapped.items = items.join(INVOICE_CSV_ITEM_SEPARATOR);
  }

  return mapped;
}

function appendInvoiceImportIds(map: Map<string, string[]>, key: string, id: string) {
  const k = key.trim().toLowerCase();
  if (!k) return;
  const arr = map.get(k);
  if (arr) {
    if (!arr.includes(id)) arr.push(id);
  } else {
    map.set(k, [id]);
  }
}

type InvoiceImportRowState = {
  rowNum: number;
  raw: Record<string, string>;
  resolvedClientId: string | null;
  normalizedCurrency: (typeof INVOICE_IMPORT_CURRENCY_CODES)[number];
  errors: string[];
};

router.post("/invoices/import", handleCsvImportUpload, async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  try {
    const userId = (req as unknown as AuthedRequest).dataUserId!;
    const dataMode = await currentDataMode();
    const commit = req.query.commit === "true";
    const rawRecords: Record<string, string>[] = csvParse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    const records = rawRecords.map(mapInvoiceImportRow);
    const userClients = await db
      .select({
        id: clientsTable.id,
        clientCode: clientsTable.clientCode,
        email: clientsTable.email,
        name: clientsTable.name,
      })
      .from(clientsTable)
      .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)));

    const clientIds = new Set(userClients.map((c) => c.id));
    const codeToIds = new Map<string, string[]>();
    const emailToIds = new Map<string, string[]>();
    const nameToIds = new Map<string, string[]>();
    for (const c of userClients) {
      appendInvoiceImportIds(codeToIds, c.clientCode ?? "", c.id);
      if (c.email) appendInvoiceImportIds(emailToIds, c.email, c.id);
      appendInvoiceImportIds(nameToIds, c.name ?? "", c.id);
    }

    function resolveClientForInvoiceRow(rowNum: number, r: Record<string, string>): { id: string | null; errs: string[] } {
      const errs: string[] = [];
      const rawClientId = (r.clientId ?? "").trim();
      const altCode = csvInvoiceLookupCell(r, ["clientCode", "client_code"]);
      const altEmail = csvInvoiceLookupCell(r, ["clientEmail", "email"]);
      const altName = csvInvoiceLookupCell(r, ["clientName", "name"]);

      const resolveSingle = (label: string, ids: string[], hint: string): string | null => {
        if (ids.length === 0) {
          errs.push(`Row ${rowNum}: no client matches ${label} "${hint}"`);
          return null;
        }
        if (ids.length > 1) {
          errs.push(`Row ${rowNum}: multiple clients match ${label} "${hint}" — use clientId (UUID) or a unique clientCode`);
          return null;
        }
        return ids[0]!;
      };

      if (rawClientId) {
        if (isInvoiceImportUuid(rawClientId)) {
          if (!clientIds.has(rawClientId)) {
            errs.push(`Row ${rowNum}: clientId ${rawClientId} not found`);
            return { id: null, errs };
          }
          return { id: rawClientId, errs };
        }
        const byCode = codeToIds.get(rawClientId.toLowerCase()) ?? [];
        const id = resolveSingle("clientId/code", byCode, rawClientId);
        return { id, errs };
      }
      if (altCode) {
        const id = resolveSingle("clientCode", codeToIds.get(altCode.toLowerCase()) ?? [], altCode);
        return { id, errs };
      }
      if (altEmail) {
        const id = resolveSingle("email", emailToIds.get(altEmail.toLowerCase()) ?? [], altEmail);
        return { id, errs };
      }
      if (altName) {
        const id = resolveSingle("client name", nameToIds.get(altName.toLowerCase()) ?? [], altName);
        return { id, errs };
      }
      errs.push(
        `Row ${rowNum}: client is required — use clientId (UUID), clientCode, email, or clientName/name`,
      );
      return { id: null, errs };
    }

    const rowStates: InvoiceImportRowState[] = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const rowNum = i + 1;
      const { id: resolvedClientId, errs: resolveErrs } = resolveClientForInvoiceRow(rowNum, r);
      const errs = [...resolveErrs];
      const invoiceDate = (r.invoiceDate ?? "").trim();
      if (!invoiceDate) errs.push(`Row ${rowNum}: invoiceDate is required`);

      const normalizedCurrency = normalizeInvoiceImportCurrency(r.currency);

      if (r.items !== undefined && r.items !== "") {
        if (parseInvoiceItemsColumn(r.items) === null) {
          errs.push(
            `Row ${rowNum}: items must be plain text (blocks separated by a line containing only ---; first line of each block is title, more lines are description) or legacy JSON`,
          );
        }
      }

      const subAmt = (r.subtotal ?? "").trim();
      const totAmt = (r.total ?? "").trim();
      const amountColsSet = [subAmt, totAmt].filter((x) => x !== "").length;
      if (amountColsSet !== 0 && amountColsSet !== 2) {
        errs.push(
          `Row ${rowNum}: set subtotal and total together, or leave both blank to derive amounts from line items`,
        );
      } else if (amountColsSet === 2) {
        if (toNumber(subAmt) < 0 || toNumber(totAmt) < 0) {
          errs.push(`Row ${rowNum}: subtotal and total must be non-negative`);
        }
      }

      rowStates.push({
        rowNum,
        raw: r,
        resolvedClientId,
        normalizedCurrency,
        errors: errs,
      });
    }

    const errors = rowStates.flatMap((s) => s.errors);
    const validRowStates = rowStates.filter((s) => s.errors.length === 0);

    const existingInvoices = await db
      .select({ clientId: invoicesTable.clientId, invoiceDate: invoicesTable.invoiceDate, currency: invoicesTable.currency })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt)));
    if (!commit) {
      const previewKeys = new Set(existingInvoices.map((inv) => `${inv.clientId}|${inv.invoiceDate}`));
      const probableSkippedRows: Array<{ row: number; reason: string; data?: Record<string, string> }> = [];
      for (const s of validRowStates) {
        const cid = s.resolvedClientId!;
        const invDate = (s.raw.invoiceDate ?? "").trim();
        const key = `${cid}|${invDate}`;
        if (previewKeys.has(key)) {
          probableSkippedRows.push({
            row: s.rowNum,
            reason: `probable duplicate invoice (client ${cid}, date ${invDate})`,
            data: s.raw,
          });
        }
      }
      res.json({
        previewCount: validRowStates.length,
        totalRowsInFile: records.length,
        errors,
        probableSkips: probableSkippedRows.length,
        probableSkippedRows,
      });
      return;
    }

    const existingInvoiceKeys = new Set(
      existingInvoices.map((inv) => `${inv.clientId}|${inv.invoiceDate}|${inv.currency}`)
    );
    let inserted = 0;
    let skipped = 0;
    const skippedRows: Array<{ row: number; reason: string; data: Record<string, string> }> = [];
    const commitErrors: string[] = [];
    const docSeq: DocumentNumberSeq = {};

    for (const s of rowStates) {
      const r = s.raw;
      if (s.errors.length > 0) {
        skipped++;
        skippedRows.push({
          row: s.rowNum,
          reason: s.errors.join("; "),
          data: r,
        });
        commitErrors.push(...s.errors);
        continue;
      }
      const cid = s.resolvedClientId!;
      const currency = s.normalizedCurrency;
      const key = `${cid}|${r.invoiceDate}|${currency}`;
      if (existingInvoiceKeys.has(key)) {
        skipped++;
        skippedRows.push({
          row: s.rowNum,
          reason: `duplicate invoice (client ${cid}, ${r.invoiceDate}, ${currency})`,
          data: r,
        });
        continue;
      }
      const items: LineItem[] = parseInvoiceItemsColumn(r.items) ?? [];
      const discountAmount = r.discountAmount ? toNumber(r.discountAmount) : 0;
      const subAmt = (r.subtotal ?? "").trim();
      const totAmt = (r.total ?? "").trim();
      const useExplicitAmounts = subAmt !== "" && totAmt !== "";
      const totals = useExplicitAmounts
        ? (() => {
            const subtotal = toNumber(subAmt);
            const total = toNumber(totAmt);
            const taxAmount = Math.max(0, total - subtotal + discountAmount);
            return { subtotal, taxAmount, total, discountAmount };
          })()
        : calculateTotals(items, discountAmount);
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(invoicesTable)
          .values({
            userId,
            dataMode,
            clientId: cid,
            // Preserve imported invoice number when provided; otherwise auto-generate
            invoiceNumber: (r.invoiceNumber && r.invoiceNumber.trim())
              ? r.invoiceNumber.trim()
              : await nextDocumentNumber(userId, "invoice", docSeq, tx, dataMode),
            invoiceDate: r.invoiceDate,
            dueDate: r.dueDate ?? null,
            status: "draft",
            currency,
            subtotal: money(totals.subtotal),
            taxAmount: money(totals.taxAmount),
            discountAmount: money(useExplicitAmounts ? discountAmount : totals.discountAmount),
            total: money(totals.total),
            paidAmount: money(0),
            notes: r.notes || null,
            internalNote: r.internalNote || null,
          })
          .returning();
        await replaceLineItems(tx, INVOICE_ITEMS, row.id, items);
      });
      existingInvoiceKeys.add(key);
      inserted++;
    }
    res.json({ inserted, skipped, skippedRows, errors: commitErrors });
  } catch (err) {
    logger.error({ err }, "Failed to parse invoice CSV import");
    res.status(400).json({ error: "Failed to parse CSV. Check the file format and try again." });
  }
});

router.post("/invoices", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const body = CreateInvoiceBody.parse(req.body);
  const clientCheck = await assertClientOwnedByUser(userId, body.clientId, dataMode);
  if (!clientCheck.ok) {
    res.status(clientCheck.status).json({ error: clientCheck.error });
    return;
  }
  let consultantIds: string[] | undefined;
  try {
    consultantIds = parseConsultantIds(req.body);
  } catch (err) {
    if (err instanceof ConsultantLimitError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
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
  const totals = calculateTotals(body.items, body.discountAmount ?? 0);
  const status = body.status ?? "draft";
  if (status === "paid") {
    res.status(422).json({ error: "Mark an invoice paid by recording payments that cover the total." });
    return;
  }
  const createTransitionErr = invoiceTransitionError("draft", status);
  if (createTransitionErr) {
    res.status(422).json({ error: createTransitionErr });
    return;
  }
  const manualNumber = body.invoiceNumber?.trim();
  if (body.invoiceNumber !== undefined && !manualNumber) {
    res.status(400).json({ error: "Invoice number required" });
    return;
  }
  const requestedNumber = manualNumber && (status === "revised" ? revisedInvoiceNumber(manualNumber) : manualNumber);
  if (requestedNumber && await isInvoiceNumberInUse(userId, requestedNumber, [], dataMode)) {
    res.status(409).json({ error: "Duplicate invoice number" });
    return;
  }
  const createInvoice = () =>
    db.transaction(async (tx) => {
      let invoiceNumber = manualNumber || await nextDocumentNumber(userId, "invoice", undefined, tx, dataMode);
      if (status === "revised") {
        invoiceNumber = revisedInvoiceNumber(invoiceNumber);
      }
      const [inserted] = await tx
        .insert(invoicesTable)
        .values({
          userId,
          dataMode,
          clientId: body.clientId,
          invoiceNumber,
          invoiceDate: body.invoiceDate,
          dueDate: body.dueDate,
          status,
          currency: body.currency,
          serviceCategory: body.serviceCategory ?? "others",
          subtotal: money(totals.subtotal),
          taxAmount: money(totals.taxAmount),
          discountAmount: money(totals.discountAmount),
          total: money(totals.total),
          paidAmount: money(0),
          notes: body.notes ?? null,
          internalNote: body.internalNote || null,
          termsConditions: body.termsConditions ?? null,
          remark: body.remark ?? null,
        })
        .returning();
      await replaceConsultantIds(tx, INVOICE_CONSULTANTS, inserted.id, consultantIds ?? []);
      await replaceLineItems(tx, INVOICE_ITEMS, inserted.id, body.items);
      return inserted;
    });
  const row = await (manualNumber ? createInvoice() : withUniqueRetry(createInvoice));
  res.status(201).json(invoiceDto(row, consultantIds ?? [], body.items));
});

/** Single-line draft for empty workspace (first client required). */
router.post("/invoices/quick-draft", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    .limit(1);
  if (!client) {
    res.status(400).json({ error: "Add a client before creating an invoice." });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const items: LineItem[] = [{ name: "Description", quantity: 1, price: 0, taxRate: 0 }];
  const totals = calculateTotals(items, 0);
  const row = await db.transaction(async (tx) => {
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
        serviceCategory: "others",
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
  res.status(201).json(invoiceDto(row, [], items));
});

router.get("/invoices/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = GetInvoiceParams.parse(req.params);
  const [row] = await db
    .select({ invoice: invoicesTable, clientName: clientsTable.name })
    .from(invoicesTable)
    .leftJoin(clientsTable, joinInvoiceClient(userId, dataMode))
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const consultantIds = await loadConsultantIds(db, INVOICE_CONSULTANTS, row.invoice.id);
  const items = await loadLineItems(db, INVOICE_ITEMS, row.invoice.id);
  res.json(invoiceDto(row.invoice, consultantIds, items, row.clientName));
});

router.delete("/invoices/bulk-delete", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { ids } = BulkIdsBody.parse(req.body);
  if (ids.length === 0) { res.status(204).send(); return; }
  await db.transaction(async (tx) => {
    // Quotations converted to any of these invoices would otherwise be left
    // stuck in the terminal "invoiced" state pointing at a deleted invoice.
    await tx
      .update(quotationsTable)
      .set({ status: "confirmed", convertedInvoiceId: null, updatedAt: new Date() })
      .where(
        and(
          eq(quotationsTable.userId, userId),
          eq(quotationsTable.dataMode, dataMode),
          inArray(quotationsTable.convertedInvoiceId, ids),
        ),
      );
    const now = new Date();
    const deleted = await tx
      .update(invoicesTable)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), inArray(invoicesTable.id, ids)))
      .returning({ id: invoicesTable.id });
    if (deleted.length === 0) return;
    const deletedIds = deleted.map((row) => row.id);
    // Soft-deleting an invoice also soft-deletes its payments and receipts,
    // so they stop showing up on their own list pages pointing at a
    // "deleted" invoice (unlike a hard delete, nothing here cascades for us).
    await tx
      .update(paymentsTable)
      .set({ deletedAt: now })
      .where(and(eq(paymentsTable.userId, userId), isNull(paymentsTable.deletedAt), inArray(paymentsTable.invoiceId, deletedIds)));
    await tx
      .update(receiptsTable)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(receiptsTable.userId, userId), isNull(receiptsTable.deletedAt), inArray(receiptsTable.invoiceId, deletedIds)));
    await tx.insert(auditLogTable).values(
      deletedIds.map((id) => ({ userId, dataMode, entityType: "invoice" as const, entityId: id, eventType: "deleted" as const })),
    );
  });
  res.status(204).send();
});

router.patch("/invoices/bulk-status", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { ids, status } = InvoiceBulkStatusBody.parse(req.body);
  if (ids.length === 0) { res.status(204).send(); return; }
  const rows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      status: invoicesTable.status,
      total: invoicesTable.total,
      paidAmount: invoicesTable.paidAmount,
    })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), inArray(invoicesTable.id, ids)));
  const blocked = rows
    .map((row) => {
      const err = invoiceTransitionError(row.status, status);
      return err ? `${row.invoiceNumber}: ${err}` : null;
    })
    .filter((msg): msg is string => Boolean(msg));
  if (blocked.length > 0) {
    res.status(422).json({ error: blocked.join(" ") });
    return;
  }
  if (status === "paid") {
    const unpaid = rows.filter((row) => !isInvoiceFullyPaid(toNumber(row.paidAmount), toNumber(row.total)));
    if (unpaid.length > 0) {
      res.status(400).json({
        error: `Cannot mark as paid until payments cover the total (${unpaid.map((r) => r.invoiceNumber).join(", ")}). Record a payment instead.`,
      });
      return;
    }
  }
  if (status === "revised") {
    const rows = await db
      .select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber, status: invoicesTable.status })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), inArray(invoicesTable.id, ids)));
    const candidateNumbers = new Map<string, string>();
    for (const row of rows) {
      const newNumber = invoiceNumberForRevisedStatus(row.invoiceNumber, row.status, status);
      if (newNumber) candidateNumbers.set(row.id, newNumber);
    }
    // Only rows actually being renumbered vacate their current invoice number;
    // rows in the same batch that keep their number must still count as "in use".
    const renumberedIds = [...candidateNumbers.keys()];
    const plannedNumbers = new Map<string, string>();
    const reservedInBatch = new Set<string>();
    for (const [rowId, newNumber] of candidateNumbers) {
      if (reservedInBatch.has(newNumber) || await isInvoiceNumberInUse(userId, newNumber, renumberedIds, dataMode)) {
        res.status(409).json({ error: revisedInvoiceNumberConflictError(newNumber) });
        return;
      }
      reservedInBatch.add(newNumber);
      plannedNumbers.set(rowId, newNumber);
    }
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const newNumber = plannedNumbers.get(row.id);
        await tx
          .update(invoicesTable)
          .set({
            status,
            ...(newNumber ? { invoiceNumber: newNumber } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, row.id)));
        if (newNumber) {
          await syncMilestoneInvoiceNumber(userId, row.id, newNumber, tx);
        }
      }
    });
  } else {
    await db.update(invoicesTable).set({
      status,
      ...(status === "draft" ? { statusBeforePaid: null } : {}),
      updatedAt: new Date(),
    })
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), inArray(invoicesTable.id, ids)));
  }
  const changed = rows.filter((row) => row.status !== status);
  if (changed.length > 0) {
    await db.insert(auditLogTable).values(
      changed.map((row) => ({
        userId,
        dataMode,
        entityType: "invoice" as const,
        entityId: row.id,
        eventType: "status_changed" as const,
        eventData: { from: row.status, to: status },
      })),
    );
  }
  res.status(204).send();
});

const InvoiceStatusBody = zz.object({
  status: zz.enum(InvoiceStatusValues),
  cancellationReason: zz.string().optional(),
});
/** Status-only update — avoids round-tripping full line items from list rows. */
router.patch("/invoices/:id/status", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = UpdateInvoiceParams.parse(req.params);
  const body = InvoiceStatusBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const transitionErr = invoiceTransitionError(existing.status, body.status);
  if (transitionErr) {
    res.status(422).json({ error: transitionErr });
    return;
  }
  if (body.status === "paid" && !isInvoiceFullyPaid(toNumber(existing.paidAmount), toNumber(existing.total))) {
    res.status(400).json({
      error: "Cannot mark as paid until recorded payments cover the invoice total. Record a payment instead.",
    });
    return;
  }
  const newNumber = invoiceNumberForRevisedStatus(existing.invoiceNumber, existing.status, body.status);
  if (newNumber && await isInvoiceNumberInUse(userId, newNumber, [id], dataMode)) {
    res.status(409).json({ error: revisedInvoiceNumberConflictError(newNumber) });
    return;
  }
  const [row] = await db
    .update(invoicesTable)
    .set({
      status: body.status,
      ...(body.status === "draft" ? { statusBeforePaid: null } : {}),
      ...(newNumber ? { invoiceNumber: newNumber } : {}),
      ...(body.cancellationReason !== undefined
        ? { cancellationReason: body.cancellationReason || null }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (newNumber) {
    await syncMilestoneInvoiceNumber(userId, id, newNumber);
  }
  if (existing.status !== body.status) {
    await logAuditEvent({
      userId,
      dataMode,
      entityType: "invoice",
      entityId: id,
      eventType: "status_changed",
      eventData: { from: existing.status, to: body.status },
    });
  }
  const [joined] = await db
    .select({ invoice: invoicesTable, clientName: clientsTable.name })
    .from(invoicesTable)
    .leftJoin(clientsTable, joinInvoiceClient(userId, dataMode))
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  const consultantIds = await loadConsultantIds(db, INVOICE_CONSULTANTS, id);
  const items = await loadLineItems(db, INVOICE_ITEMS, id);
  res.json(invoiceDto(joined!.invoice, consultantIds, items, joined!.clientName));
});

router.patch("/invoices/:id/archive", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = UpdateInvoiceParams.parse(req.params);
  const reason = zz.string().optional().parse((req.body as { cancellationReason?: string })?.cancellationReason);
  const [existing] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const transitionErr = invoiceTransitionError(existing.status, "revised");
  if (transitionErr) {
    res.status(422).json({ error: transitionErr });
    return;
  }
  const newNumber = invoiceNumberForRevisedStatus(existing.invoiceNumber, existing.status, "revised");
  if (newNumber && await isInvoiceNumberInUse(userId, newNumber, [id], dataMode)) {
    res.status(409).json({ error: revisedInvoiceNumberConflictError(newNumber) });
    return;
  }
  const [row] = await db
    .update(invoicesTable)
    .set({
      status: "revised",
      ...(newNumber ? { invoiceNumber: newNumber } : {}),
      cancellationReason: reason ?? "Archived",
      updatedAt: new Date(),
    })
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (newNumber) {
    await syncMilestoneInvoiceNumber(userId, id, newNumber);
  }
  await logAuditEvent({
    userId,
    dataMode,
    entityType: "invoice",
    entityId: id,
    eventType: "status_changed",
    eventData: { from: existing.status, to: "revised" },
  });
  const [joined] = await db
    .select({ invoice: invoicesTable, clientName: clientsTable.name })
    .from(invoicesTable)
    .leftJoin(clientsTable, joinInvoiceClient(userId, dataMode))
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  const consultantIds = await loadConsultantIds(db, INVOICE_CONSULTANTS, id);
  const items = await loadLineItems(db, INVOICE_ITEMS, id);
  res.json(UpdateInvoiceResponse.parse(invoiceDto(joined!.invoice, consultantIds, items, joined!.clientName)));
});

router.post("/invoices/:id/duplicate", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = UpdateInvoiceParams.parse(req.params);
  const [src] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  if (!src) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const srcItems = await loadLineItems(db, INVOICE_ITEMS, src.id);
  const totals = calculateTotals(srcItems, toNumber(src.discountAmount));
  const srcConsultantIds = await loadConsultantIds(db, INVOICE_CONSULTANTS, src.id);
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(invoicesTable)
      .values({
        userId,
        dataMode,
        clientId: src.clientId,
        invoiceNumber: await nextDocumentNumber(userId, "invoice", undefined, tx, dataMode),
        invoiceDate: src.invoiceDate,
        dueDate: src.dueDate,
        status: "draft",
        currency: src.currency as "HKD" | "USD" | "CNY" | "MOP",
        serviceCategory: src.serviceCategory ?? "others",
        subtotal: money(totals.subtotal),
        taxAmount: money(totals.taxAmount),
        discountAmount: money(totals.discountAmount),
        total: money(totals.total),
        paidAmount: money(0),
        notes: src.notes,
        internalNote: src.internalNote,
        termsConditions: src.termsConditions,
        remark: src.remark,
      })
      .returning();
    await replaceConsultantIds(tx, INVOICE_CONSULTANTS, inserted.id, srcConsultantIds);
    await replaceLineItems(tx, INVOICE_ITEMS, inserted.id, srcItems);
    return inserted;
  });
  res.status(201).json(invoiceDto(row, srcConsultantIds, srcItems));
});

router.patch("/invoices/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = UpdateInvoiceParams.parse(req.params);
  const body = UpdateInvoiceBody.parse(req.body);
  const clientCheck = await assertClientOwnedByUser(userId, body.clientId, dataMode);
  if (!clientCheck.ok) {
    res.status(clientCheck.status).json({ error: clientCheck.error });
    return;
  }
  const [existing] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  let consultantIds: string[] | undefined;
  try {
    consultantIds = parseConsultantIds(req.body);
  } catch (err) {
    if (err instanceof ConsultantLimitError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
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
  const existingItems = await loadLineItems(db, INVOICE_ITEMS, id);
  const existingConsultantIds = await loadConsultantIds(db, INVOICE_CONSULTANTS, id);
  if (isNoOpInvoicePatch(existing, existingItems, existingConsultantIds, body, consultantIds)) {
    res.json(UpdateInvoiceResponse.parse(invoiceDto(existing, existingConsultantIds, existingItems)));
    return;
  }
  if (isInternalNoteOnlyInvoicePatch(existing, existingItems, existingConsultantIds, body, consultantIds)) {
    const [updated] = await db
      .update(invoicesTable)
      .set({
        ...(body.internalNote !== undefined ? { internalNote: body.internalNote || null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    res.json(UpdateInvoiceResponse.parse(invoiceDto(updated, existingConsultantIds, existingItems)));
    return;
  }
  const newStatus = body.status ?? existing.status;
  const transitionErr = invoiceTransitionError(existing.status, newStatus);
  if (transitionErr) {
    res.status(422).json({ error: transitionErr });
    return;
  }
  if (newStatus === "paid" && !isInvoiceFullyPaid(toNumber(existing.paidAmount), toNumber(existing.total))) {
    res.status(400).json({
      error: "Cannot mark as paid until recorded payments cover the invoice total. Record a payment instead.",
    });
    return;
  }
  const manualNumber = body.invoiceNumber?.trim();
  const baseNumber = manualNumber || existing.invoiceNumber;
  const revisedNumber = invoiceNumberForRevisedStatus(baseNumber, existing.status, newStatus);
  if (revisedNumber && await isInvoiceNumberInUse(userId, revisedNumber, [id], dataMode)) {
    res.status(409).json({ error: revisedInvoiceNumberConflictError(revisedNumber) });
    return;
  }
  const updatedInvoiceNumber =
    revisedNumber ?? (manualNumber && manualNumber !== existing.invoiceNumber ? manualNumber : undefined);
  if (
    updatedInvoiceNumber &&
    updatedInvoiceNumber !== revisedNumber &&
    await isInvoiceNumberInUse(userId, updatedInvoiceNumber, [id], dataMode)
  ) {
    res.status(409).json({
      error: "Duplicate invoice number",
    });
    return;
  }
  const totals = calculateTotals(body.items, body.discountAmount ?? 0);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(invoicesTable)
      .set({
        clientId: body.clientId,
        invoiceDate: body.invoiceDate,
        dueDate: body.dueDate,
        status: newStatus,
        ...(newStatus === "draft" ? { statusBeforePaid: null } : {}),
        ...(updatedInvoiceNumber ? { invoiceNumber: updatedInvoiceNumber } : {}),
        currency: body.currency,
        serviceCategory: body.serviceCategory ?? "others",
        subtotal: money(totals.subtotal),
        taxAmount: money(totals.taxAmount),
        discountAmount: money(totals.discountAmount),
        total: money(totals.total),
        ...(body.cancellationReason !== undefined ? { cancellationReason: body.cancellationReason || null } : {}),
        notes: body.notes !== undefined ? body.notes : undefined,
        internalNote: body.internalNote !== undefined ? (body.internalNote || null) : undefined,
        termsConditions: body.termsConditions !== undefined ? (body.termsConditions || null) : undefined,
        remark: body.remark !== undefined ? (body.remark || null) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)))
      .returning();
    if (updated) {
      if (consultantIds !== undefined) {
        await replaceConsultantIds(tx, INVOICE_CONSULTANTS, id, consultantIds);
      }
      await replaceLineItems(tx, INVOICE_ITEMS, id, body.items);
      if (updatedInvoiceNumber) {
        await syncMilestoneInvoiceNumber(userId, id, updatedInvoiceNumber, tx);
      }
      // Staff can send a paid invoice back to draft; keep that status instead of
      // immediately re-promoting to paid when existing payments still cover the total.
      await syncInvoicePayment(userId, id, tx, { preserveStatus: newStatus === "draft" });
    }
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (existing.status !== newStatus) {
    await logAuditEvent({
      userId,
      dataMode,
      entityType: "invoice",
      entityId: id,
      eventType: "status_changed",
      eventData: { from: existing.status, to: newStatus },
    });
  }
  const [updated] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  const updatedConsultantIds = await loadConsultantIds(db, INVOICE_CONSULTANTS, id);
  res.json(UpdateInvoiceResponse.parse(invoiceDto(updated ?? row, updatedConsultantIds, body.items)));
});

router.delete("/invoices/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = DeleteInvoiceParams.parse(req.params);
  await db.transaction(async (tx) => {
    // A quotation converted to this invoice would otherwise be left stuck
    // in the terminal "invoiced" state pointing at a deleted invoice.
    await tx
      .update(quotationsTable)
      .set({ status: "confirmed", convertedInvoiceId: null, updatedAt: new Date() })
      .where(
        and(
          eq(quotationsTable.userId, userId),
          eq(quotationsTable.dataMode, dataMode),
          eq(quotationsTable.convertedInvoiceId, id),
        ),
      );
    const now = new Date();
    const [deleted] = await tx
      .update(invoicesTable)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)))
      .returning({ id: invoicesTable.id });
    if (!deleted) return;
    // Soft-deleting an invoice also soft-deletes its payments and receipts,
    // so they stop showing up on their own list pages pointing at a
    // "deleted" invoice (unlike a hard delete, nothing here cascades for us).
    await tx.update(paymentsTable).set({ deletedAt: now }).where(and(eq(paymentsTable.userId, userId), isNull(paymentsTable.deletedAt), eq(paymentsTable.invoiceId, id)));
    await tx.update(receiptsTable).set({ deletedAt: now, updatedAt: now }).where(and(eq(receiptsTable.userId, userId), isNull(receiptsTable.deletedAt), eq(receiptsTable.invoiceId, id)));
    await logAuditEvent({ userId, dataMode, entityType: "invoice", entityId: id, eventType: "deleted" }, tx);
  });
  res.status(204).send();
});

// Restores the invoice only — payments/receipts cascade-deleted alongside it
// stay deleted and must be restored separately from their own "Deleted" view.
// Status is left as stored (a restored paid invoice can still be sent to draft).
router.post("/invoices/:id/restore", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = GetInvoiceParams.parse(req.params);
  const [row] = await db
    .update(invoicesTable)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), eq(invoicesTable.id, id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  await logAuditEvent({ userId, dataMode, entityType: "invoice", entityId: id, eventType: "restored" });
  const consultantIds = await loadConsultantIds(db, INVOICE_CONSULTANTS, id);
  const items = await loadLineItems(db, INVOICE_ITEMS, id);
  res.json(invoiceDto(row, consultantIds, items));
});

// Permanently removes an already soft-deleted invoice (and, via FK cascade,
// its line items, consultant links, payments, and receipts). Only reachable
// from the trash view, so a live (non-deleted) invoice can't be purged by
// mistake -- it must be soft-deleted first.
router.delete("/invoices/:id/permanent", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = GetInvoiceParams.parse(req.params);
  const [row] = await db
    .delete(invoicesTable)
    .where(
      and(
        eq(invoicesTable.userId, userId),
        eq(invoicesTable.dataMode, dataMode),
        eq(invoicesTable.id, id),
        sql`${invoicesTable.deletedAt} IS NOT NULL`,
      ),
    )
    .returning({ id: invoicesTable.id });
  if (!row) {
    res.status(404).json({ error: "Deleted invoice not found" });
    return;
  }
  await logAuditEvent({ userId, dataMode, entityType: "invoice", entityId: id, eventType: "purged" });
  res.status(204).send();
});

router.get("/invoices/:id/pdf", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const dataMode = await currentDataMode();
  const { id } = GetInvoiceParams.parse(req.params);
  const [row] = await db
    .select({ invoice: invoicesTable, client: clientsTable })
    .from(invoicesTable)
    .leftJoin(
      clientsTable,
      and(
        eq(invoicesTable.clientId, clientsTable.id),
        eq(clientsTable.userId, userId),
        eq(clientsTable.dataMode, dataMode),
      ),
    )
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode), isNull(invoicesTable.deletedAt), eq(invoicesTable.id, id)));
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const settings = await getCompanySettings({ fresh: true });
  const items = await loadLineItems(db, INVOICE_ITEMS, row.invoice.id);
  const inline = req.query.inline === "true" || req.query.inline === "1";
  await streamInvoicePdf({ ...row.invoice, items }, row.client, settings, res, inline);
});


// The pre-save check is advisory; the existing unique index is authoritative.
const handleInvoiceNumberConflict: ErrorRequestHandler = (err, _req, res, next) => {
  let cause = err;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
    if (isUniqueViolation(cause) && cause.constraint === "invoiceplane_invoices_user_mode_number_uniq") {
      res.status(409).json({ error: "Duplicate invoice number" });
      return;
    }
    cause = cause.cause;
  }
  next(err);
};
router.use(handleInvoiceNumberConflict);

export default router;
