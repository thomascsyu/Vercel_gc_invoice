import PDFDocument from "pdfkit";
import { z as zz } from "zod";
import {
  auditLogTable,
  clientsTable,
  clientProposalsTable,
  companySettingsTable,
  db,
  invoicesTable,
  paymentsTable,
  paymentReceiptsTable,
  quotationsTable,
  quotationTemplatesTable,
  receiptsTable,
  type AuditEntityType,
  type AuditEventType,
  type LineItem,
  type ServiceCategory,
} from "@workspace/db";
import { and, count, eq, inArray, isNull, ne, notInArray, sql, type SQL } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { drawQuotationPdfDoc } from "../../lib/quotationReceiptPdfDraw";
import { setPdfDownloadHeaders } from "../../lib/pdfResponseHeaders";
import { invoiceStatusAfterPaymentSync } from "../../lib/invoicePaymentStatus";
import { INVOICE_ITEMS, QUOTATION_ITEMS, replaceLineItems } from "../../lib/lineItems";
import type { DataMode } from "../../lib/dataMode";
import { currentDataMode } from "../../lib/dataMode";
import { buildClientCode, formatClientCode, parseClientCode } from "./clientCode";

export { buildClientCode, formatClientCode, parseClientCode };

/** Max size for CSV import uploads (clients, invoices, quotations, payments). */
export const CSV_IMPORT_MAX_BYTES = 25 * 1024 * 1024;

export const csvImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_IMPORT_MAX_BYTES },
});
export const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function handleCsvImportUpload(req: Request, res: Response, next: NextFunction) {
  csvImportUpload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({
          error: `File too large (max ${Math.round(CSV_IMPORT_MAX_BYTES / (1024 * 1024))} MB)`,
        });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err) {
      const message = err instanceof Error && err.message.trim() ? err.message : "Upload failed";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

export const SERVICE_CATEGORIES = ["setup", "main", "pen", "vscan", "others"] as const satisfies readonly ServiceCategory[];
export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  setup: "Setup",
  main: "Main",
  pen: "Pen",
  vscan: "Vscan",
  others: "Others",
};

export function normalizeServiceCategory(raw: unknown): ServiceCategory {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return SERVICE_CATEGORIES.includes(value as ServiceCategory) ? (value as ServiceCategory) : "others";
}

/** Matches the DB CHECK constraint on payments.payment_method (migration 0042) and the frontend's method dropdown. */
export const PAYMENT_METHODS = ["bank_transfer", "cheque", "echeque", "cheque_deposit", "other"] as const;

/** True when another *active* (non-deleted) client already uses this code. */
export async function isActiveClientCodeTaken(
  userId: string,
  dataMode: DataMode,
  clientCode: string,
  excludeId?: string,
): Promise<boolean> {
  const conditions = [
    eq(clientsTable.userId, userId),
    eq(clientsTable.dataMode, dataMode),
    isNull(clientsTable.deletedAt),
    eq(clientsTable.clientCode, clientCode),
  ];
  if (excludeId) conditions.push(ne(clientsTable.id, excludeId));
  const [row] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(...conditions))
    .limit(1);
  return Boolean(row);
}

/**
 * Return `desired` when it is free among active clients; otherwise the next
 * unused number with the same prefix (GTL001 → GTL002). `reserved` tracks
 * codes already assigned in the current import batch so two rows don't claim
 * the same next value before either is written.
 */
export async function allocateUniqueClientCode(
  userId: string,
  dataMode: DataMode,
  desired: string,
  excludeId?: string,
  reserved: Set<string> = new Set(),
): Promise<string> {
  const wanted = desired.trim() || "CLI001";
  const taken = async (code: string) =>
    reserved.has(code) || (await isActiveClientCodeTaken(userId, dataMode, code, excludeId));

  if (!(await taken(wanted))) {
    reserved.add(wanted);
    return wanted;
  }

  const parsed = parseClientCode(wanted);
  for (let n = parsed.number + 1; n <= parsed.number + 10_000; n++) {
    const candidate = formatClientCode(parsed.prefix, n, parsed.width);
    if (!(await taken(candidate))) {
      reserved.add(candidate);
      return candidate;
    }
  }
  const fallback = `${parsed.prefix}${Date.now()}`;
  reserved.add(fallback);
  return fallback;
}

