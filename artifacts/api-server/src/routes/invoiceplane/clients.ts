import { randomUUID } from "crypto";
import {
  CreateClientBody,
  DeleteClientParams,
  GetClientParams,
  ListClientsQueryParams,
  UpdateClientBody,
  UpdateClientParams,
  UpdateClientResponse,
  UpsertClientProposalBody,
} from "@workspace/api-zod";
import { z as zz } from "zod";
import {
  auditLogTable,
  clientsTable,
  clientProposalsTable,
  db,
  proposalDocumentsTable,
  quotationsTable,
  type ProposalPaymentScheduleItem,
} from "@workspace/db";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { logger } from "../../lib/logger";
import { clientImportJobRateLimiter } from "../../lib/rateLimit";
import { stringify as csvStringify } from "csv-stringify/sync";
import { parse as csvParse } from "csv-parse/sync";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { currentDataMode, type DataMode } from "../../lib/dataMode";
import { DEFAULT_PAYMENT_SCHEDULE, DEFAULT_SCOPE_PHASES, DEFAULT_TERMS } from "../../lib/proposalDefaults";
import { isUniqueViolation } from "../../lib/pgErrors";
import { withUniqueRetry } from "../../lib/withUniqueRetry";
import {
  allocateUniqueClientCode,
  BulkIdsBody,
  buildClientCode,
  clientDto,
  clientProposalDto,
  handleCsvImportUpload,
  isActiveClientCodeTaken,
  logAuditEvent,
  money,
  today,
  toNumber,
} from "./helpers";
import { loadClientCertificationSummaries } from "./clientCertifications";

const router: IRouter = Router();

const CLIENT_IMPORT_BATCH_INSERT = 40;
const CLIENT_IMPORT_BATCH_UPDATE = 12;

type ClientImportJobState = {
  userId: string;
  status: "running" | "completed" | "failed";
  phase: string;
  processed: number;
  total: number;
  result?: {
    inserted: number;
    updated: number;
    skipped: number;
    skippedRows: Array<{ row: number; reason: string; data: Record<string, string> }>;
    errors: string[];
  };
  error?: string;
  createdAt: number;
};

const clientImportJobs = new Map<string, ClientImportJobState>();

function scheduleClientImportJobCleanup(jobId: string) {
  setTimeout(() => clientImportJobs.delete(jobId), 5 * 60_000);
}

