import {
  CreateClientCertificationAuditBody,
  CreateClientCertificationAuditParams,
  CreateClientCertificationBody,
  CreateClientCertificationParams,
  DeleteClientCertificationAuditParams,
  DeleteClientCertificationParams,
  GetClientCertificationsParams,
  ReplaceClientCertificationsBody,
  ReplaceClientCertificationsParams,
  UpdateClientCertificationAuditBody,
  UpdateClientCertificationAuditParams,
  UpdateClientCertificationBody,
  UpdateClientCertificationParams,
} from "@workspace/api-zod";
import {
  clientCertificationAuditsTable,
  clientCertificationsTable,
  clientsTable,
  db,
  type AuditVisitStatus,
  type DataMode,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { scopedDataUserId } from "../../lib/auth/scopedUserId";
import { currentDataMode } from "../../lib/dataMode";

const router: IRouter = Router();

type CertRow = typeof clientCertificationsTable.$inferSelect;
type AuditRow = typeof clientCertificationAuditsTable.$inferSelect;

function auditDto(row: AuditRow) {
  return {
    id: row.id,
    certificationId: row.certificationId,
    auditDate: row.auditDate,
    status: row.status ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function certificationWithAuditsDto(cert: CertRow, audits: AuditRow[]) {
  const sorted = [...audits].sort((a, b) => b.auditDate.localeCompare(a.auditDate));
  return {
    id: cert.id,
    certificationBody: cert.certificationBody,
    standard: cert.standard,
    audits: sorted.map(auditDto),
  };
}

export function certificationSummaryDto(cert: CertRow, latestAudit?: AuditRow) {
  return {
    id: cert.id,
    certificationBody: cert.certificationBody,
    standard: cert.standard,
    latestAudit: latestAudit
      ? {
          auditDate: latestAudit.auditDate,
          status: latestAudit.status ?? undefined,
        }
      : undefined,
  };
}

async function assertActiveClient(userId: string, dataMode: DataMode, clientId: string) {
  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.userId, userId),
        eq(clientsTable.dataMode, dataMode),
        isNull(clientsTable.deletedAt),
        eq(clientsTable.id, clientId),
      ),
    );
  return client ?? null;
}

async function loadCertification(
  userId: string,
  dataMode: DataMode,
  clientId: string,
  certId: string,
) {
  const [cert] = await db
    .select()
    .from(clientCertificationsTable)
    .where(
      and(
        eq(clientCertificationsTable.id, certId),
        eq(clientCertificationsTable.clientId, clientId),
        eq(clientCertificationsTable.userId, userId),
        eq(clientCertificationsTable.dataMode, dataMode),
      ),
    );
  return cert ?? null;
}

async function loadAuditsForCertIds(certIds: string[]) {
  if (certIds.length === 0) return [] as AuditRow[];
  return db
    .select()
    .from(clientCertificationAuditsTable)
    .where(inArray(clientCertificationAuditsTable.certificationId, certIds))
    .orderBy(desc(clientCertificationAuditsTable.auditDate));
}

async function loadCertificationsView(userId: string, dataMode: DataMode, clientId: string) {
  const certs = await db
    .select()
    .from(clientCertificationsTable)
    .where(
      and(
        eq(clientCertificationsTable.clientId, clientId),
        eq(clientCertificationsTable.userId, userId),
        eq(clientCertificationsTable.dataMode, dataMode),
      ),
    )
    .orderBy(asc(clientCertificationsTable.createdAt));
  const certIds = certs.map((c) => c.id);
  const audits = await loadAuditsForCertIds(certIds);
  const auditsByCert = new Map<string, AuditRow[]>();
  for (const audit of audits) {
    const list = auditsByCert.get(audit.certificationId) ?? [];
    list.push(audit);
    auditsByCert.set(audit.certificationId, list);
  }
  return {
    clientId,
    certifications: certs.map((c) => certificationWithAuditsDto(c, auditsByCert.get(c.id) ?? [])),
  };
}

/** Batched summaries for client list rows (one query for certs, one for audits). */
export async function loadClientCertificationSummaries(
  userId: string,
  dataMode: DataMode,
  clientIds: string[],
): Promise<Map<string, ReturnType<typeof certificationSummaryDto>[]>> {
  const result = new Map<string, ReturnType<typeof certificationSummaryDto>[]>();
  for (const id of clientIds) result.set(id, []);
  if (clientIds.length === 0) return result;

  const certs = await db
    .select()
    .from(clientCertificationsTable)
    .where(
      and(
        eq(clientCertificationsTable.userId, userId),
        eq(clientCertificationsTable.dataMode, dataMode),
        inArray(clientCertificationsTable.clientId, clientIds),
      ),
    )
    .orderBy(asc(clientCertificationsTable.createdAt));

  const certIds = certs.map((c) => c.id);
  const audits = await loadAuditsForCertIds(certIds);
  const latestByCert = new Map<string, AuditRow>();
  for (const audit of audits) {
    if (!latestByCert.has(audit.certificationId)) {
      latestByCert.set(audit.certificationId, audit);
    }
  }

  for (const cert of certs) {
    const summary = certificationSummaryDto(cert, latestByCert.get(cert.id));
    const list = result.get(cert.clientId) ?? [];
    list.push(summary);
    result.set(cert.clientId, list);
  }
  return result;
}

function normalizeAuditStatus(status: AuditVisitStatus | undefined): AuditVisitStatus | null {
  return status ?? null;
}

