import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  db,
  jobOrdersTable,
  proposalDocumentsTable,
  type ProposalPaymentScheduleItem,
  type ProposalPhase,
} from "@workspace/db";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { currentDataMode, type DataMode } from "../../lib/dataMode";
import { JOB_ORDER_CONSULTANTS, replaceConsultantIds } from "../../lib/consultantLinks";
import { JOB_ORDER_ITEMS, replaceLineItems } from "../../lib/lineItems";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { withUniqueRetry } from "../../lib/withUniqueRetry";
import {
  autoBillFirstMilestoneIfNeeded,
  createAllUnbilledMilestoneInvoices,
  createProposalMilestoneInvoice,
} from "../../lib/proposalMilestoneBilling";
import {
  fieldsFromProposalDocument,
  finalizeExtraction,
} from "../../lib/proposalExtraction";
import { buildTemplateVarMap } from "../../lib/proposalTemplateVars";
import { loadProposalOwned, logActivity, proposalDto, toNumber } from "./helpers";

const router: IRouter = Router();

function extractionFromOwnedProposal(
  proposal: typeof proposalDocumentsTable.$inferSelect,
  client: NonNullable<Awaited<ReturnType<typeof loadProposalOwned>>>["client"],
  settings: Awaited<ReturnType<typeof getCompanySettings>>,
) {
  const vars = buildTemplateVarMap({ proposal, client, settings: settings ?? undefined });
  return finalizeExtraction(
    fieldsFromProposalDocument({
      client,
      isoStandards: (proposal.isoStandards as string[]) ?? [],
      proposalScope: proposal.proposalScope,
      scopePhases: (proposal.scopePhases as ProposalPhase[]) ?? [],
      paymentSchedule: (proposal.paymentSchedule as ProposalPaymentScheduleItem[]) ?? [],
      vars,
    }),
  );
}

async function nextJobOrderNumber(userId: string, executor: Pick<typeof db, "select"> = db, dataMode?: DataMode) {
  const mode = dataMode ?? (await currentDataMode());
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rows = await executor
    .select({ id: jobOrdersTable.id })
    .from(jobOrdersTable)
    .where(and(eq(jobOrdersTable.userId, userId), eq(jobOrdersTable.dataMode, mode)));
  return `JO${stamp}${String(rows.length + 1).padStart(3, "0")}`;
}

router.post("/proposals/:id/job-order", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({ consultantIds: z.array(z.string().uuid()).max(3).optional() }).parse(req.body ?? {});
  const existing = await loadProposalOwned(userId, id);
  if (!existing || existing.proposal.status !== "confirmed") {
    res.status(400).json({ error: "Job order can only be created from confirmed proposals." });
    return;
  }
  if (existing.proposal.jobOrderId) {
    res.status(400).json({ error: "Job order already exists for this proposal.", jobOrderId: existing.proposal.jobOrderId });
    return;
  }
  const p = existing.proposal;
  const settings = await getCompanySettings();
  const extracted = extractionFromOwnedProposal(p, existing.client, settings);
  const notes = [
    `Created from proposal ${p.proposalNo} Rev.${p.proposalRevision}`,
    extracted.notes,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Insert + proposal.jobOrderId update run in one retried transaction: a
  // crash between the two would otherwise leave a job order that the proposal
  // doesn't know about (inviting a duplicate on retry), and the job-order
  // number is retried on a rare cross-request numbering race.
  const jobOrderConsultantIds = body.consultantIds ?? existing.consultantIds;
  const dataMode = await currentDataMode();
  const jo = await withUniqueRetry(() =>
    db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(jobOrdersTable)
        .values({
          userId,
          dataMode,
          clientId: p.clientId,
          jobOrderNumber: await nextJobOrderNumber(userId, tx, dataMode),
          jobDate: new Date().toISOString().slice(0, 10),
          status: "draft",
          sourceType: "proposal",
          sourceId: p.id,
          notes,
        })
        .returning();

      await replaceConsultantIds(tx, JOB_ORDER_CONSULTANTS, inserted.id, jobOrderConsultantIds);
      await replaceLineItems(tx, JOB_ORDER_ITEMS, inserted.id, [
        {
          name: extracted.lineItem.name,
          description:
            extracted.lineItem.description || p.proposalScope || "Consulting services per proposal",
          details: extracted.lineItem.details || undefined,
          quantity: 1,
          price: toNumber(p.totalAmount),
        },
      ]);

      await tx
        .update(proposalDocumentsTable)
        .set({ jobOrderId: inserted.id, updatedAt: new Date() })
        .where(eq(proposalDocumentsTable.id, p.id));

      return inserted;
    }),
  );

  const autoInvoice = await autoBillFirstMilestoneIfNeeded(userId, p);
  if (autoInvoice) {
    await logActivity(p.id, userId, "milestone_invoiced", {
      actorType: "staff",
      req,
      eventData: {
        auto: true,
        scheduleIndex: autoInvoice.scheduleIndex,
        invoiceId: autoInvoice.invoiceId,
        invoiceNumber: autoInvoice.invoiceNumber,
      },
    });
  }

  res.status(201).json({
    id: jo.id,
    jobOrderNumber: jo.jobOrderNumber,
    clientId: jo.clientId,
    status: jo.status,
    milestoneInvoice: autoInvoice ?? undefined,
  });
});

router.post("/proposals/:id/milestones/:index/invoice", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id, index } = z
    .object({ id: z.string().uuid(), index: z.coerce.number().int().min(0) })
    .parse({ ...req.params, index: req.params.index });
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const result = await createProposalMilestoneInvoice(userId, existing.proposal, index);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  await logActivity(id, userId, "milestone_invoiced", {
    actorType: "staff",
    req,
    eventData: {
      scheduleIndex: result.scheduleIndex,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
    },
  });
  const [updated] = await db
    .select()
    .from(proposalDocumentsTable)
    .where(eq(proposalDocumentsTable.id, id));
  res.status(201).json({
    invoice: result,
    proposal: proposalDto(updated ?? existing.proposal, existing.consultantIds, existing.client?.name),
  });
});

router.post("/proposals/:id/milestones/invoice-all", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const { created, errors } = await createAllUnbilledMilestoneInvoices(userId, existing.proposal);
  if (!created.length && errors.length) {
    res.status(400).json({ error: errors[0], errors });
    return;
  }
  const [updated] = await db
    .select()
    .from(proposalDocumentsTable)
    .where(eq(proposalDocumentsTable.id, id));
  res.status(201).json({
    created,
    errors,
    proposal: proposalDto(updated ?? existing.proposal, existing.consultantIds, existing.client?.name),
  });
});

router.post("/proposals/:id/extract-for-job-order", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const settings = await getCompanySettings();
  const { proposal, client } = existing;
  const extracted = extractionFromOwnedProposal(proposal, client, settings);
  const textPreview = [
    extracted.fields.contactPerson,
    extracted.fields.contactEmail,
    extracted.fields.contactPhone,
    extracted.fields.isoStandards.join(", "),
    extracted.fields.proposedScopeOfCertification,
    extracted.notes,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
  res.json({
    fields: extracted.fields,
    notes: extracted.notes,
    lineItem: extracted.lineItem,
    textPreview,
    source: "proposal_document",
    proposalId: proposal.id,
  });
});

export default router;
