import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  clientsTable,
  db,
  proposalDocumentsTable,
  type ProposalConsultantPortfolioItem,
  type ProposalJobReference,
  type ProposalPhase,
  type ProposalPaymentScheduleItem,
  type ProposalStatus,
  type ProposalTemplateData,
  type ProposalTestimonial,
} from "@workspace/db";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { assertClientOwnedByUser } from "../../lib/clientOwnership";
import {
  assertConsultantIdsExist,
  ConsultantIdsInvalidError,
  loadConsultantIds,
  loadConsultantIdsByParent,
  PROPOSAL_CONSULTANTS,
  replaceConsultantIds,
} from "../../lib/consultantLinks";
import { DEFAULT_PAYMENT_SCHEDULE, DEFAULT_SCOPE_PHASES, DEFAULT_TERMS } from "../../lib/proposalDefaults";
import { validateProposalContentFields, stripNulls, formatZodError } from "../../lib/proposalValidation";
import { isUniqueViolation } from "../../lib/pgErrors";
import { loadProposalOwned, PaymentScheduleSchema, proposalDto, ProposalPhaseSchema } from "./helpers";

const router: IRouter = Router();

const CertificationLocationSchema = z.object({
  address: z.string(),
  staffCount: z.number().int().min(0),
});

const ConsultantPortfolioSchema = z.object({
  consultantId: z.string().uuid(),
  photoUrl: z.string().optional().nullable(),
  bio: z.string().optional(),
});

const JobReferenceSchema = z.object({
  clientName: z.string().min(1),
  projectTitle: z.string().min(1),
  description: z.string().optional(),
  photoUrl: z.string().optional().nullable(),
});

const TestimonialSchema = z.object({
  quote: z.string().min(1),
  authorName: z.string().min(1),
  authorTitle: z.string().optional(),
  companyName: z.string().optional(),
  photoUrl: z.string().optional().nullable(),
});