async function commitClientsCsvImport(params: {
  userId: string;
  dataMode: DataMode;
  accepted: Array<{ row: number; record: Record<string, string> }>;
  overwrite: boolean;
  errors: string[];
  onProgress?: (processed: number, total: number, phase: string) => void;
}): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
  skippedRows: Array<{ row: number; reason: string; data: Record<string, string> }>;
  errors: string[];
}> {
  const { userId, dataMode, accepted, overwrite, errors, onProgress } = params;
  const total = accepted.length;
  let processed = 0;
  const report = () => onProgress?.(processed, total, "Saving clients");

  const existingClients = await db
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt)));
  const existingClientMap = new Map(
    existingClients.map((c) => [(c.name ?? "").toLowerCase().trim(), c.id]),
  );

  type InsertItem = { row: number; record: Record<string, string> };
  type UpdateItem = { row: number; record: Record<string, string>; existingClientId: string };
  const toInsert: InsertItem[] = [];
  const toUpdate: UpdateItem[] = [];
  const skippedRows: Array<{ row: number; reason: string; data: Record<string, string> }> = [];

  for (const { row, record: r } of accepted) {
    const nameLower = (r.name ?? "").toLowerCase().trim();
    const existingClientId = nameLower ? existingClientMap.get(nameLower) : undefined;
    if (existingClientId) {
      if (overwrite) {
        toUpdate.push({ row, record: r, existingClientId });
      } else {
        skippedRows.push({ row, reason: `Company name already exists (${r.name})`, data: r });
      }
    } else {
      toInsert.push({ row, record: r });
    }
  }

  let inserted = 0;
  let updated = 0;
  const reservedCodes = new Set<string>();

  onProgress?.(0, total, "Saving clients");

  for (let i = 0; i < toUpdate.length; i += CLIENT_IMPORT_BATCH_UPDATE) {
    const slice = toUpdate.slice(i, i + CLIENT_IMPORT_BATCH_UPDATE);
    const prepared = [];
    for (const item of slice) {
      prepared.push({
        ...item,
        clientCode: await allocateUniqueClientCode(
          userId,
          dataMode,
          item.record.clientCode?.trim() || buildClientCode(item.record.name),
          item.existingClientId,
          reservedCodes,
        ),
      });
    }
    await Promise.all(
      prepared.map(async ({ record: r, existingClientId, clientCode }) => {
        await db
          .update(clientsTable)
          .set({
            name: r.name,
            email: r.email,
            clientCode,
            phone: r.phone ?? null,
            addressLine1: r.addressLine1 ?? r.address ?? null,
            addressLine2: r.addressLine2 ?? null,
            addressLine3: r.addressLine3 ?? null,
            addressLine4: r.addressLine4 ?? null,
            country: r.country ?? null,
            contactPerson: r.contactPerson ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(clientsTable.userId, userId),
              eq(clientsTable.dataMode, dataMode),
              eq(clientsTable.id, existingClientId),
            ),
          );
      }),
    );
    updated += slice.length;
    processed += slice.length;
    report();
  }

  const normName = (name: string) => (name ?? "").toLowerCase().trim();
  let insertBatch: InsertItem[] = [];

  const flushInserts = async () => {
    if (insertBatch.length === 0) return;
    const values = [];
    for (const { record: r } of insertBatch) {
      values.push({
        userId,
        dataMode,
        name: r.name,
        email: r.email,
        clientCode: await allocateUniqueClientCode(
          userId,
          dataMode,
          r.clientCode?.trim() || buildClientCode(r.name),
          undefined,
          reservedCodes,
        ),
        phone: r.phone ?? null,
        addressLine1: r.addressLine1 ?? r.address ?? null,
        addressLine2: r.addressLine2 ?? null,
        addressLine3: r.addressLine3 ?? null,
        addressLine4: r.addressLine4 ?? null,
        country: r.country ?? null,
        contactPerson: r.contactPerson ?? null,
      });
    }
    const returned = await db.insert(clientsTable).values(values).returning({ id: clientsTable.id, name: clientsTable.name });
    for (const row of returned) {
      existingClientMap.set(normName(row.name), row.id);
    }
    inserted += insertBatch.length;
    processed += insertBatch.length;
    insertBatch = [];
    report();
  };

  for (const item of toInsert) {
    const nl = normName(item.record.name);
    if (insertBatch.some((b) => normName(b.record.name) === nl)) {
      await flushInserts();
    }
    if (existingClientMap.has(nl)) {
      skippedRows.push({
        row: item.row,
        reason: `Company name already exists (${item.record.name})`,
        data: item.record,
      });
      processed += 1;
      report();
      continue;
    }
    insertBatch.push(item);
    if (insertBatch.length >= CLIENT_IMPORT_BATCH_INSERT) {
      await flushInserts();
    }
  }
  await flushInserts();

  return { inserted, updated, skipped: skippedRows.length, skippedRows, errors };
}

const ClientsListQuery = ListClientsQueryParams.extend({
  sortBy: zz.enum(["name", "clientCode", "email", "createdAt", "isActive"]).optional(),
  sortDir: zz.enum(["asc", "desc"]).optional(),
});
router.get("/clients", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const query = ClientsListQuery.parse(req.query);
  const conditions = [eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt)];
  if (query.active !== undefined) conditions.push(eq(clientsTable.isActive, query.active));
  const search = query.q?.trim();
  const where = search
    ? and(
        ...conditions,
        or(
          sql`to_tsvector('simple', coalesce(${clientsTable.name}, '') || ' ' || coalesce(${clientsTable.email}, '')) @@ plainto_tsquery('simple', ${search})`,
          ilike(clientsTable.clientCode, `%${search}%`),
          ilike(clientsTable.name, `${search}%`),
        ),
      )
    : and(...conditions);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const dir = query.sortDir === "asc" ? asc : desc;
  const orderCol =
    query.sortBy === "name"
      ? clientsTable.name
      : query.sortBy === "clientCode"
        ? clientsTable.clientCode
        : query.sortBy === "email"
          ? clientsTable.email
          : query.sortBy === "isActive"
            ? clientsTable.isActive
            : clientsTable.createdAt;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(clientsTable).where(where),
    db.select().from(clientsTable).where(where).orderBy(dir(orderCol)).limit(pageSize).offset(offset),
  ]);
  const certSummaries = await loadClientCertificationSummaries(
    userId,
    dataMode,
    rows.map((r) => r.id),
  );
  res.json({
    data: rows.map((row) => ({
      ...clientDto(row),
      certifications: certSummaries.get(row.id) ?? [],
    })),
    total: Number(total),
    page,
    pageSize,
  });
});

