import { randomUUID } from "crypto";
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, proposalDocumentsTable, type GmailAccount } from "@workspace/db";
import { actorUserId, scopedDataUserId } from "../../lib/auth/scopedUserId";
import { PROPOSAL_CONSULTANTS, replaceConsultantIds } from "../../lib/consultantLinks";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { streamProposalPdf, streamProposalPdfToBuffer } from "../../lib/proposalPdfDraw";
import {
  formatAmount,
  formatDate,
  processTemplate,
  resolveSender,
  sendEmail,
  type SenderSlot,
} from "../../lib/emailHelpers";
import { loadConsultants, loadProposalOwned, logActivity, proposalDto, toNumber } from "./helpers";

const DEFAULT_PROPOSAL_EMAIL = {
  subject: "Proposal {{proposal_number}} from {{company_name}}",
  body: "Dear {{contact_person}},\n\nPlease review our proposal {{proposal_number}} (Revision {{proposal_revision}}) using the link below:\n\n{{proposal_link}}\n\nConsultancy fee: {{amount}}\nValid until: {{valid_until}}\n\nA PDF copy is attached for your records.\n\nThanks,\n{{company_name}}",
};

const EmailBodySchema = z.object({
  to: z.string().email().optional(),
  slot: z.coerce.number().int().min(1).max(2).optional(),
  cc: z.string().email().optional(),
  bcc: z.string().email().optional(),
  contactPersonOverride: z.string().max(500).optional(),
});

function publicAppBase(req: Request): string {
  return (
    process.env["PUBLIC_APP_URL"]?.replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host") ?? "localhost"}`.replace(/\/$/, "")
  );
}

function proposalPreviewUrl(req: Request, proposalId: string, token: string): string {
  return `${publicAppBase(req)}/proposals/${proposalId}/preview?token=${encodeURIComponent(token)}`;
}

async function issueShareTokenIfNeeded(
  proposal: typeof proposalDocumentsTable.$inferSelect,
): Promise<{ token: string; expiresAt: Date }> {
  const token = proposal.shareToken ?? randomUUID();
  const expiresAt = proposal.validUntil
    ? new Date(`${proposal.validUntil}T23:59:59.999Z`)
    : new Date(Date.now() + 180 * 86400000);
  return { token, expiresAt };
}

const router: IRouter = Router();

router.post("/proposals/:id/submit", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing || existing.proposal.status !== "draft") {
    res.status(400).json({ error: "Only draft proposals can be submitted." });
    return;
  }
  const now = new Date();
  const [row] = await db
    .update(proposalDocumentsTable)
    .set({ status: "pending_approval", submittedAt: now, updatedAt: now })
    .where(eq(proposalDocumentsTable.id, id))
    .returning();
  await logActivity(id, userId, "submitted", { actorType: "staff", req });
  res.json(proposalDto(row, existing.consultantIds, existing.client?.name));
});

router.post("/proposals/:id/approve", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing || existing.proposal.status !== "pending_approval") {
    res.status(400).json({ error: "Only pending proposals can be approved." });
    return;
  }
  const now = new Date();
  const [row] = await db
    .update(proposalDocumentsTable)
    .set({ status: "approved", approvedAt: now, updatedAt: now })
    .where(eq(proposalDocumentsTable.id, id))
    .returning();
  await logActivity(id, userId, "approved", { actorType: "staff", req });
  res.json(proposalDto(row, existing.consultantIds, existing.client?.name));
});

router.post("/proposals/:id/reject", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({ reason: z.string().max(4000).optional() }).parse(req.body ?? {});
  const existing = await loadProposalOwned(userId, id);
  if (!existing || existing.proposal.status !== "pending_approval") {
    res.status(400).json({ error: "Only pending proposals can be rejected." });
    return;
  }
  const now = new Date();
  const [row] = await db
    .update(proposalDocumentsTable)
    .set({ status: "draft", updatedAt: now })
    .where(eq(proposalDocumentsTable.id, id))
    .returning();
  await logActivity(id, userId, "rejected", {
    actorType: "staff",
    req,
    eventData: { reason: body.reason?.trim() || undefined },
  });
  res.json(proposalDto(row, existing.consultantIds, existing.client?.name));
});