export function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function money(value: number) {
  return value.toFixed(2);
}

export function calculateTotals(items: LineItem[], discountAmount = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const taxAmount = items.reduce(
    (sum, item) => sum + item.quantity * item.price * ((item.taxRate ?? 0) / 100),
    0,
  );
  const total = Math.max(subtotal + taxAmount - discountAmount, 0);
  return { subtotal, taxAmount, discountAmount, total };
}

export function today(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export async function nextClientCode(userId: string, name: string, dataMode?: DataMode) {
  const mode = dataMode ?? (await currentDataMode());
  return allocateUniqueClientCode(userId, mode, buildClientCode(name));
}

export type DocumentNumberSeq = { invoice?: number; quotation?: number };

export function documentNumberStamp() {
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export const INVOICE_REVISED_SUFFIX = /-REVISED(?:-\d+)?$/;

export function baseInvoiceNumber(invoiceNumber: string): string {
  return invoiceNumber.replace(INVOICE_REVISED_SUFFIX, "");
}

/** Append -REVISED to the invoice number (or increment revision suffix if already revised). */
export function revisedInvoiceNumber(currentNumber: string): string {
  const base = baseInvoiceNumber(currentNumber);
  if (INVOICE_REVISED_SUFFIX.test(currentNumber)) {
    const match = currentNumber.match(/-REVISED(?:-(\d+))?$/);
    const nextRev = match?.[1] ? parseInt(match[1], 10) + 1 : 2;
    return `${base}-REVISED-${nextRev}`;
  }
  return `${base}-REVISED`;
}

export function invoiceNumberForRevisedStatus(
  currentNumber: string,
  previousStatus: string,
  newStatus: string,
): string | undefined {
  if (newStatus !== "revised" || previousStatus === "revised") return undefined;
  return revisedInvoiceNumber(currentNumber);
}

export {
  isInternalNoteOnlyInvoicePatch,
  isNoOpInvoicePatch,
  lineItemsMatchForRevision,
} from "./internalNotePatch";
export type {
  InvoiceRevisionCompareBody,
  InvoiceRevisionCompareExisting,
} from "./internalNotePatch";

/** True when another non-deleted invoice (same user + data mode) already uses this invoice number. */
export async function isInvoiceNumberInUse(
  userId: string,
  invoiceNumber: string,
  excludeIds: string[] = [],
  dataMode?: DataMode,
): Promise<boolean> {
  const mode = dataMode ?? (await currentDataMode());
  const filters: SQL[] = [
    eq(invoicesTable.userId, userId),
    eq(invoicesTable.dataMode, mode),
    eq(invoicesTable.invoiceNumber, invoiceNumber),
    isNull(invoicesTable.deletedAt),
  ];
  if (excludeIds.length === 1) {
    filters.push(ne(invoicesTable.id, excludeIds[0]!));
  } else if (excludeIds.length > 1) {
    filters.push(notInArray(invoicesTable.id, excludeIds));
  }
  const [row] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(and(...filters))
    .limit(1);
  return Boolean(row);
}

export function revisedInvoiceNumberConflictError(invoiceNumber: string) {
  return `Cannot revise: invoice number "${invoiceNumber}" already exists.`;
}

export type CountExecutor = Pick<typeof db, "select">;

export async function nextDocumentNumber(
  userId: string,
  kind: "invoice" | "quotation",
  seq?: DocumentNumberSeq,
  executor: CountExecutor = db,
  dataMode?: DataMode,
) {
  const mode = dataMode ?? (await currentDataMode());
  const stamp = documentNumberStamp();
  if (kind === "invoice") {
    const sequence = seq ?? {};
    if (sequence.invoice === undefined) {
      const [{ total }] = await executor.select({ total: count() }).from(invoicesTable)
        .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, mode)));
      sequence.invoice = Number(total);
    }
    // Custom numbers and purged invoices can make count + 1 collide.
    while (true) {
      sequence.invoice += 1;
      const candidate = `${stamp}${String(sequence.invoice).padStart(3, "0")}`;
      const [existing] = await executor.select({ id: invoicesTable.id }).from(invoicesTable)
        .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, mode),
          eq(invoicesTable.invoiceNumber, candidate), isNull(invoicesTable.deletedAt))).limit(1);
      if (!existing) return candidate;
    }
  }

  if (seq) {
    if (seq.quotation === undefined) {
      const [{ total }] = await executor
        .select({ total: count() })
        .from(quotationsTable)
        .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, mode)));
      seq.quotation = Number(total);
    }
    seq.quotation += 1;
    return `Q${stamp}${String(seq.quotation).padStart(3, "0")}`;
  }
  const [{ total }] = await executor
    .select({ total: count() })
    .from(quotationsTable)
    .where(and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, mode)));
  return `Q${stamp}${String(Number(total) + 1).padStart(3, "0")}`;
}