// Registered before /clients/:id so "deleted" isn't captured as an :id.
router.get("/clients/deleted", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const query = zz.object({ page: zz.coerce.number().int().min(1).optional(), pageSize: zz.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
  const where = and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), sql`${clientsTable.deletedAt} IS NOT NULL`);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(clientsTable).where(where),
    db.select().from(clientsTable).where(where).orderBy(desc(clientsTable.deletedAt)).limit(pageSize).offset(offset),
  ]);
  res.json({
    data: rows.map((r) => ({ ...clientDto(r), deletedAt: r.deletedAt?.toISOString() })),
    total: Number(total),
    page,
    pageSize,
  });
});

const ClientOptionsQuery = zz.object({
  q: zz.string().optional(),
  limit: zz.coerce.number().int().min(1).max(500).optional(),
  active: zz
    .union([zz.literal("true"), zz.literal("false"), zz.literal("1"), zz.literal("0")])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
});

/** Lightweight client picker payload for invoice/quotation forms and filters. */
router.get("/clients/options", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const query = ClientOptionsQuery.parse(req.query);
  const limit = query.limit ?? 200;
  const conditions = [eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt)];
  if (query.active !== undefined) conditions.push(eq(clientsTable.isActive, query.active));
  const search = query.q?.trim();
  const where = search
    ? and(
        ...conditions,
        or(
          ilike(clientsTable.name, `%${search}%`),
          ilike(clientsTable.clientCode, `%${search}%`),
        ),
      )
    : and(...conditions);
  const rows = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      clientCode: clientsTable.clientCode,
    })
    .from(clientsTable)
    .where(where)
    .orderBy(asc(clientsTable.name))
    .limit(limit);
  res.json(rows);
});

router.get("/clients/export", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const rows = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt)))
    .orderBy(desc(clientsTable.createdAt));
  // Align export format with the import template header/order.
  const csv = csvStringify(rows.map((row) => {
    const dto = clientDto(row);
    return {
      name: dto.name,
      email: dto.email,
      clientCode: dto.clientCode,
      phone: dto.phone ?? "",
      addressLine1: dto.addressLine1 ?? "",
      addressLine2: dto.addressLine2 ?? "",
      addressLine3: dto.addressLine3 ?? "",
      addressLine4: dto.addressLine4 ?? "",
      country: dto.country ?? "",
      contactPerson: dto.contactPerson ?? "",
    };
  }), {
    header: true,
    columns: ["name", "email", "clientCode", "phone", "addressLine1", "addressLine2", "addressLine3", "addressLine4", "country", "contactPerson"],
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=clients.csv");
  res.send(csv);
});

