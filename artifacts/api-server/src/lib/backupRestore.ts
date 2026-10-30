import {
  clientProposalsTable,
  clientsTable,
  companySettingsTable,
  consultantsTable,
  db,
  invoicesTable,
  jobOrdersTable,
  paymentReceiptsTable,
  paymentsTable,
  proposalActivityLogTable,
  proposalDocumentsTable,
  proposalQuestionsTable,
  quotationTemplatesTable,
  quotationsTable,
  receiptsTable,
  recurringInvoicesTable,
  usersTable,
  type LineItem,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { type DataMode } from "./dataMode";
import {
  INVOICE_CONSULTANTS,
  JOB_ORDER_CONSULTANTS,
  PROPOSAL_CONSULTANTS,
  loadConsultantIdsByParent,
  replaceConsultantIds,
} from "./consultantLinks";
import {
  INVOICE_ITEMS,
  JOB_ORDER_ITEMS,
  QUOTATION_ITEMS,
  QUOTATION_TEMPLATE_ITEMS,
  RECURRING_INVOICE_ITEMS,
  loadLineItemsByParent,
  replaceLineItems,
} from "./lineItems";

export const BACKUP_VERSION = 1 as const;

type SerializedRow = Record<string, unknown>;

function serializeRow<T extends Record<string, unknown>>(row: T): SerializedRow {
  const out: SerializedRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

function parseDateFields(row: SerializedRow, dateKeys: string[]): Record<string, unknown> {
  const out = { ...row };
  for (const key of dateKeys) {
    const v = out[key];
    if (typeof v === "string") {
      out[key] = new Date(v);
    }
  }
  return out;
}

const LineItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  details: z.string().optional(),
  quantity: z.number(),
  price: z.number(),
  taxRate: z.number().optional(),
});

export const BackupPayloadSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  exportedByUserId: z.string(),
  includeCompany: z.boolean(),
  clients: z.array(z.record(z.string(), z.unknown())),
  invoices: z.array(
    z.object({
      row: z.record(z.string(), z.unknown()),
      items: z.array(LineItemSchema),
      consultantIds: z.array(z.string().uuid()),
    }),
  ),
  quotations: z.array(
    z.object({
      row: z.record(z.string(), z.unknown()),
      items: z.array(LineItemSchema),
    }),
  ),
  payments: z.array(z.record(z.string(), z.unknown())),
  paymentReceipts: z.array(z.record(z.string(), z.unknown())),
  receipts: z.array(z.record(z.string(), z.unknown())),
  jobOrders: z.array(
    z.object({
      row: z.record(z.string(), z.unknown()),
      items: z.array(LineItemSchema),
      consultantIds: z.array(z.string().uuid()),
    }),
  ),
  recurringInvoices: z.array(
    z.object({
      row: z.record(z.string(), z.unknown()),
      items: z.array(LineItemSchema),
    }),
  ),
  quotationTemplates: z.array(
    z.object({
      row: z.record(z.string(), z.unknown()),
      items: z.array(LineItemSchema),
    }),
  ),
  proposalDocuments: z.array(
    z.object({
      row: z.record(z.string(), z.unknown()),
      consultantIds: z.array(z.string().uuid()),
    }),
  ),
  proposalActivity: z.array(z.record(z.string(), z.unknown())),
  proposalQuestions: z.array(z.record(z.string(), z.unknown())),
  clientProposals: z.array(z.record(z.string(), z.unknown())),
  companySettings: z.array(z.record(z.string(), z.unknown())).optional(),
  consultants: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type BackupPayload = z.infer<typeof BackupPayloadSchema>;

export type ExportBackupOptions = {
  userId: string;
  includeCompany?: boolean;
  /**
   * When provided, only rows in this sandbox are exported. When omitted,
   * both "live" and "test" rows are included (each row already carries its
   * own `dataMode`, so a full export naturally captures both).
   */
  dataMode?: DataMode;
};