router.post("/proposals/:id/cancel", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({ reason: z.string().max(4000).optional() }).parse(req.body ?? {});
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const cancellable = ["draft", "pending_approval", "approved", "sent", "revision_requested", "no_response"];
  if (!cancellable.includes(existing.proposal.status)) {
    res.status(400).json({ error: "This proposal cannot be cancelled in its current status." });
    return;
  }
  const now = new Date();
  const [row] = await db
    .update(proposalDocumentsTable)
    .set({
      status: "cancelled",
      shareToken: null,
      shareTokenExpiresAt: null,
      updatedAt: now,
    })
    .where(eq(proposalDocumentsTable.id, id))
    .returning();
  await logActivity(id, userId, "cancelled", {
    actorType: "staff",
    req,
    eventData: { reason: body.reason?.trim() || undefined },
  });
  res.json(proposalDto(row, existing.consultantIds, existing.client?.name));
});

router.post("/proposals/:id/send", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing || existing.proposal.status !== "approved") {
    res.status(400).json({ error: "Only approved proposals can be sent." });
    return;
  }
  const token = existing.proposal.shareToken ?? randomUUID();
  const expiresAt = existing.proposal.validUntil
    ? new Date(`${existing.proposal.validUntil}T23:59:59.999Z`)
    : new Date(Date.now() + 180 * 86400000);
  const now = new Date();
  const [row] = await db
    .update(proposalDocumentsTable)
    .set({
      status: "sent",
      shareToken: token,
      shareTokenExpiresAt: expiresAt,
      sentAt: now,
      updatedAt: now,
    })
    .where(eq(proposalDocumentsTable.id, id))
    .returning();
  await logActivity(id, userId, "sent", { actorType: "staff", req });
  res.json(proposalDto(row, existing.consultantIds, existing.client?.name));
});

router.post("/proposals/:id/share-link", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const token = existing.proposal.shareToken ?? randomUUID();
  const expiresAt = existing.proposal.validUntil
    ? new Date(`${existing.proposal.validUntil}T23:59:59.999Z`)
    : new Date(Date.now() + 180 * 86400000);
  const [row] = await db
    .update(proposalDocumentsTable)
    .set({ shareToken: token, shareTokenExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(proposalDocumentsTable.id, id))
    .returning();
  res.json({ shareToken: row.shareToken, shareTokenExpiresAt: row.shareTokenExpiresAt?.toISOString() });
});

router.delete("/proposals/:id/share-token", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  await db
    .update(proposalDocumentsTable)
    .set({ shareToken: null, shareTokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(proposalDocumentsTable.id, id));
  res.status(204).send();
});