function toAuditDateString(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

router.get("/clients/:id/certifications", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const { id } = GetClientCertificationsParams.parse(req.params);
  if (!(await assertActiveClient(userId, dataMode, id))) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(await loadCertificationsView(userId, dataMode, id));
});

router.post("/clients/:id/certifications", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const { id } = CreateClientCertificationParams.parse(req.params);
  const body = CreateClientCertificationBody.parse(req.body);
  if (!(await assertActiveClient(userId, dataMode, id))) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const [created] = await db
    .insert(clientCertificationsTable)
    .values({
      userId,
      dataMode,
      clientId: id,
      certificationBody: body.certificationBody.trim(),
      standard: body.standard.trim(),
    })
    .returning();
  res.status(201).json(certificationWithAuditsDto(created, []));
});

router.put("/clients/:id/certifications", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const { id } = ReplaceClientCertificationsParams.parse(req.params);
  const body = ReplaceClientCertificationsBody.parse(req.body);
  if (!(await assertActiveClient(userId, dataMode, id))) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(clientCertificationsTable)
      .where(
        and(
          eq(clientCertificationsTable.clientId, id),
          eq(clientCertificationsTable.userId, userId),
          eq(clientCertificationsTable.dataMode, dataMode),
        ),
      );

    for (const item of body.certifications) {
      const [cert] = await tx
        .insert(clientCertificationsTable)
        .values({
          userId,
          dataMode,
          clientId: id,
          certificationBody: item.certificationBody.trim(),
          standard: item.standard.trim(),
        })
        .returning();
      const audits = item.audits ?? [];
      if (audits.length > 0) {
        await tx.insert(clientCertificationAuditsTable).values(
          audits.map((a) => ({
            certificationId: cert.id,
            auditDate: toAuditDateString(a.auditDate),
            status: normalizeAuditStatus(a.status),
            notes: a.notes?.trim() || null,
          })),
        );
      }
    }
  });

  res.json(await loadCertificationsView(userId, dataMode, id));
});

router.patch("/clients/:id/certifications/:certId", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const { id, certId } = UpdateClientCertificationParams.parse(req.params);
  const body = UpdateClientCertificationBody.parse(req.body);
  const cert = await loadCertification(userId, dataMode, id, certId);
  if (!cert) {
    res.status(404).json({ error: "Certification not found" });
    return;
  }
  const patch: Partial<typeof clientCertificationsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.certificationBody !== undefined) patch.certificationBody = body.certificationBody.trim();
  if (body.standard !== undefined) patch.standard = body.standard.trim();
  const [updated] = await db
    .update(clientCertificationsTable)
    .set(patch)
    .where(eq(clientCertificationsTable.id, certId))
    .returning();
  const audits = await loadAuditsForCertIds([certId]);
  res.json(certificationWithAuditsDto(updated, audits));
});

router.delete("/clients/:id/certifications/:certId", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const { id, certId } = DeleteClientCertificationParams.parse(req.params);
  const cert = await loadCertification(userId, dataMode, id, certId);
  if (!cert) {
    res.status(404).json({ error: "Certification not found" });
    return;
  }
  await db.delete(clientCertificationsTable).where(eq(clientCertificationsTable.id, certId));
  res.status(204).send();
});

router.post("/clients/:id/certifications/:certId/audits", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const { id, certId } = CreateClientCertificationAuditParams.parse(req.params);
  const body = CreateClientCertificationAuditBody.parse(req.body);
  const cert = await loadCertification(userId, dataMode, id, certId);
  if (!cert) {
    res.status(404).json({ error: "Certification not found" });
    return;
  }
  const [created] = await db
    .insert(clientCertificationAuditsTable)
    .values({
      certificationId: certId,
      auditDate: toAuditDateString(body.auditDate),
      status: normalizeAuditStatus(body.status),
      notes: body.notes?.trim() || null,
    })
    .returning();
  res.status(201).json(auditDto(created));
});

router.patch("/clients/:id/certifications/:certId/audits/:auditId", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const { id, certId, auditId } = UpdateClientCertificationAuditParams.parse(req.params);
  const body = UpdateClientCertificationAuditBody.parse(req.body);
  const cert = await loadCertification(userId, dataMode, id, certId);
  if (!cert) {
    res.status(404).json({ error: "Certification not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(clientCertificationAuditsTable)
    .where(
      and(
        eq(clientCertificationAuditsTable.id, auditId),
        eq(clientCertificationAuditsTable.certificationId, certId),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Audit record not found" });
    return;
  }
  const patch: Partial<typeof clientCertificationAuditsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.auditDate !== undefined) patch.auditDate = toAuditDateString(body.auditDate);
  if (body.status !== undefined) patch.status = normalizeAuditStatus(body.status);
  if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
  const [updated] = await db
    .update(clientCertificationAuditsTable)
    .set(patch)
    .where(eq(clientCertificationAuditsTable.id, auditId))
    .returning();
  res.json(auditDto(updated));
});

router.delete("/clients/:id/certifications/:certId/audits/:auditId", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const { id, certId, auditId } = DeleteClientCertificationAuditParams.parse(req.params);
  const cert = await loadCertification(userId, dataMode, id, certId);
  if (!cert) {
    res.status(404).json({ error: "Certification not found" });
    return;
  }
  const deleted = await db
    .delete(clientCertificationAuditsTable)
    .where(
      and(
        eq(clientCertificationAuditsTable.id, auditId),
        eq(clientCertificationAuditsTable.certificationId, certId),
      ),
    )
    .returning({ id: clientCertificationAuditsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Audit record not found" });
    return;
  }
  res.status(204).send();
});

export default router;