export async function exportUserBackup(options: ExportBackupOptions): Promise<BackupPayload> {
  const { userId, includeCompany = false, dataMode } = options;

  const clients = await db
    .select()
    .from(clientsTable)
    .where(dataMode ? and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode)) : eq(clientsTable.userId, userId));
  const invoiceRows = await db
    .select()
    .from(invoicesTable)
    .where(dataMode ? and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode)) : eq(invoicesTable.userId, userId));
  const quotationRows = await db
    .select()
    .from(quotationsTable)
    .where(
      dataMode ? and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode)) : eq(quotationsTable.userId, userId),
    );
  const paymentRows = await db
    .select()
    .from(paymentsTable)
    .where(dataMode ? and(eq(paymentsTable.userId, userId), eq(paymentsTable.dataMode, dataMode)) : eq(paymentsTable.userId, userId));
  const paymentReceiptRows = await db
    .select()
    .from(paymentReceiptsTable)
    .where(
      dataMode
        ? and(eq(paymentReceiptsTable.userId, userId), eq(paymentReceiptsTable.dataMode, dataMode))
        : eq(paymentReceiptsTable.userId, userId),
    );
  const receiptRows = await db
    .select()
    .from(receiptsTable)
    .where(dataMode ? and(eq(receiptsTable.userId, userId), eq(receiptsTable.dataMode, dataMode)) : eq(receiptsTable.userId, userId));
  const jobOrderRows = await db
    .select()
    .from(jobOrdersTable)
    .where(dataMode ? and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode)) : eq(jobOrdersTable.userId, userId));
  const recurringRows = await db
    .select()
    .from(recurringInvoicesTable)
    .where(eq(recurringInvoicesTable.userId, userId));
  const templateRows = await db
    .select()
    .from(quotationTemplatesTable)
    .where(eq(quotationTemplatesTable.userId, userId));
  const proposalRows = await db
    .select()
    .from(proposalDocumentsTable)
    .where(eq(proposalDocumentsTable.userId, userId));
  const proposalActivityRows = await db
    .select()
    .from(proposalActivityLogTable)
    .where(eq(proposalActivityLogTable.userId, userId));
  const proposalQuestionRows = await db
    .select()
    .from(proposalQuestionsTable)
    .where(eq(proposalQuestionsTable.userId, userId));
  const clientProposalRows = await db
    .select()
    .from(clientProposalsTable)
    .where(eq(clientProposalsTable.userId, userId));

  const invoiceIds = invoiceRows.map((r) => r.id);
  const quotationIds = quotationRows.map((r) => r.id);
  const jobOrderIds = jobOrderRows.map((r) => r.id);
  const recurringIds = recurringRows.map((r) => r.id);
  const templateIds = templateRows.map((r) => r.id);
  const proposalIds = proposalRows.map((r) => r.id);

  const [
    invoiceItemsByParent,
    invoiceConsultantsByParent,
    quotationItemsByParent,
    jobOrderItemsByParent,
    jobOrderConsultantsByParent,
    recurringItemsByParent,
    templateItemsByParent,
    proposalConsultantsByParent,
  ] = await Promise.all([
    loadLineItemsByParent(db, INVOICE_ITEMS, invoiceIds),
    loadConsultantIdsByParent(db, INVOICE_CONSULTANTS, invoiceIds),
    loadLineItemsByParent(db, QUOTATION_ITEMS, quotationIds),
    loadLineItemsByParent(db, JOB_ORDER_ITEMS, jobOrderIds),
    loadConsultantIdsByParent(db, JOB_ORDER_CONSULTANTS, jobOrderIds),
    loadLineItemsByParent(db, RECURRING_INVOICE_ITEMS, recurringIds),
    loadLineItemsByParent(db, QUOTATION_TEMPLATE_ITEMS, templateIds),
    loadConsultantIdsByParent(db, PROPOSAL_CONSULTANTS, proposalIds),
  ]);

  const payload: BackupPayload = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedByUserId: userId,
    includeCompany,
    clients: clients.map(serializeRow),
    invoices: invoiceRows.map((row) => ({
      row: serializeRow(row),
      items: invoiceItemsByParent.get(row.id) ?? [],
      consultantIds: invoiceConsultantsByParent.get(row.id) ?? [],
    })),
    quotations: quotationRows.map((row) => ({
      row: serializeRow(row),
      items: quotationItemsByParent.get(row.id) ?? [],
    })),
    payments: paymentRows.map(serializeRow),
    paymentReceipts: paymentReceiptRows.map(serializeRow),
    receipts: receiptRows.map(serializeRow),
    jobOrders: jobOrderRows.map((row) => ({
      row: serializeRow(row),
      items: jobOrderItemsByParent.get(row.id) ?? [],
      consultantIds: jobOrderConsultantsByParent.get(row.id) ?? [],
    })),
    recurringInvoices: recurringRows.map((row) => ({
      row: serializeRow(row),
      items: recurringItemsByParent.get(row.id) ?? [],
    })),
    quotationTemplates: templateRows.map((row) => ({
      row: serializeRow(row),
      items: templateItemsByParent.get(row.id) ?? [],
    })),
    proposalDocuments: proposalRows.map((row) => ({
      row: serializeRow(row),
      consultantIds: proposalConsultantsByParent.get(row.id) ?? [],
    })),
    proposalActivity: proposalActivityRows.map(serializeRow),
    proposalQuestions: proposalQuestionRows.map(serializeRow),
    clientProposals: clientProposalRows.map(serializeRow),
  };

  if (includeCompany) {
    payload.companySettings = (await db.select().from(companySettingsTable)).map(serializeRow);
    payload.consultants = (await db.select().from(consultantsTable)).map(serializeRow);
  }

  return payload;
}