const TemplateDataSchema = z.object({
  proposalTitle: z.string().optional(),
  salesContact: z
    .object({
      name: z.string().optional(),
      title: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  certificationBody: z
    .object({
      enabled: z.boolean().optional(),
      name: z.string().optional(),
      shortName: z.string().optional(),
      logoUrl: z.string().optional().nullable(),
      description: z.string().optional(),
      accreditationName: z.string().optional(),
      accreditationDescription: z.string().optional(),
    })
    .optional(),
  optionalMaintenance: z
    .object({
      enabled: z.boolean().optional(),
      supportHours: z.string().optional(),
    })
    .optional(),
  feeRows: z
    .array(
      z.object({
        year: z.string(),
        consultancyFee: z.number().optional(),
        certificationFee: z.number().optional(),
      }),
    )
    .optional(),
  terms: z
    .object({
      commencementDays: z.number().int().optional(),
      invoiceDueDays: z.number().int().optional(),
      claimsCap: z.string().optional(),
      certificationGuaranteeEnabled: z.boolean().optional(),
    })
    .optional(),
  auditType: z.string().optional(),
});

const ProposalBodySchema = z.object({
  clientId: z.string().uuid(),
  proposalNo: z.string().min(1).optional(),
  proposalRevision: z.number().int().min(0).optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  coverPhotoUrl: z.string().optional().nullable(),
  firmIntro: z.string().optional(),
  certificationBodyIntro: z.string().optional(),
  clientStaffCount: z.number().int().positive().optional().nullable(),
  isoStandards: z.array(z.string()).optional(),
  proposalScope: z.string().optional(),
  certificationLocations: z.array(CertificationLocationSchema).optional(),
  templateData: TemplateDataSchema.optional(),
  scopePhases: z.array(ProposalPhaseSchema).optional(),
  pmToolsIntro: z.string().optional(),
  trainingPlatformIntro: z.string().optional(),
  termsConditions: z.string().optional(),
  consultantIds: z.array(z.string().uuid()).optional(),
  consultantPortfolio: z.array(ConsultantPortfolioSchema).optional(),
  jobReferences: z.array(JobReferenceSchema).optional(),
  testimonials: z.array(TestimonialSchema).optional(),
  currency: z.enum(["HKD", "USD", "CNY", "MOP"]).optional(),
  totalAmount: z.number().min(0).optional(),
  paymentSchedule: z.array(PaymentScheduleSchema).optional(),
});

/**
 * Allocates the next `P-YYYYMM-NNN` number from the highest existing sequence
 * for the current month. A plain row count was used before, which re-issued
 * numbers after a proposal was deleted and crashed on the
 * (user_id, proposal_no, proposal_revision) unique constraint.
 */
async function nextProposalNo(userId: string): Promise<string> {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const pattern = `^P-${stamp}-([0-9]+)$`;
  const [row] = await db
    .select({
      maxSeq: sql<number | null>`max((substring(${proposalDocumentsTable.proposalNo} from ${pattern}))::int)`,
    })
    .from(proposalDocumentsTable)
    .where(eq(proposalDocumentsTable.userId, userId));
  const n = Number(row?.maxSeq ?? 0) + 1;
  return `P-${stamp}-${String(n).padStart(3, "0")}`;
}

router.get("/proposals", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const query = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      q: z.string().optional(),
      status: z.string().optional(),
      clientId: z.string().uuid().optional(),
    })
    .parse(req.query);

  const conditions = [eq(proposalDocumentsTable.userId, userId)];
  if (query.status) conditions.push(eq(proposalDocumentsTable.status, query.status as ProposalStatus));
  if (query.clientId) conditions.push(eq(proposalDocumentsTable.clientId, query.clientId));
  const search = query.q?.trim();
  const where = search
    ? and(
        ...conditions,
        or(
          ilike(proposalDocumentsTable.proposalNo, `%${search}%`),
          ilike(clientsTable.name, `%${search}%`),
        ),
      )
    : and(...conditions);

  const offset = (query.page - 1) * query.pageSize;
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({ proposal: proposalDocumentsTable, clientName: clientsTable.name })
      .from(proposalDocumentsTable)
      .leftJoin(clientsTable, eq(proposalDocumentsTable.clientId, clientsTable.id))
      .where(where)
      .orderBy(desc(proposalDocumentsTable.updatedAt))
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ c: count() })
      .from(proposalDocumentsTable)
      .leftJoin(clientsTable, eq(proposalDocumentsTable.clientId, clientsTable.id))
      .where(where),
  ]);

  const consultantIdsByProposal = await loadConsultantIdsByParent(
    db,
    PROPOSAL_CONSULTANTS,
    rows.map((r) => r.proposal.id),
  );
  res.json({
    data: rows.map((r) =>
      proposalDto(r.proposal, consultantIdsByProposal.get(r.proposal.id) ?? [], r.clientName ?? undefined),
    ),
    total: Number(totalRow?.c ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  });
});