router.post("/proposals/:id/email", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = EmailBodySchema.parse(req.body ?? {});
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  if (!["approved", "sent"].includes(existing.proposal.status)) {
    res.status(400).json({ error: "Only approved or sent proposals can be emailed." });
    return;
  }

  const { proposal, client } = existing;
  const to = body.to?.trim() || client?.email;
  if (!to) {
    res.status(400).json({ error: "No recipient email — provide 'to' or set client email" });
    return;
  }

  const settings = await getCompanySettings();
  const g1 = settings?.gmailAccount1 as GmailAccount | null;
  const g2 = settings?.gmailAccount2 as GmailAccount | null;
  const sender = resolveSender(g1, g2, (body.slot as SenderSlot) ?? 1);
  if (!sender) {
    res.status(400).json({
      error: "Gmail not connected — use Admin → Email → Email sending (Gmail API) to connect a mailbox.",
    });
    return;
  }

  const { token, expiresAt } = await issueShareTokenIfNeeded(proposal);
  const now = new Date();
  const [updated] = await db
    .update(proposalDocumentsTable)
    .set({
      status: "sent",
      shareToken: token,
      shareTokenExpiresAt: expiresAt,
      sentAt: proposal.sentAt ?? now,
      updatedAt: now,
    })
    .where(eq(proposalDocumentsTable.id, id))
    .returning();

  const companyName = settings?.companyName || "Gabriel Consultant Limited";
  const contactPerson =
    body.contactPersonOverride?.trim() || client?.contactPerson || client?.name || "";
  const link = proposalPreviewUrl(req, id, token);
  const storedTemplates = settings?.emailTemplates;
  const proposalTemplate =
    storedTemplates &&
    typeof storedTemplates === "object" &&
    storedTemplates.proposal?.subject?.trim() &&
    storedTemplates.proposal?.body?.trim()
      ? storedTemplates.proposal
      : DEFAULT_PROPOSAL_EMAIL;

  const processed = processTemplate(proposalTemplate, {
    contact_person: contactPerson,
    proposal_number: updated.proposalNo,
    proposal_revision: String(updated.proposalRevision),
    proposal_link: link,
    valid_until: updated.validUntil ? formatDate(updated.validUntil) : "",
    amount: formatAmount(updated.currency, toNumber(updated.totalAmount)),
    company_name: companyName,
    client_name: client?.name || "",
  });

  try {
    const consultants = await loadConsultants(existing.consultantIds);
    const { buffer, filename } = await streamProposalPdfToBuffer(updated, client, settings, consultants);
    await sendEmail({
      sender,
      fromName: companyName,
      to,
      cc: body.cc?.trim() || undefined,
      bcc: body.bcc?.trim() || undefined,
      subject: processed.subject,
      htmlBody: processed.body,
      attachments: [{ filename, mimeType: "application/pdf", content: buffer }],
    });
    await logActivity(id, userId, "sent", { actorType: "staff", req, eventData: { emailed: to } });
    res.json({ ok: true, message: `Proposal sent to ${to}`, shareToken: token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to send email: ${msg}` });
  }
});

router.post("/proposals/:id/no-response", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing || existing.proposal.status !== "sent") {
    res.status(400).json({ error: "Only sent proposals can be marked as no response." });
    return;
  }
  const [row] = await db
    .update(proposalDocumentsTable)
    .set({ status: "no_response", updatedAt: new Date() })
    .where(eq(proposalDocumentsTable.id, id))
    .returning();
  await logActivity(id, userId, "no_response", { actorType: "staff", req });
  res.json(proposalDto(row, existing.consultantIds, existing.client?.name));
});

router.post("/proposals/:id/new-revision", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing || !["revision_requested", "sent", "no_response"].includes(existing.proposal.status)) {
    res.status(400).json({ error: "Cannot create revision from current status." });
    return;
  }
  const p = existing.proposal;
  // Next revision = max existing revision + 1 for this proposal number, so a
  // double-submit or an already-present higher revision cannot collide with
  // the (user_id, proposal_no, proposal_revision) unique constraint.
  const [revRow] = await db
    .select({ maxRev: sql<number | null>`max(${proposalDocumentsTable.proposalRevision})` })
    .from(proposalDocumentsTable)
    .where(and(eq(proposalDocumentsTable.userId, userId), eq(proposalDocumentsTable.proposalNo, p.proposalNo)));
  const nextRevision = Number(revRow?.maxRev ?? p.proposalRevision) + 1;
  const newRow = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(proposalDocumentsTable)
      .values({
        userId,
        createdByUserId: actorUserId(req),
        clientId: p.clientId,
        proposalNo: p.proposalNo,
        proposalRevision: nextRevision,
        status: "draft",
        validFrom: p.validFrom,
        validUntil: p.validUntil,
        coverPhotoUrl: p.coverPhotoUrl,
        firmIntro: p.firmIntro,
        certificationBodyIntro: p.certificationBodyIntro,
        clientStaffCount: p.clientStaffCount,
        isoStandards: p.isoStandards,
        proposalScope: p.proposalScope,
        certificationLocations: p.certificationLocations,
        templateData: p.templateData,
        scopePhases: p.scopePhases,
        pmToolsIntro: p.pmToolsIntro,
        trainingPlatformIntro: p.trainingPlatformIntro,
        termsConditions: p.termsConditions,
        consultantPortfolio: p.consultantPortfolio,
        jobReferences: p.jobReferences,
        testimonials: p.testimonials,
        currency: p.currency,
        totalAmount: p.totalAmount,
        paymentSchedule: p.paymentSchedule,
      })
      .returning();
    // Link the new revision to the same consultants as the proposal it
    // supersedes (existing.consultantIds was already loaded for `p`/`existing.proposal`).
    await replaceConsultantIds(tx, PROPOSAL_CONSULTANTS, inserted.id, existing.consultantIds);
    await tx
      .update(proposalDocumentsTable)
      .set({ status: "superseded", supersededById: inserted.id, updatedAt: new Date() })
      .where(eq(proposalDocumentsTable.id, p.id));
    return inserted;
  });
  res.status(201).json(proposalDto(newRow, existing.consultantIds, existing.client?.name));
});

router.get("/proposals/:id/pdf", async (req, res) => {
  const userId = scopedDataUserId(req);
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const row = await loadProposalOwned(userId, id);
  if (!row) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  try {
    const settings = await getCompanySettings({ fresh: true });
    const consultants = await loadConsultants(row.consultantIds);
    await streamProposalPdf(row.proposal, row.client, settings, consultants, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to generate PDF: ${msg}` });
  }
});

export default router;
