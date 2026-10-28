import type { Request } from "express";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  clientsTable,
  consultantsTable,
  db,
  proposalActivityLogTable,
  proposalDocumentsTable,
  type ProposalActivityEventType,
} from "@workspace/db";
import { loadConsultantIds, PROPOSAL_CONSULTANTS } from "../../lib/consultantLinks";

export const ProposalPhaseSchema = z.object({
  phase: z.number().int(),
  title: z.string(),
  description: z.string().default(""),
  deliverable: z.string().default(""),
  weeks: z.number().int().positive(),
  startMonth: z.number().int().min(1).max(6),
  spanMonths: z.number().int().min(1).max(6),
});

export const PaymentScheduleSchema = z.object({
  label: z.string(),
  percentage: z.number().min(0).max(100),
});

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function proposalDto(
  row: typeof proposalDocumentsTable.$inferSelect,
  consultantIds: string[],
  clientName?: string,
) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName,
    proposalNo: row.proposalNo,
    proposalRevision: row.proposalRevision,
    status: row.status,
    validFrom: row.validFrom ?? undefined,
    validUntil: row.validUntil ?? undefined,
    coverPhotoUrl: row.coverPhotoUrl ?? undefined,
    firmIntro: row.firmIntro ?? undefined,
    certificationBodyIntro: row.certificationBodyIntro ?? undefined,
    clientStaffCount: row.clientStaffCount ?? undefined,
    isoStandards: row.isoStandards ?? [],
    proposalScope: row.proposalScope ?? undefined,
    certificationLocations: row.certificationLocations ?? [],
    templateData: row.templateData ?? {},
    scopePhases: row.scopePhases ?? [],
    pmToolsIntro: row.pmToolsIntro ?? undefined,
    trainingPlatformIntro: row.trainingPlatformIntro ?? undefined,
    termsConditions: row.termsConditions ?? undefined,
    consultantIds,
    consultantPortfolio: row.consultantPortfolio ?? [],
    jobReferences: row.jobReferences ?? [],
    testimonials: row.testimonials ?? [],
    currency: row.currency,
    totalAmount: toNumber(row.totalAmount),
    paymentSchedule: row.paymentSchedule ?? [],
    milestoneInvoices: row.milestoneInvoices ?? [],
    shareToken: row.shareToken ?? undefined,
    shareTokenExpiresAt: row.shareTokenExpiresAt?.toISOString() ?? undefined,
    jobOrderId: row.jobOrderId ?? undefined,
    revisionRequestComment: row.revisionRequestComment ?? undefined,
    clientConfirmedAt: row.clientConfirmedAt?.toISOString() ?? undefined,
    clientSignatureName: row.clientSignatureName ?? undefined,
    submittedAt: row.submittedAt?.toISOString() ?? undefined,
    approvedAt: row.approvedAt?.toISOString() ?? undefined,
    sentAt: row.sentAt?.toISOString() ?? undefined,
    supersededById: row.supersededById ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function logActivity(
  proposalId: string,
  userId: string,
  eventType: ProposalActivityEventType,
  opts: {
    actorType?: string;
    eventData?: Record<string, unknown>;
    req?: Request;
  } = {},
): Promise<void> {
  await db.insert(proposalActivityLogTable).values({
    proposalId,
    userId,
    eventType,
    actorType: opts.actorType ?? "client",
    eventData: opts.eventData ?? null,
    clientIp: opts.req?.ip ?? null,
    userAgent: typeof opts.req?.headers["user-agent"] === "string" ? opts.req.headers["user-agent"] : null,
  });
}

/**
 * Loads a proposal (with client + linked consultant ids) scoped to its owner.
 * Bundling `consultantIds` in here means most call sites -- which only read
 * consultants, never write them -- get everything proposalDto needs from
 * this one call instead of a second query at every use site.
 */
export async function loadProposalOwned(userId: string, id: string) {
  const [row] = await db
    .select({ proposal: proposalDocumentsTable, client: clientsTable })
    .from(proposalDocumentsTable)
    .leftJoin(clientsTable, eq(proposalDocumentsTable.clientId, clientsTable.id))
    .where(and(eq(proposalDocumentsTable.userId, userId), eq(proposalDocumentsTable.id, id)));
  if (!row) return null;
  const consultantIds = await loadConsultantIds(db, PROPOSAL_CONSULTANTS, id);
  return { ...row, consultantIds };
}

export async function loadConsultants(ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(consultantsTable).where(inArray(consultantsTable.id, ids));
}