router.post("/proposals", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const parsed = ProposalBodySchema.safeParse(stripNulls(req.body ?? {}));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message);
    res.status(400).json({ error: formatZodError(parsed.error), issues });
    return;
  }
  const body = parsed.data;

  const clientCheck = await assertClientOwnedByUser(userId, body.clientId);
  if (!clientCheck.ok) {
    res.status(clientCheck.status).json({ error: clientCheck.error });
    return;
  }

  const scopePhases = (body.scopePhases as ProposalPhase[]) ?? DEFAULT_SCOPE_PHASES;
  const paymentSchedule = (body.paymentSchedule as ProposalPaymentScheduleItem[]) ?? DEFAULT_PAYMENT_SCHEDULE;
  const contentIssues = validateProposalContentFields({
    totalAmount: body.totalAmount ?? 0,
    scopePhases,
    paymentSchedule,
    requireAmount: true,
    requirePhases: true,
    requirePayment: true,
  });
  if (contentIssues.length > 0) {
    res.status(400).json({ error: contentIssues[0], issues: contentIssues });
    return;
  }

  const consultantIds = body.consultantIds ?? [];
  try {
    await assertConsultantIdsExist(consultantIds);
  } catch (e) {
    if (e instanceof ConsultantIdsInvalidError) {
      res.status(400).json({ error: "One or more consultants were not found." });
      return;
    }
    throw e;
  }

  const customProposalNo = body.proposalNo?.trim() || undefined;
  const proposalRevision = body.proposalRevision ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const validUntil = body.validUntil || new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

  const insertProposal = (proposalNo: string) =>
    db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(proposalDocumentsTable)
        .values({
          userId,
          clientId: body.clientId,
          proposalNo,
          proposalRevision,
          validFrom: body.validFrom ?? today,
          validUntil,
          coverPhotoUrl: body.coverPhotoUrl ?? null,
          firmIntro: body.firmIntro ?? null,
          certificationBodyIntro: body.certificationBodyIntro ?? null,
          clientStaffCount: body.clientStaffCount ?? null,
          isoStandards: body.isoStandards ?? [],
          proposalScope: body.proposalScope ?? null,
          certificationLocations: body.certificationLocations ?? [],
          templateData: (body.templateData ?? {}) as ProposalTemplateData,
          scopePhases,
          pmToolsIntro: body.pmToolsIntro ?? null,
          trainingPlatformIntro: body.trainingPlatformIntro ?? null,
          termsConditions: body.termsConditions ?? null,
          consultantPortfolio: (body.consultantPortfolio as ProposalConsultantPortfolioItem[]) ?? [],
          jobReferences: (body.jobReferences as ProposalJobReference[]) ?? [],
          testimonials: (body.testimonials as ProposalTestimonial[]) ?? [],
          currency: body.currency ?? "HKD",
          totalAmount: String(body.totalAmount ?? 0),
          paymentSchedule,
        })
        .returning();
      await replaceConsultantIds(tx, PROPOSAL_CONSULTANTS, inserted.id, consultantIds);
      return [inserted];
    });

  // Auto-generated numbers can collide with a concurrent create, so retry
  // with a freshly allocated number. A caller-supplied number is reported
  // back as a conflict instead.
  let row: typeof proposalDocumentsTable.$inferSelect | undefined;
  const maxAttempts = customProposalNo ? 1 : 3;
  for (let attempt = 0; attempt < maxAttempts && !row; attempt++) {
    const proposalNo = customProposalNo ?? (await nextProposalNo(userId));
    try {
      [row] = await insertProposal(proposalNo);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (customProposalNo) {
        res.status(409).json({
          error: `Proposal number ${customProposalNo} (revision ${proposalRevision}) already exists. Choose a different number.`,
        });
        return;
      }
    }
  }
  if (!row) {
    res.status(409).json({ error: "Could not allocate a unique proposal number. Please try again." });
    return;
  }

  const client = await db.select().from(clientsTable).where(eq(clientsTable.id, body.clientId));
  res.status(201).json(proposalDto(row, consultantIds, client[0]?.name));
});

router.get("/proposals/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const row = await loadProposalOwned(userId, id);
  if (!row) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  res.json(proposalDto(row.proposal, row.consultantIds, row.client?.name));
});