/**
 * Deletes business data owned by `userId` so a backup can be rolled back cleanly.
 *
 * When `dataMode` is given, only rows in that sandbox are wiped on the
 * data-mode-scoped tables (clients, invoices, quotations, job orders —
 * payments/receipts/payment receipts cascade from those). Tables that don't
 * carry a `dataMode` column (proposals, recurring invoices, quotation
 * templates) are mode-agnostic, so they are only cleared on a full,
 * mode-unaware restore (`dataMode` omitted) — a test-mode restore must never
 * wipe those live-only records, and vice versa.
 */
export async function clearUserBusinessData(userId: string, dataMode?: DataMode): Promise<void> {
  await db.transaction(async (tx) => {
    if (!dataMode) {
      await tx.delete(proposalDocumentsTable).where(eq(proposalDocumentsTable.userId, userId));
      await tx.delete(clientProposalsTable).where(eq(clientProposalsTable.userId, userId));
    }
    await tx
      .delete(invoicesTable)
      .where(
        dataMode
          ? and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, dataMode))
          : eq(invoicesTable.userId, userId),
      );
    await tx
      .delete(quotationsTable)
      .where(
        dataMode
          ? and(eq(quotationsTable.userId, userId), eq(quotationsTable.dataMode, dataMode))
          : eq(quotationsTable.userId, userId),
      );
    await tx
      .delete(jobOrdersTable)
      .where(
        dataMode
          ? and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, dataMode))
          : eq(jobOrdersTable.userId, userId),
      );
    if (!dataMode) {
      await tx.delete(recurringInvoicesTable).where(eq(recurringInvoicesTable.userId, userId));
      await tx.delete(quotationTemplatesTable).where(eq(quotationTemplatesTable.userId, userId));
    }
    await tx
      .delete(clientsTable)
      .where(
        dataMode
          ? and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode))
          : eq(clientsTable.userId, userId),
      );
  });
}

export type RestoreBackupOptions = {
  userId: string;
  payload: BackupPayload;
  restoreCompany?: boolean;
  /**
   * When provided, scopes the restore to a single sandbox: only backup rows
   * whose `dataMode` matches are inserted, and only existing rows in that
   * same `dataMode` are cleared first. This guarantees a test-mode restore
   * never touches live rows, and vice versa. When omitted, the full backup
   * is restored (all modes present in the payload) and all of the user's
   * business data is wiped first, matching the pre-test-mode behavior.
   */
  dataMode?: DataMode;
};

function rowDataMode(row: SerializedRow): DataMode | undefined {
  const value = row.dataMode;
  return value === "live" || value === "test" ? value : undefined;
}

function filterByDataMode<T extends SerializedRow>(rows: T[], dataMode?: DataMode): T[] {
  if (!dataMode) return rows;
  return rows.filter((row) => rowDataMode(row) === dataMode);
}

function filterWrappedByDataMode<T extends { row: SerializedRow }>(entries: T[], dataMode?: DataMode): T[] {
  if (!dataMode) return entries;
  return entries.filter((entry) => rowDataMode(entry.row) === dataMode);
}

export type RestoreBackupResult = {
  restored: {
    clients: number;
    invoices: number;
    quotations: number;
    payments: number;
    paymentReceipts: number;
    receipts: number;
    jobOrders: number;
    recurringInvoices: number;
    quotationTemplates: number;
    proposalDocuments: number;
    proposalActivity: number;
    proposalQuestions: number;
    clientProposals: number;
    companySettings: number;
    consultants: number;
  };
};