export function clientDto(row: typeof clientsTable.$inferSelect) {
  // Backfill legacy single-line address into addressLine1 when present.
  const line1 = row.addressLine1 ?? row.address ?? undefined;
  return {
    id: row.id,
    clientCode: row.clientCode,
    name: row.name,
    contactPerson: row.contactPerson ?? undefined,
    email: row.email,
    phone: row.phone ?? undefined,
    addressLine1: line1 ?? undefined,
    addressLine2: row.addressLine2 ?? undefined,
    addressLine3: row.addressLine3 ?? undefined,
    addressLine4: row.addressLine4 ?? undefined,
    country: row.country ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export function clientProposalDto(row: typeof clientProposalsTable.$inferSelect) {
  return {
    id: row.id,
    clientId: row.clientId,
    proposalNo: row.proposalNo ?? undefined,
    proposalRevision: row.proposalRevision,
    currency: row.currency as "HKD" | "USD" | "CNY" | "MOP",
    totalAmount: toNumber(row.totalAmount),
    driveFileUrl: row.driveFileUrl ?? undefined,
    paymentSchedule: (row.paymentSchedule ?? []).map((item) => ({
      label: item.label,
      percentage: item.percentage,
    })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function invoiceDto(
  row: typeof invoicesTable.$inferSelect,
  consultantIds: string[],
  items: LineItem[],
  clientName?: string | null,
) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: clientName ?? undefined,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate ?? undefined,
    status: row.status as "draft" | "pending_approval" | "approved" | "sent" | "revised" | "paid",
    currency: row.currency as "HKD" | "USD" | "CNY" | "MOP",
    items,
    subtotal: toNumber(row.subtotal),
    taxAmount: toNumber(row.taxAmount),
    discountAmount: toNumber(row.discountAmount),
    total: toNumber(row.total),
    paidAmount: toNumber(row.paidAmount),
    consultantIds,
    serviceCategory: normalizeServiceCategory(row.serviceCategory),
    cancellationReason: row.cancellationReason ?? undefined,
    notes: row.notes ?? undefined,
    internalNote: row.internalNote ?? undefined,
    termsConditions: row.termsConditions ?? undefined,
    remark: row.remark ?? undefined,
    shareToken: row.shareToken ?? undefined,
    shareTokenExpiresAt: row.shareTokenExpiresAt?.toISOString() ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** List responses omit heavy JSON/text fields; detail endpoints still return the full DTO. */
export function invoiceListDto(
  row: {
    id: string;
    clientId: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string | null;
    status: string;
    currency: string;
    subtotal: string;
    taxAmount: string;
    discountAmount: string;
    total: string;
    paidAmount: string;
    serviceCategory: string | null;
    cancellationReason: string | null;
    shareToken: string | null;
    createdAt: Date;
  },
  consultantIds: string[],
  clientName?: string | null,
) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: clientName ?? undefined,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate ?? undefined,
    status: row.status as "draft" | "pending_approval" | "approved" | "sent" | "revised" | "paid",
    currency: row.currency as "HKD" | "USD" | "CNY" | "MOP",
    items: [] as LineItem[],
    subtotal: toNumber(row.subtotal),
    taxAmount: toNumber(row.taxAmount),
    discountAmount: toNumber(row.discountAmount),
    total: toNumber(row.total),
    paidAmount: toNumber(row.paidAmount),
    consultantIds,
    serviceCategory: normalizeServiceCategory(row.serviceCategory),
    cancellationReason: row.cancellationReason ?? undefined,
    shareToken: row.shareToken ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export const invoiceListSelect = {
  id: invoicesTable.id,
  clientId: invoicesTable.clientId,
  invoiceNumber: invoicesTable.invoiceNumber,
  invoiceDate: invoicesTable.invoiceDate,
  dueDate: invoicesTable.dueDate,
  status: invoicesTable.status,
  currency: invoicesTable.currency,
  subtotal: invoicesTable.subtotal,
  taxAmount: invoicesTable.taxAmount,
  discountAmount: invoicesTable.discountAmount,
  total: invoicesTable.total,
  paidAmount: invoicesTable.paidAmount,
  serviceCategory: invoicesTable.serviceCategory,
  cancellationReason: invoicesTable.cancellationReason,
  shareToken: invoicesTable.shareToken,
  createdAt: invoicesTable.createdAt,
};

export function quotationDto(
  row: typeof quotationsTable.$inferSelect,
  items: LineItem[],
  clientName?: string | null,
) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: clientName ?? undefined,
    quotationNumber: row.quotationNumber,
    quotationDate: row.quotationDate,
    validUntil: row.validUntil ?? undefined,
    status: row.status as "draft" | "pending_approval" | "sent" | "skip" | "approved" | "canceled" | "confirmed" | "invoiced",
    currency: row.currency as "HKD" | "USD" | "CNY" | "MOP",
    items,
    subtotal: toNumber(row.subtotal),
    discountAmount: toNumber(row.discountAmount),
    total: toNumber(row.total),
    convertedInvoiceId: row.convertedInvoiceId ?? undefined,
    serviceCategory: normalizeServiceCategory(row.serviceCategory),
    cancellationReason: row.cancellationReason ?? undefined,
    termsConditions: row.termsConditions ?? undefined,
    remark: row.remark ?? undefined,
    quotationAttn: row.quotationAttn ?? undefined,
    driveFileUrl: row.driveFileUrl ?? undefined,
    shareToken: row.shareToken ?? undefined,
    shareTokenExpiresAt: row.shareTokenExpiresAt?.toISOString() ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export function quotationListDto(
  row: {
    id: string;
    clientId: string;
    quotationNumber: string;
    quotationDate: string;
    validUntil: string | null;
    status: string;
    currency: string;
    subtotal: string;
    discountAmount: string;
    total: string;
    convertedInvoiceId: string | null;
    serviceCategory: string | null;
    cancellationReason: string | null;
    shareToken: string | null;
    createdAt: Date;
  },
  clientName?: string | null,
) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: clientName ?? undefined,
    quotationNumber: row.quotationNumber,
    quotationDate: row.quotationDate,
    validUntil: row.validUntil ?? undefined,
    status: row.status as "draft" | "pending_approval" | "sent" | "skip" | "approved" | "canceled" | "confirmed" | "invoiced",
    currency: row.currency as "HKD" | "USD" | "CNY" | "MOP",
    items: [] as LineItem[],
    subtotal: toNumber(row.subtotal),
    discountAmount: toNumber(row.discountAmount),
    total: toNumber(row.total),
    convertedInvoiceId: row.convertedInvoiceId ?? undefined,
    serviceCategory: normalizeServiceCategory(row.serviceCategory),
    cancellationReason: row.cancellationReason ?? undefined,
    shareToken: row.shareToken ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export const quotationListSelect = {
  id: quotationsTable.id,
  clientId: quotationsTable.clientId,
  quotationNumber: quotationsTable.quotationNumber,
  quotationDate: quotationsTable.quotationDate,
  validUntil: quotationsTable.validUntil,
  status: quotationsTable.status,
  currency: quotationsTable.currency,
  subtotal: quotationsTable.subtotal,
  discountAmount: quotationsTable.discountAmount,
  total: quotationsTable.total,
  convertedInvoiceId: quotationsTable.convertedInvoiceId,
  serviceCategory: quotationsTable.serviceCategory,
  cancellationReason: quotationsTable.cancellationReason,
  shareToken: quotationsTable.shareToken,
  createdAt: quotationsTable.createdAt,
};

export function paymentDto(
  row: typeof paymentsTable.$inferSelect,
  invoiceNumber?: string | null,
  currency?: string | null,
  clientId?: string | null,
  clientName?: string | null,
  invoiceTotal?: number | null,
  invoicePaidAmount?: number | null,
) {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: invoiceNumber ?? undefined,
    clientId: clientId ?? undefined,
    clientName: clientName ?? undefined,
    currency: currency ?? "HKD",
    amount: toNumber(row.amount),
    paymentDate: row.paymentDate,
    paymentMethod: row.paymentMethod,
    note: row.note ?? undefined,
    // Enhanced payment tracking fields
    chequeNumber: row.chequeNumber ?? undefined,
    bankName: row.bankName ?? undefined,
    depositDate: row.depositDate ?? undefined,
    referenceNumber: row.referenceNumber ?? undefined,
    transactionId: row.transactionId ?? undefined,
    invoiceTotal: invoiceTotal ?? undefined,
    invoicePaidAmount: invoicePaidAmount ?? undefined,
    invoiceStatus: invoiceTotal && invoicePaidAmount
      ? invoicePaidAmount >= invoiceTotal ? "paid" : "partially_paid"
      : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export function paymentReceiptDto(row: typeof paymentReceiptsTable.$inferSelect) {
  return {
    id: row.id,
    paymentId: row.paymentId,
    invoiceId: row.invoiceId,
    receiptType: row.receiptType,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    description: row.description ?? undefined,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

export const seededUserIds = new Set<string>();

export async function seedForUser(userId: string) {
  const dataMode = await currentDataMode();
  const seedKey = `${userId}:${dataMode}`;
  if (seededUserIds.has(seedKey)) return;
  const existing = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)))
    .limit(1);
  if (existing.length > 0) {
    seededUserIds.add(seedKey);
    return;
  }

  const [clientA, clientB] = await db
    .insert(clientsTable)
    .values([
      {
        userId,
        dataMode,
        clientCode: "ACM001",
        name: "Acme Compliance Limited",
        contactPerson: "Maya Chan",
        email: "accounts@acme.example",
        phone: "+852 3000 1100",
        address: "18 Harbour Road, Wan Chai",
        country: "Hong Kong",
        vatId: "HK-ACM-9282",
        isActive: true,
      },
      {
        userId,
        dataMode,
        clientCode: "NOR002",
        name: "Northstar Advisory",
        contactPerson: "Daniel Wu",
        email: "finance@northstar.example",
        phone: "+852 3000 2200",
        address: "88 Queensway",
        country: "Hong Kong",
        vatId: "HK-NOR-6104",
        isActive: true,
      },
    ])
    .returning();

  const invoiceItems: LineItem[] = [
    { name: "ISO readiness audit", details: "Gap review and management report", quantity: 1, price: 16800, taxRate: 0 },
    { name: "Consultant workshop", details: "Two half-day remote workshops", quantity: 2, price: 4200, taxRate: 0 },
  ];
  const invoiceTotals = calculateTotals(invoiceItems, 0);
  const invoice = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(invoicesTable)
      .values({
        userId,
        dataMode,
        clientId: clientA.id,
        invoiceNumber: await nextDocumentNumber(userId, "invoice", undefined, tx, dataMode),
        invoiceDate: today(-8),
        dueDate: today(22),
        status: "sent",
        currency: "HKD",
        subtotal: money(invoiceTotals.subtotal),
        taxAmount: money(invoiceTotals.taxAmount),
        discountAmount: money(invoiceTotals.discountAmount),
        total: money(invoiceTotals.total),
        paidAmount: money(8000),
      })
      .returning();
    await replaceLineItems(tx, INVOICE_ITEMS, inserted.id, invoiceItems);
    return inserted;
  });

  const quotationItems: LineItem[] = [
    { name: "Annual surveillance support", details: "Documentation review and audit coordination", quantity: 1, price: 24800, taxRate: 0 },
  ];
  const quotationTotals = calculateTotals(quotationItems, 1200);
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(quotationsTable)
      .values({
        userId,
        dataMode,
        clientId: clientB.id,
        quotationNumber: await nextDocumentNumber(userId, "quotation", undefined, tx, dataMode),
        quotationDate: today(-3),
        validUntil: today(27),
        status: "sent",
        currency: "HKD",
        subtotal: money(quotationTotals.subtotal),
        discountAmount: money(quotationTotals.discountAmount),
        total: money(quotationTotals.total),
      })
      .returning();
    await replaceLineItems(tx, QUOTATION_ITEMS, inserted.id, quotationItems);
  });

  await db.insert(paymentsTable).values({
    userId,
    dataMode,
    invoiceId: invoice.id,
    amount: money(8000),
    paymentDate: today(-1),
    paymentMethod: "bank_transfer",
    note: "Initial partial payment",
  });

  seededUserIds.add(seedKey);
}

export type PaymentSyncExecutor = Pick<typeof db, "select" | "update">;

/**
 * Recomputes paid amount/status for the given invoices. Pass a transaction
 * executor (`tx` from `db.transaction`) when this must be atomic with the
 * payment write that triggered it — otherwise a crash between the payment
 * insert and this update leaves the invoice's paid amount stale.
 */
export async function syncInvoicePaymentsBatch(
  userId: string,
  invoiceIds: string[],
  executor: PaymentSyncExecutor = db,
  options?: { preserveStatus?: boolean },
) {
  const uniqueIds = [...new Set(invoiceIds)];
  if (uniqueIds.length === 0) return;

  const sums = await executor
    .select({
      invoiceId: paymentsTable.invoiceId,
      paidAmount: sql<string>`COALESCE(SUM(${paymentsTable.amount}::numeric), 0)`.mapWith(String),
    })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.userId, userId), inArray(paymentsTable.invoiceId, uniqueIds), isNull(paymentsTable.deletedAt)))
    .groupBy(paymentsTable.invoiceId);

  const sumByInvoice = new Map(sums.map((row) => [row.invoiceId, toNumber(row.paidAmount)]));

  const invoices = await executor
    .select({
      id: invoicesTable.id,
      total: invoicesTable.total,
      status: invoicesTable.status,
      statusBeforePaid: invoicesTable.statusBeforePaid,
    })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), inArray(invoicesTable.id, uniqueIds)));

  if (invoices.length === 0) return;

  // A single batched UPDATE (per-row values via CASE) instead of one
  // round trip per invoice — matters for CSV imports touching hundreds or
  // thousands of invoices at once.
  const paidAmountCases: SQL[] = [];
  const statusCases: SQL[] = [];
  const statusBeforePaidCases: SQL[] = [];
  for (const invoice of invoices) {
    const paidAmount = sumByInvoice.get(invoice.id) ?? 0;
    const { status, statusBeforePaid } = invoiceStatusAfterPaymentSync(
      invoice.status,
      paidAmount,
      toNumber(invoice.total),
      invoice.statusBeforePaid,
    );
    paidAmountCases.push(sql`WHEN ${invoicesTable.id} = ${invoice.id} THEN ${money(paidAmount)}::numeric`);
    statusCases.push(sql`WHEN ${invoicesTable.id} = ${invoice.id} THEN ${status}`);
    statusBeforePaidCases.push(sql`WHEN ${invoicesTable.id} = ${invoice.id} THEN ${statusBeforePaid}`);
  }

  await executor
    .update(invoicesTable)
    .set({
      paidAmount: sql`CASE ${sql.join(paidAmountCases, sql` `)} ELSE ${invoicesTable.paidAmount} END`,
      ...(options?.preserveStatus
        ? {}
        : {
            status: sql`CASE ${sql.join(statusCases, sql` `)} ELSE ${invoicesTable.status} END`,
            statusBeforePaid: sql`CASE ${sql.join(statusBeforePaidCases, sql` `)} ELSE ${invoicesTable.statusBeforePaid} END`,
          }),
      updatedAt: new Date(),
    })
    .where(and(eq(invoicesTable.userId, userId), inArray(invoicesTable.id, invoices.map((inv) => inv.id))));
}