router.post("/clients/import", handleCsvImportUpload, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  try {
    const userId = (req as unknown as AuthedRequest).userId;
    const dataMode = await currentDataMode();
    const commit = req.query.commit === "true";
    const overwrite = req.query.overwrite === "true";
    const parsed: Record<string, string>[] = csvParse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Process all rows; rows with empty/missing names are treated as errors
    // but do not stop processing of subsequent rows.
    const recordsWithRows = parsed.map((r, idx) => ({ row: idx + 1, record: r }));
    const totalRowsInFile = recordsWithRows.length;
    const accepted: Array<{ row: number; record: Record<string, string> }> = [];
    const errors: string[] = [];

    for (const { row, record } of recordsWithRows) {
      const raw = record?.name;
      const name = typeof raw === "string" ? raw.trim() : "";
      // Ignore comment/instruction rows from templates.
      if (name.startsWith("#")) continue;

      if (!name) {
        errors.push(`Row ${row}: name is required`);
        continue;
      }

      accepted.push({ row, record });
    }

    // Fetch existing clients with their names (case-insensitive comparison)
    const existingClients = await db
      .select({ id: clientsTable.id, name: clientsTable.name })
      .from(clientsTable)
      .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt)));
    const existingClientMap = new Map(
      existingClients.map((c) => [(c.name ?? "").toLowerCase().trim(), c.id]),
    );

    if (!commit) {
      const probableSkippedRows: Array<{ row: number; reason: string }> = [];
      for (const { row, record: r } of accepted) {
        const nameLower = (r.name ?? "").toLowerCase().trim();
        if (nameLower && existingClientMap.has(nameLower)) {
          probableSkippedRows.push({ row, reason: `Company name already exists (${r.name})` });
        }
      }
      res.json({
        previewCount: accepted.length,
        totalRowsInFile,
        errors,
        probableSkips: probableSkippedRows.length,
        probableSkippedRows,
      });
      return;
    }
    // Valid rows import: commit saves accepted rows only; invalid rows were skipped at parse time.

    // Job state lives in this process's memory. On Vercel the status poll can
    // land on another instance (and work after the response may be frozen),
    // so import synchronously there; the client accepts either response shape.
    const asyncMode =
      !process.env["VERCEL"] && typeof req.query.async === "string" && req.query.async === "true";
    if (asyncMode) {
      const jobId = randomUUID();
      const total = accepted.length;
      clientImportJobs.set(jobId, {
        userId,
        status: "running",
        phase: "Queued",
        processed: 0,
        total,
        createdAt: Date.now(),
      });
      setImmediate(() => {
        const job = clientImportJobs.get(jobId);
        if (!job) return;
        job.phase = "Saving clients";
        void commitClientsCsvImport({
          userId,
          dataMode,
          accepted,
          overwrite,
          errors,
          onProgress: (processed, t, phase) => {
            const j = clientImportJobs.get(jobId);
            if (j) {
              j.processed = processed;
              j.total = t;
              j.phase = phase;
            }
          },
        })
          .then((result) => {
            const j = clientImportJobs.get(jobId);
            if (j) {
              j.status = "completed";
              j.phase = "Done";
              j.processed = j.total;
              j.result = result;
            }
            scheduleClientImportJobCleanup(jobId);
          })
          .catch((e) => {
            const j = clientImportJobs.get(jobId);
            if (j) {
              j.status = "failed";
              j.phase = "Failed";
              j.error = e instanceof Error ? e.message : String(e);
            }
            scheduleClientImportJobCleanup(jobId);
          });
      });
      res.status(202).json({ jobId, acceptedCount: accepted.length });
      return;
    }

    const result = await commitClientsCsvImport({ userId, dataMode, accepted, overwrite, errors });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to parse client CSV import");
    res.status(400).json({ error: "Failed to parse CSV. Check the file format and try again." });
  }
});

router.get("/clients/import/jobs/:jobId", clientImportJobRateLimiter, (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const jobId = typeof req.params.jobId === "string" ? req.params.jobId : "";
  const job = clientImportJobs.get(jobId);
  if (!job || job.userId !== userId) {
    res.status(404).json({ error: "Import job not found" });
    return;
  }
  if (job.status === "completed" && job.result) {
    res.json({
      status: job.status,
      phase: job.phase,
      processed: job.processed,
      total: job.total,
      inserted: job.result.inserted,
      updated: job.result.updated,
      skipped: job.result.skipped,
      skippedRows: job.result.skippedRows,
      errors: job.result.errors,
    });
    return;
  }
  if (job.status === "failed") {
    res.json({
      status: job.status,
      phase: job.phase,
      processed: job.processed,
      total: job.total,
      error: job.error ?? "Import failed",
    });
    return;
  }
  res.json({
    status: job.status,
    phase: job.phase,
    processed: job.processed,
    total: job.total,
  });
});

router.post("/clients", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const body = CreateClientBody.parse(req.body);
  const requested = body.clientCode?.trim() || buildClientCode(body.name);
  const row = await withUniqueRetry(async () => {
    const clientCode = await allocateUniqueClientCode(userId, dataMode, requested);
    const [created] = await db
      .insert(clientsTable)
      .values({ ...body, clientCode, userId, dataMode })
      .returning();
    return created;
  });
  res.status(201).json(clientDto(row));
});

router.get("/clients/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GetClientParams.parse(req.params);
  const [row] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt), eq(clientsTable.id, id)));
  if (!row) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(clientDto(row));
});

const BulkClientStatusBody = zz.object({ ids: zz.array(zz.string().uuid()), isActive: zz.boolean() });