function remapUserId(row: SerializedRow, userId: string): Record<string, unknown> {
  return { ...row, userId };
}

export async function restoreUserBackup(options: RestoreBackupOptions): Promise<RestoreBackupResult> {
  const { userId, payload, restoreCompany = false, dataMode } = options;
  const parsedFull = BackupPayloadSchema.parse(payload);
  const parsed = {
    ...parsedFull,
    clients: filterByDataMode(parsedFull.clients, dataMode),
    invoices: filterWrappedByDataMode(parsedFull.invoices, dataMode),
    quotations: filterWrappedByDataMode(parsedFull.quotations, dataMode),
    payments: filterByDataMode(parsedFull.payments, dataMode),
    paymentReceipts: filterByDataMode(parsedFull.paymentReceipts, dataMode),
    receipts: filterByDataMode(parsedFull.receipts, dataMode),
    jobOrders: filterWrappedByDataMode(parsedFull.jobOrders, dataMode),
  };

  if (parsedFull.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${parsedFull.version}`);
  }

  const counts = {
    clients: 0,
    invoices: 0,
    quotations: 0,
    payments: 0,
    paymentReceipts: 0,
    receipts: 0,
    jobOrders: 0,
    recurringInvoices: 0,
    quotationTemplates: 0,
    proposalDocuments: 0,
    proposalActivity: 0,
    proposalQuestions: 0,
    clientProposals: 0,
    companySettings: 0,
    consultants: 0,
  };

  await clearUserBusinessData(userId, dataMode);

  await db.transaction(async (tx) => {
    for (const row of parsed.clients) {
      const values = parseDateFields(remapUserId(row, userId), ["createdAt", "updatedAt"]);
      await tx.insert(clientsTable).values(values as typeof clientsTable.$inferInsert);
      counts.clients++;
    }

    for (const { row, items, consultantIds } of parsed.invoices) {
      const values = parseDateFields(remapUserId(row, userId), [
        "createdAt",
        "updatedAt",
        "shareTokenExpiresAt",
      ]);
      const [inserted] = await tx.insert(invoicesTable).values(values as typeof invoicesTable.$inferInsert).returning();
      await replaceLineItems(tx, INVOICE_ITEMS, inserted.id, items as LineItem[]);
      await replaceConsultantIds(tx, INVOICE_CONSULTANTS, inserted.id, consultantIds);
      counts.invoices++;
    }

    for (const { row, items } of parsed.quotations) {
      const values = parseDateFields(remapUserId(row, userId), [
        "createdAt",
        "updatedAt",
        "shareTokenExpiresAt",
      ]);
      const [inserted] = await tx
        .insert(quotationsTable)
        .values(values as typeof quotationsTable.$inferInsert)
        .returning();
      await replaceLineItems(tx, QUOTATION_ITEMS, inserted.id, items as LineItem[]);
      counts.quotations++;
    }

    for (const row of parsed.payments) {
      const values = parseDateFields(remapUserId(row, userId), ["createdAt"]);
      await tx.insert(paymentsTable).values(values as typeof paymentsTable.$inferInsert);
      counts.payments++;
    }

    for (const row of parsed.receipts) {
      const values = parseDateFields(remapUserId(row, userId), ["createdAt", "updatedAt"]);
      await tx.insert(receiptsTable).values(values as typeof receiptsTable.$inferInsert);
      counts.receipts++;
    }

    for (const row of parsed.paymentReceipts) {
      const values = parseDateFields(remapUserId(row, userId), ["uploadedAt"]);
      await tx.insert(paymentReceiptsTable).values(values as typeof paymentReceiptsTable.$inferInsert);
      counts.paymentReceipts++;
    }

    for (const { row, items, consultantIds } of parsed.jobOrders) {
      const values = parseDateFields(remapUserId(row, userId), ["createdAt", "updatedAt"]);
      const [inserted] = await tx.insert(jobOrdersTable).values(values as typeof jobOrdersTable.$inferInsert).returning();
      await replaceLineItems(tx, JOB_ORDER_ITEMS, inserted.id, items as LineItem[]);
      await replaceConsultantIds(tx, JOB_ORDER_CONSULTANTS, inserted.id, consultantIds);
      counts.jobOrders++;
    }

    for (const { row, items } of parsed.recurringInvoices) {
      const values = parseDateFields(remapUserId(row, userId), [
        "createdAt",
        "updatedAt",
        "lastRunAt",
      ]);
      const [inserted] = await tx
        .insert(recurringInvoicesTable)
        .values(values as typeof recurringInvoicesTable.$inferInsert)
        .returning();
      await replaceLineItems(tx, RECURRING_INVOICE_ITEMS, inserted.id, items as LineItem[]);
      counts.recurringInvoices++;
    }

    for (const { row, items } of parsed.quotationTemplates) {
      const values = parseDateFields(remapUserId(row, userId), ["createdAt", "updatedAt"]);
      const [inserted] = await tx
        .insert(quotationTemplatesTable)
        .values(values as typeof quotationTemplatesTable.$inferInsert)
        .returning();
      await replaceLineItems(tx, QUOTATION_TEMPLATE_ITEMS, inserted.id, items as LineItem[]);
      counts.quotationTemplates++;
    }

    // Backups can come from another database: drop creator subs that don't exist here
    // (the column is a nullable FK; portal alerts then fall back to the workspace owner).
    const knownUserSubs = new Set(
      (await tx.select({ googleSub: usersTable.googleSub }).from(usersTable)).map((u) => u.googleSub),
    );
    for (const { row, consultantIds } of parsed.proposalDocuments) {
      const values = parseDateFields(remapUserId(row, userId), [
        "createdAt",
        "updatedAt",
        "shareTokenExpiresAt",
        "clientConfirmedAt",
        "submittedAt",
        "approvedAt",
        "sentAt",
      ]);
      const [inserted] = await tx
        .insert(proposalDocumentsTable)
        .values({
          ...(values as typeof proposalDocumentsTable.$inferInsert),
          createdByUserId:
            typeof values.createdByUserId === "string" && knownUserSubs.has(values.createdByUserId)
              ? values.createdByUserId
              : null,
        })
        .returning();
      await replaceConsultantIds(tx, PROPOSAL_CONSULTANTS, inserted.id, consultantIds);
      counts.proposalDocuments++;
    }

    for (const row of parsed.proposalActivity) {
      const values = parseDateFields(remapUserId(row, userId), ["createdAt"]);
      await tx.insert(proposalActivityLogTable).values(values as typeof proposalActivityLogTable.$inferInsert);
      counts.proposalActivity++;
    }

    for (const row of parsed.proposalQuestions) {
      const values = parseDateFields(remapUserId(row, userId), ["createdAt", "repliedAt"]);
      await tx.insert(proposalQuestionsTable).values(values as typeof proposalQuestionsTable.$inferInsert);
      counts.proposalQuestions++;
    }

    for (const row of parsed.clientProposals) {
      const values = parseDateFields(remapUserId(row, userId), ["createdAt", "updatedAt"]);
      await tx.insert(clientProposalsTable).values(values as typeof clientProposalsTable.$inferInsert);
      counts.clientProposals++;
    }

    if (restoreCompany && parsed.includeCompany) {
      if (parsed.consultants?.length) {
        for (const row of parsed.consultants) {
          const values = parseDateFields(row, ["createdAt", "updatedAt"]);
          await tx
            .insert(consultantsTable)
            .values(values as typeof consultantsTable.$inferInsert)
            .onConflictDoUpdate({
              target: consultantsTable.id,
              set: {
                shortCode: values.shortCode as string,
                name: values.name as string,
                email: (values.email as string | null | undefined) ?? null,
                isActive: values.isActive as boolean,
                updatedAt: values.updatedAt as Date,
              },
            });
          counts.consultants++;
        }
      }

      if (parsed.companySettings?.length) {
        for (const row of parsed.companySettings) {
          // Never take the workspace owner from a backup: restored rows are written under
          // the current owner, so switching it here would hide them.
          const { workspaceDataUserId: _owner, ...rest } = row;
          const values = parseDateFields(rest, ["updatedAt"]);
          const existing = await tx.select().from(companySettingsTable).limit(1);
          if (existing.length > 0) {
            const { id: _id, ...patch } = values;
            await tx
              .update(companySettingsTable)
              .set(patch as Partial<typeof companySettingsTable.$inferInsert>)
              .where(eq(companySettingsTable.id, existing[0]!.id));
          } else {
            await tx.insert(companySettingsTable).values(values as typeof companySettingsTable.$inferInsert);
          }
          counts.companySettings++;
        }
      }
    }
  });

  return { restored: counts };
}