router.patch("/proposals/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const parsed = ProposalBodySchema.partial().safeParse(stripNulls(req.body ?? {}));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message);
    res.status(400).json({ error: formatZodError(parsed.error), issues });
    return;
  }
  const body = parsed.data;
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (!["draft", "revision_requested"].includes(existing.proposal.status)) {
    res.status(400).json({ error: "Only draft or revision-requested proposals can be edited." });
    return;
  }
  if (body.clientId) {
    const clientCheck = await assertClientOwnedByUser(userId, body.clientId);
    if (!clientCheck.ok) {
      res.status(clientCheck.status).json({ error: clientCheck.error });
      return;
    }
  }

  const mergedScopePhases =
    body.scopePhases !== undefined
      ? (body.scopePhases as ProposalPhase[])
      : ((existing.proposal.scopePhases ?? []) as ProposalPhase[]);
  const mergedPaymentSchedule =
    body.paymentSchedule !== undefined
      ? (body.paymentSchedule as ProposalPaymentScheduleItem[])
      : ((existing.proposal.paymentSchedule ?? []) as ProposalPaymentScheduleItem[]);
  const mergedTotalAmount =
    body.totalAmount !== undefined ? body.totalAmount : Number(existing.proposal.totalAmount);

  const contentIssues = validateProposalContentFields({
    totalAmount: body.totalAmount !== undefined ? mergedTotalAmount : undefined,
    scopePhases: body.scopePhases !== undefined ? mergedScopePhases : undefined,
    paymentSchedule: body.paymentSchedule !== undefined ? mergedPaymentSchedule : undefined,
    requireAmount: body.totalAmount !== undefined,
    requirePhases: body.scopePhases !== undefined,
    requirePayment: body.paymentSchedule !== undefined,
  });
  if (contentIssues.length > 0) {
    res.status(400).json({ error: contentIssues[0], issues: contentIssues });
    return;
  }

  try {
    if (body.consultantIds !== undefined) await assertConsultantIdsExist(body.consultantIds);
  } catch (e) {
    if (e instanceof ConsultantIdsInvalidError) {
      res.status(400).json({ error: "One or more consultants were not found." });
      return;
    }
    throw e;
  }

  const patch: Partial<typeof proposalDocumentsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.clientId !== undefined) patch.clientId = body.clientId;
  if (body.validFrom !== undefined) patch.validFrom = body.validFrom;
  if (body.validUntil !== undefined) patch.validUntil = body.validUntil;
  if (body.coverPhotoUrl !== undefined) patch.coverPhotoUrl = body.coverPhotoUrl;
  if (body.firmIntro !== undefined) patch.firmIntro = body.firmIntro;
  if (body.certificationBodyIntro !== undefined) patch.certificationBodyIntro = body.certificationBodyIntro;
  if (body.clientStaffCount !== undefined) patch.clientStaffCount = body.clientStaffCount;
  if (body.isoStandards !== undefined) patch.isoStandards = body.isoStandards;
  if (body.proposalScope !== undefined) patch.proposalScope = body.proposalScope;
  if (body.certificationLocations !== undefined) patch.certificationLocations = body.certificationLocations;
  if (body.templateData !== undefined) patch.templateData = body.templateData as ProposalTemplateData;
  if (body.scopePhases !== undefined) patch.scopePhases = body.scopePhases as ProposalPhase[];
  if (body.pmToolsIntro !== undefined) patch.pmToolsIntro = body.pmToolsIntro;
  if (body.trainingPlatformIntro !== undefined) patch.trainingPlatformIntro = body.trainingPlatformIntro;
  if (body.termsConditions !== undefined) patch.termsConditions = body.termsConditions;
  if (body.consultantPortfolio !== undefined) patch.consultantPortfolio = body.consultantPortfolio as ProposalConsultantPortfolioItem[];
  if (body.jobReferences !== undefined) patch.jobReferences = body.jobReferences as ProposalJobReference[];
  if (body.testimonials !== undefined) patch.testimonials = body.testimonials as ProposalTestimonial[];
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.totalAmount !== undefined) patch.totalAmount = String(body.totalAmount);
  if (body.paymentSchedule !== undefined) patch.paymentSchedule = body.paymentSchedule as ProposalPaymentScheduleItem[];
  if (existing.proposal.status === "revision_requested") patch.status = "draft";

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(proposalDocumentsTable)
      .set(patch)
      .where(and(eq(proposalDocumentsTable.id, id), eq(proposalDocumentsTable.userId, userId)))
      .returning();
    if (updated && body.consultantIds !== undefined) {
      await replaceConsultantIds(tx, PROPOSAL_CONSULTANTS, id, body.consultantIds);
    }
    return updated;
  });
  const consultantIds =
    body.consultantIds !== undefined
      ? await loadConsultantIds(db, PROPOSAL_CONSULTANTS, id)
      : existing.consultantIds;
  res.json(proposalDto(row, consultantIds, existing.client?.name));
});

router.delete("/proposals/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (existing.proposal.status === "confirmed") {
    res.status(400).json({ error: "Cannot delete a confirmed proposal." });
    return;
  }
  await db.delete(proposalDocumentsTable).where(and(eq(proposalDocumentsTable.id, id), eq(proposalDocumentsTable.userId, userId)));
  res.status(204).send();
});

export default router;