router.delete("/clients/bulk-delete", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { ids } = BulkIdsBody.parse(req.body);
  if (ids.length === 0) { res.status(204).send(); return; }
  const deleted = await db
    .update(clientsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt), inArray(clientsTable.id, ids)))
    .returning({ id: clientsTable.id });
  if (deleted.length > 0) {
    await db.insert(auditLogTable).values(
      deleted.map((row) => ({
        userId,
        dataMode,
        entityType: "client" as const,
        entityId: row.id,
        eventType: "deleted" as const,
      })),
    );
  }
  res.status(204).send();
});

router.patch("/clients/bulk-status", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { ids, isActive } = BulkClientStatusBody.parse(req.body);
  if (ids.length === 0) { res.status(204).send(); return; }
  await db.update(clientsTable).set({ isActive, updatedAt: new Date() })
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt), inArray(clientsTable.id, ids)));
  res.status(204).send();
});

router.patch("/clients/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = UpdateClientParams.parse(req.params);
  const body = UpdateClientBody.parse(req.body);
  const requested = body.clientCode?.trim();
  if (requested && (await isActiveClientCodeTaken(userId, dataMode, requested, id))) {
    res.status(409).json({ error: `Client code "${requested}" is already in use.` });
    return;
  }
  try {
    const [row] = await db
      .update(clientsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt), eq(clientsTable.id, id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    res.json(UpdateClientResponse.parse(clientDto(row)));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `Client code "${requested}" is already in use.` });
      return;
    }
    throw err;
  }
});

router.delete("/clients/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = DeleteClientParams.parse(req.params);
  const [row] = await db
    .update(clientsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt), eq(clientsTable.id, id)))
    .returning({ id: clientsTable.id });
  if (row) {
    await logAuditEvent({ userId, dataMode, entityType: "client", entityId: row.id, eventType: "deleted" });
  }
  res.status(204).send();
});

router.post("/clients/:id/restore", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = GetClientParams.parse(req.params);
  const [existing] = await db
    .select({ id: clientsTable.id, clientCode: clientsTable.clientCode })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), eq(clientsTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  if (await isActiveClientCodeTaken(userId, dataMode, existing.clientCode, id)) {
    res.status(409).json({
      error: `Cannot restore: client code "${existing.clientCode}" is already used by another active client.`,
    });
    return;
  }
  try {
    const [row] = await db
      .update(clientsTable)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), eq(clientsTable.id, id)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    await logAuditEvent({ userId, dataMode, entityType: "client", entityId: id, eventType: "restored" });
    res.json(clientDto(row));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({
        error: `Cannot restore: client code "${existing.clientCode}" is already used by another active client.`,
      });
      return;
    }
    throw err;
  }
});

const ClientProposalParams = zz.object({ id: zz.string().uuid() });

/** Statuses that represent a "confirmed" system-generated quotation for proposal display. */
const CONFIRMED_QUOTATION_STATUSES = ["confirmed", "invoiced"] as const;

async function loadConfirmedQuotation(userId: string, clientId: string, dataMode: DataMode) {
  const [row] = await db
    .select()
    .from(quotationsTable)
    .where(
      and(
        eq(quotationsTable.userId, userId),
        eq(quotationsTable.dataMode, dataMode),
        eq(quotationsTable.clientId, clientId),
        inArray(quotationsTable.status, [...CONFIRMED_QUOTATION_STATUSES]),
      ),
    )
    .orderBy(desc(quotationsTable.quotationDate), desc(quotationsTable.createdAt))
    .limit(1);
  if (!row) return undefined;
  return {
    id: row.id,
    quotationNumber: row.quotationNumber,
    quotationDate: row.quotationDate,
    currency: row.currency as "HKD" | "USD" | "CNY" | "MOP",
    total: toNumber(row.total),
    driveFileUrl: row.driveFileUrl ?? undefined,
  };
}

async function loadClientProposal(userId: string, clientId: string) {
  const [row] = await db
    .select()
    .from(clientProposalsTable)
    .where(and(eq(clientProposalsTable.userId, userId), eq(clientProposalsTable.clientId, clientId)));
  return row ? clientProposalDto(row) : undefined;
}