export async function syncInvoicePayment(
  userId: string,
  invoiceId: string,
  executor: PaymentSyncExecutor = db,
  options?: { preserveStatus?: boolean },
) {
  await syncInvoicePaymentsBatch(userId, [invoiceId], executor, options);
}

export type AuditLogExecutor = Pick<typeof db, "insert">;

/** Records a deletion, restore, or status change against one of the core entities. */
export async function logAuditEvent(
  params: {
    userId: string;
    dataMode: DataMode;
    entityType: AuditEntityType;
    entityId: string;
    eventType: AuditEventType;
    eventData?: Record<string, unknown>;
  },
  executor: AuditLogExecutor = db,
) {
  await executor.insert(auditLogTable).values({
    userId: params.userId,
    dataMode: params.dataMode,
    entityType: params.entityType,
    entityId: params.entityId,
    eventType: params.eventType,
    eventData: params.eventData ?? null,
  });
}

export const BulkIdsBody = zz.object({ ids: zz.array(zz.string().uuid()) });
export async function nextReceiptNumber(
  userId: string,
  executor: CountExecutor = db,
  dataMode?: DataMode,
): Promise<string> {
  const mode = dataMode ?? (await currentDataMode());
  const [{ maxNum }] = await executor
    .select({
      maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${receiptsTable.receiptNumber} FROM 'REC-(\\d+)') AS INTEGER)), 0)`,
    })
    .from(receiptsTable)
    .where(and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, mode)));
  return `REC-${String(Number(maxNum) + 1).padStart(4, "0")}`;
}

export function receiptDto(
  row: typeof receiptsTable.$inferSelect,
  invoiceNumber?: string | null,
  clientName?: string | null,
) {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    invoiceId: row.invoiceId ?? undefined,
    invoiceNumber: invoiceNumber ?? undefined,
    clientId: row.clientId ?? undefined,
    clientName: clientName ?? undefined,
    paymentId: row.paymentId ?? undefined,
    amount: toNumber(row.amount),
    currency: row.currency as "HKD" | "USD" | "CNY" | "MOP",
    chequeNumber: row.chequeNumber ?? undefined,
    chequeDetails: row.chequeDetails ?? undefined,
    receiptDate: row.receiptDate,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Stream quotation PDF using the same layout rules as email attachments (`streamQuotationPdfToBuffer`). */
export async function streamQuotationPdf(
  quotation: typeof quotationsTable.$inferSelect & { items: LineItem[] },
  client: typeof clientsTable.$inferSelect | null,
  settings: typeof companySettingsTable.$inferSelect | undefined,
  res: Response,
  inline: boolean,
) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  setPdfDownloadHeaders(
    res,
    `${inline ? "inline" : "attachment"}; filename="quotation-${quotation.quotationNumber}.pdf"`,
  );
  doc.pipe(res);
  await drawQuotationPdfDoc(doc, quotation, client, settings);
  doc.end();
}

export function quotationTemplateDto(row: typeof quotationTemplatesTable.$inferSelect, items: LineItem[]) {
  return {
    id: row.id,
    name: row.name,
    items,
    currency: row.currency as "HKD" | "USD" | "CNY" | "MOP",
    discountAmount: toNumber(row.discountAmount),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

