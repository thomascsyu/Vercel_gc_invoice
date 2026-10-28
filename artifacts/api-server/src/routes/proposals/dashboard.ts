import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  clientsTable,
  companySettingsTable,
  db,
  proposalActivityLogTable,
  proposalDocumentsTable,
  type ProposalStatus,
} from "@workspace/db";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import { getCompanySettings, invalidateCompanySettingsCache } from "../../lib/companySettingsCache";
import { mergeProposalSetupTemplates } from "../../lib/proposalSetupTemplates";
import { PaymentScheduleSchema, ProposalPhaseSchema } from "./helpers";

const router: IRouter = Router();

const ProposalSetupTemplateSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().optional(),
    isoStandards: z.array(z.string().min(1)).min(1),
    proposalScope: z.string().optional(),
    scopePhases: z.array(ProposalPhaseSchema).min(1),
    paymentSchedule: z.array(PaymentScheduleSchema).min(1),
    termsConditions: z.string().optional(),
    jobReferenceTemplateIds: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    const total = value.paymentSchedule.reduce((sum, row) => sum + row.percentage, 0);
    if (total !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Payment milestone percentages must total 100%",
        path: ["paymentSchedule"],
      });
    }
    value.scopePhases.forEach((phase, index) => {
      if (!(phase.deliverable ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Scope phase ${index + 1} needs a deliverable`,
          path: ["scopePhases", index, "deliverable"],
        });
      }
    });
  });

const ProposalSetupTemplatesPatchSchema = z.object({
  iso9001: ProposalSetupTemplateSchema.optional(),
  "iso14001-45001": ProposalSetupTemplateSchema.optional(),
  iso27001: ProposalSetupTemplateSchema.optional(),
});

const PIPELINE_STATUSES: ProposalStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "confirmed",
  "revision_requested",
  "no_response",
];

const ATTENTION_STATUSES: ProposalStatus[] = [
  "pending_approval",
  "approved",
  "sent",
  "revision_requested",
  "no_response",
  "expired",
];

function monthBoundaries(): {
  thisMonthStart: Date;
  prevMonthStart: Date;
} {
  const now = new Date();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { thisMonthStart, prevMonthStart };
}

function aggregateIsoBreakdown(
  rows: Array<{ isoStandards: string[]; totalAmount: string | number }>,
): Array<{ standard: string; count: number; value: number }> {
  const map = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const amount = Number(row.totalAmount);
    const standards = row.isoStandards?.length ? row.isoStandards : ["Unspecified"];
    for (const standard of standards) {
      const cur = map.get(standard) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += amount;
      map.set(standard, cur);
    }
  }
  return [...map.entries()]
    .map(([standard, stats]) => ({ standard, ...stats }))
    .sort((a, b) => b.value - a.value);
}

router.get("/proposals/dashboard", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const userFilter = eq(proposalDocumentsTable.userId, userId);
  const { thisMonthStart, prevMonthStart } = monthBoundaries();
  const todayIso = new Date().toISOString().slice(0, 10);
  const expiringCutoff = new Date();
  expiringCutoff.setUTCDate(expiringCutoff.getUTCDate() + 14);
  const expiringCutoffIso = expiringCutoff.toISOString().slice(0, 10);

  const [
    statusRows,
    [totalsRow],
    attentionRows,
    recentRows,
    isoSourceRows,
    expiringRows,
    activityRows,
    [monthlyRow],
  ] = await Promise.all([
    db
      .select({
        status: proposalDocumentsTable.status,
        count: count(),
        value: sql<string>`COALESCE(SUM(${proposalDocumentsTable.totalAmount}::numeric), 0)`,
      })
      .from(proposalDocumentsTable)
      .where(userFilter)
      .groupBy(proposalDocumentsTable.status),
    db
      .select({
        totalCount: count(),
        pipelineCount: sql<number>`COUNT(CASE WHEN ${proposalDocumentsTable.status} IN (${sql.join(
          PIPELINE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )}) THEN 1 END)::int`,
        pipelineValue: sql<string>`COALESCE(SUM(CASE WHEN ${proposalDocumentsTable.status} IN (${sql.join(
          PIPELINE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )}) THEN ${proposalDocumentsTable.totalAmount}::numeric ELSE 0 END), 0)`,
        confirmedValue: sql<string>`COALESCE(SUM(CASE WHEN ${proposalDocumentsTable.status} = 'confirmed' THEN ${proposalDocumentsTable.totalAmount}::numeric ELSE 0 END), 0)`,
        confirmedCount: sql<number>`COUNT(CASE WHEN ${proposalDocumentsTable.status} = 'confirmed' THEN 1 END)::int`,
      })
      .from(proposalDocumentsTable)
      .where(userFilter),
    db
      .select({
        proposal: proposalDocumentsTable,
        clientName: clientsTable.name,
      })
      .from(proposalDocumentsTable)
      .leftJoin(clientsTable, eq(proposalDocumentsTable.clientId, clientsTable.id))
      .where(and(userFilter, inArray(proposalDocumentsTable.status, ATTENTION_STATUSES)))
      .orderBy(desc(proposalDocumentsTable.updatedAt))
      .limit(12),
    db
      .select({
        proposal: proposalDocumentsTable,
        clientName: clientsTable.name,
      })
      .from(proposalDocumentsTable)
      .leftJoin(clientsTable, eq(proposalDocumentsTable.clientId, clientsTable.id))
      .where(and(userFilter, notInArray(proposalDocumentsTable.status, ["superseded", "cancelled"])))
      .orderBy(desc(proposalDocumentsTable.updatedAt))
      .limit(8),
    db
      .select({
        isoStandards: proposalDocumentsTable.isoStandards,
        totalAmount: proposalDocumentsTable.totalAmount,
      })
      .from(proposalDocumentsTable)
      .where(and(userFilter, inArray(proposalDocumentsTable.status, PIPELINE_STATUSES))),
    db
      .select({
        proposal: proposalDocumentsTable,
        clientName: clientsTable.name,
      })
      .from(proposalDocumentsTable)
      .leftJoin(clientsTable, eq(proposalDocumentsTable.clientId, clientsTable.id))
      .where(
        and(
          userFilter,
          inArray(proposalDocumentsTable.status, ["sent", "approved", "draft"]),
          sql`${proposalDocumentsTable.validUntil} IS NOT NULL`,
          sql`${proposalDocumentsTable.validUntil} >= ${todayIso}`,
          sql`${proposalDocumentsTable.validUntil} <= ${expiringCutoffIso}`,
          notInArray(proposalDocumentsTable.status, ["superseded", "cancelled"]),
        ),
      )
      .orderBy(proposalDocumentsTable.validUntil)
      .limit(8),
    db
      .select({
        activity: proposalActivityLogTable,
        proposalId: proposalDocumentsTable.id,
        proposalNo: proposalDocumentsTable.proposalNo,
        clientName: clientsTable.name,
      })
      .from(proposalActivityLogTable)
      .innerJoin(proposalDocumentsTable, eq(proposalActivityLogTable.proposalId, proposalDocumentsTable.id))
      .leftJoin(clientsTable, eq(proposalDocumentsTable.clientId, clientsTable.id))
      .where(userFilter)
      .orderBy(desc(proposalActivityLogTable.createdAt))
      .limit(8),
    db
      .select({
        pipelineCountThisMonth: sql<number>`COUNT(CASE WHEN ${proposalDocumentsTable.createdAt} >= ${thisMonthStart} AND ${proposalDocumentsTable.status} IN (${sql.join(
          PIPELINE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )}) THEN 1 END)::int`,
        pipelineCountPreviousMonth: sql<number>`COUNT(CASE WHEN ${proposalDocumentsTable.createdAt} >= ${prevMonthStart} AND ${proposalDocumentsTable.createdAt} < ${thisMonthStart} AND ${proposalDocumentsTable.status} IN (${sql.join(
          PIPELINE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )}) THEN 1 END)::int`,
        confirmedCountThisMonth: sql<number>`COUNT(CASE WHEN ${proposalDocumentsTable.status} = 'confirmed' AND ${proposalDocumentsTable.updatedAt} >= ${thisMonthStart} THEN 1 END)::int`,
        confirmedCountPreviousMonth: sql<number>`COUNT(CASE WHEN ${proposalDocumentsTable.status} = 'confirmed' AND ${proposalDocumentsTable.updatedAt} >= ${prevMonthStart} AND ${proposalDocumentsTable.updatedAt} < ${thisMonthStart} THEN 1 END)::int`,
        pendingApprovalCount: sql<number>`COUNT(CASE WHEN ${proposalDocumentsTable.status} = 'pending_approval' THEN 1 END)::int`,
        sentCount: sql<number>`COUNT(CASE WHEN ${proposalDocumentsTable.status} = 'sent' THEN 1 END)::int`,
      })
      .from(proposalDocumentsTable)
      .where(userFilter),
  ]);

  const isoBreakdown = aggregateIsoBreakdown(isoSourceRows);

  const attentionReason: Record<string, string> = {
    pending_approval: "Awaiting approval",
    approved: "Ready to send",
    sent: "Awaiting client response",
    revision_requested: "Client requested revision",
    no_response: "Client has not responded",
    expired: "Proposal validity has expired",
  };

  res.json({
    totalCount: Number(totalsRow?.totalCount ?? 0),
    pipelineCount: Number(totalsRow?.pipelineCount ?? 0),
    pipelineValue: Number(totalsRow?.pipelineValue ?? 0),
    confirmedCount: Number(totalsRow?.confirmedCount ?? 0),
    confirmedValue: Number(totalsRow?.confirmedValue ?? 0),
    pendingApprovalCount: Number(monthlyRow?.pendingApprovalCount ?? 0),
    sentCount: Number(monthlyRow?.sentCount ?? 0),
    pipelineCountThisMonth: Number(monthlyRow?.pipelineCountThisMonth ?? 0),
    pipelineCountPreviousMonth: Number(monthlyRow?.pipelineCountPreviousMonth ?? 0),
    confirmedCountThisMonth: Number(monthlyRow?.confirmedCountThisMonth ?? 0),
    confirmedCountPreviousMonth: Number(monthlyRow?.confirmedCountPreviousMonth ?? 0),
    statusBreakdown: statusRows.map((row) => ({
      status: row.status,
      count: Number(row.count),
      value: Number(row.value),
    })),
    isoBreakdown,
    needsAttention: attentionRows.map((row) => ({
      id: row.proposal.id,
      proposalNo: row.proposal.proposalNo,
      clientName: row.clientName ?? undefined,
      status: row.proposal.status,
      totalAmount: Number(row.proposal.totalAmount),
      currency: row.proposal.currency,
      reason: attentionReason[row.proposal.status] ?? "Needs action",
      updatedAt: row.proposal.updatedAt.toISOString(),
    })),
    expiringSoon: expiringRows.map((row) => ({
      id: row.proposal.id,
      proposalNo: row.proposal.proposalNo,
      clientName: row.clientName ?? undefined,
      status: row.proposal.status,
      totalAmount: Number(row.proposal.totalAmount),
      currency: row.proposal.currency,
      validUntil: row.proposal.validUntil ?? undefined,
      updatedAt: row.proposal.updatedAt.toISOString(),
    })),
    recentActivity: activityRows.map((row) => ({
      id: row.activity.id,
      proposalId: row.proposalId,
      proposalNo: row.proposalNo,
      clientName: row.clientName ?? undefined,
      eventType: row.activity.eventType,
      eventData: row.activity.eventData ?? undefined,
      actorType: row.activity.actorType,
      createdAt: row.activity.createdAt.toISOString(),
    })),
    recentProposals: recentRows.map((row) => ({
      id: row.proposal.id,
      proposalNo: row.proposal.proposalNo,
      clientName: row.clientName ?? undefined,
      status: row.proposal.status,
      totalAmount: Number(row.proposal.totalAmount),
      currency: row.proposal.currency,
      updatedAt: row.proposal.updatedAt.toISOString(),
    })),
  });
});

router.get("/proposals/setup-templates", async (_req, res) => {
  const settings = await getCompanySettings();
  res.json(mergeProposalSetupTemplates(settings?.proposalSetupTemplates ?? null));
});

router.patch("/proposals/setup-templates", requireAdmin, async (req, res) => {
  const patch = ProposalSetupTemplatesPatchSchema.parse(req.body ?? {});
  const settings = await getCompanySettings();
  if (!settings) {
    res.status(500).json({ error: "Company settings not initialized" });
    return;
  }
  const mergedStored = {
    ...(settings.proposalSetupTemplates ?? {}),
    ...patch,
  };
  await db
    .update(companySettingsTable)
    .set({ proposalSetupTemplates: mergedStored, updatedAt: new Date() })
    .where(eq(companySettingsTable.id, settings.id));
  invalidateCompanySettingsCache();
  res.json(mergeProposalSetupTemplates(mergedStored));
});

export default router;