router.get("/clients/:id/proposal", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = ClientProposalParams.parse(req.params);
  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt), eq(clientsTable.id, id)));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const [confirmedQuotation, proposal] = await Promise.all([
    loadConfirmedQuotation(userId, id, dataMode),
    loadClientProposal(userId, id),
  ]);
  res.json({ clientId: id, confirmedQuotation, proposal });
});

router.post("/clients/:id/proposal/migrate", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = ClientProposalParams.parse(req.params);

  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt), eq(clientsTable.id, id)));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const [confirmedQuotation, legacy] = await Promise.all([
    loadConfirmedQuotation(userId, id, dataMode),
    loadClientProposal(userId, id),
  ]);

  if (legacy?.proposalNo) {
    const [existing] = await db
      .select({ id: proposalDocumentsTable.id })
      .from(proposalDocumentsTable)
      .where(
        and(
          eq(proposalDocumentsTable.userId, userId),
          eq(proposalDocumentsTable.clientId, id),
          eq(proposalDocumentsTable.proposalNo, legacy.proposalNo!),
          eq(proposalDocumentsTable.proposalRevision, legacy.proposalRevision ?? 0),
        ),
      );
    if (existing) {
      res.json({
        proposalId: existing.id,
        proposalNo: legacy.proposalNo,
        alreadyExists: true,
        clientId: id,
      });
      return;
    }
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [{ c }] = await db
    .select({ c: count() })
    .from(proposalDocumentsTable)
    .where(eq(proposalDocumentsTable.userId, userId));
  const proposalNo = legacy?.proposalNo?.trim() || `P-${stamp}-${String(Number(c ?? 0) + 1).padStart(3, "0")}`;
  const driveNote = legacy?.driveFileUrl?.trim()
    ? `External proposal file: ${legacy.driveFileUrl.trim()}`
    : undefined;

  const [row] = await db
    .insert(proposalDocumentsTable)
    .values({
      userId,
      clientId: id,
      proposalNo,
      proposalRevision: legacy?.proposalRevision ?? 0,
      status: "draft",
      validFrom: today(),
      validUntil: today(180),
      proposalScope: driveNote ?? undefined,
      scopePhases: DEFAULT_SCOPE_PHASES,
      termsConditions: DEFAULT_TERMS,
      currency: legacy?.currency ?? confirmedQuotation?.currency ?? "HKD",
      totalAmount: money(Number(legacy?.totalAmount ?? confirmedQuotation?.total ?? 0)),
      paymentSchedule:
        legacy?.paymentSchedule?.length ? legacy.paymentSchedule : DEFAULT_PAYMENT_SCHEDULE,
    })
    .returning();

  res.status(201).json({
    proposalId: row.id,
    proposalNo: row.proposalNo,
    migrated: true,
    clientId: id,
  });
});

router.put("/clients/:id/proposal", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const dataMode = await currentDataMode();
  const { id } = ClientProposalParams.parse(req.params);
  const body = UpsertClientProposalBody.parse(req.body);

  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(eq(clientsTable.userId, userId), eq(clientsTable.dataMode, dataMode), isNull(clientsTable.deletedAt), eq(clientsTable.id, id)));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const schedule: ProposalPaymentScheduleItem[] = (body.paymentSchedule ?? []).map((item) => ({
    label: String(item.label ?? "").trim(),
    percentage: Number(item.percentage) || 0,
  }));
  const revision = Math.max(0, Math.trunc(Number(body.proposalRevision ?? 0)));
  const values = {
    proposalNo: body.proposalNo?.trim() ? body.proposalNo.trim() : null,
    proposalRevision: revision,
    currency: body.currency ?? "HKD",
    totalAmount: money(Number(body.totalAmount ?? 0)),
    driveFileUrl: body.driveFileUrl?.trim() ? body.driveFileUrl.trim() : null,
    paymentSchedule: schedule,
    updatedAt: new Date(),
  };

  await db
    .insert(clientProposalsTable)
    .values({ userId, clientId: id, ...values })
    .onConflictDoUpdate({
      target: [clientProposalsTable.userId, clientProposalsTable.clientId],
      set: values,
    });

  const [confirmedQuotation, proposal] = await Promise.all([
    loadConfirmedQuotation(userId, id, dataMode),
    loadClientProposal(userId, id),
  ]);
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '</proposals>; rel="successor-version"');
  res.json({ clientId: id, confirmedQuotation, proposal });
});

export default router;
