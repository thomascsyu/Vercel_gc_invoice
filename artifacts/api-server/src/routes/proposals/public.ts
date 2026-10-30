import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { clientsTable, db, proposalDocumentsTable, proposalQuestionsTable } from "@workspace/db";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { loadConsultantIds, PROPOSAL_CONSULTANTS } from "../../lib/consultantLinks";
import { streamProposalPdf, streamProposalPdfToBuffer } from "../../lib/proposalPdfDraw";
import { escapeHtml, notifyStaffProposalEvent } from "../../lib/proposalNotifications";
import { loadConsultants, logActivity } from "./helpers";
import { timingSafeEqualString } from "../../lib/timingSafeEqualString";
import { publicRateLimitGate } from "../../lib/rateLimit";
import { logger } from "../../lib/logger";

async function loadProposalByToken(id: string, token: string) {
  const [row] = await db
    .select({ proposal: proposalDocumentsTable, client: clientsTable })
    .from(proposalDocumentsTable)
    .leftJoin(clientsTable, eq(proposalDocumentsTable.clientId, clientsTable.id))
    .where(eq(proposalDocumentsTable.id, id));
  if (!row) return { error: "unavailable" as const };
  const { shareToken, shareTokenExpiresAt, status } = row.proposal;
  if (!timingSafeEqualString(shareToken, token)) return { error: "invalid_token" as const };
  if (shareTokenExpiresAt && shareTokenExpiresAt < new Date()) return { error: "expired" as const };
  if (status === "superseded" || status === "cancelled") return { error: "unavailable" as const };
  return { row };
}

const router: IRouter = Router();
// Gate, not the limiter itself: this router is mounted before authenticated
// proposal routes, and a bare `use(publicRateLimiter)` would throttle those too.
router.use(publicRateLimitGate);

// ---------- Public routes (no auth) ----------

router.get("/proposals/:id/public", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const result = await loadProposalByToken(id, token);
  if ("error" in result) {
    res.status(410).json({ error: "This proposal link is not available." });
    return;
  }
  const { proposal, client } = result.row;
  await logActivity(proposal.id, proposal.userId, "link_opened", { req });
  res.json({
    id: proposal.id,
    proposalNo: proposal.proposalNo,
    proposalRevision: proposal.proposalRevision,
    status: proposal.status,
    clientName: client?.name,
    validUntil: proposal.validUntil ?? undefined,
    canConfirm: proposal.status === "sent",
    canRevise: proposal.status === "sent",
  });
});

router.get("/proposals/:id/pdf/public", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const result = await loadProposalByToken(id, token);
  if ("error" in result) {
    res.status(410).json({ error: "This proposal link is not available." });
    return;
  }
  const { proposal, client } = result.row;
  await logActivity(proposal.id, proposal.userId, "pdf_viewed", { req });
  try {
    const settings = await getCompanySettings({ fresh: true });
    const consultantIds = await loadConsultantIds(db, PROPOSAL_CONSULTANTS, proposal.id);
    const consultants = await loadConsultants(consultantIds);
    await streamProposalPdf(proposal, client, settings, consultants, res);
  } catch (err) {
    logger.error({ err, proposalId: proposal.id }, "Failed to generate public proposal PDF");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF" });
    }
  }
});

router.post("/proposals/:id/public/download", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({ token: z.string().min(1) }).parse(req.body ?? {});
  const result = await loadProposalByToken(id, body.token);
  if ("error" in result) {
    res.status(410).json({ error: "This proposal link is not available." });
    return;
  }
  const { proposal, client } = result.row;
  await logActivity(proposal.id, proposal.userId, "pdf_downloaded", { req });
  const settings = await getCompanySettings({ fresh: true });
  const consultantIds = await loadConsultantIds(db, PROPOSAL_CONSULTANTS, proposal.id);
  const consultants = await loadConsultants(consultantIds);
  const { buffer, filename } = await streamProposalPdfToBuffer(proposal, client, settings, consultants);
  const { setPdfDownloadHeaders } = await import("../../lib/pdfResponseHeaders");
  setPdfDownloadHeaders(res, `attachment; filename="${filename}"`);
  res.send(buffer);
});

router.post("/proposals/:id/public/question", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z
    .object({
      token: z.string().min(1),
      questionText: z.string().min(1).max(4000),
      clientName: z.string().optional(),
      clientEmail: z.string().email().optional(),
    })
    .parse(req.body ?? {});
  const result = await loadProposalByToken(id, body.token);
  if ("error" in result) {
    res.status(410).json({ error: "This proposal link is not available." });
    return;
  }
  const { proposal } = result.row;
  const [q] = await db
    .insert(proposalQuestionsTable)
    .values({
      proposalId: proposal.id,
      userId: proposal.userId,
      questionText: body.questionText.trim(),
      clientName: body.clientName?.trim() || null,
      clientEmail: body.clientEmail?.trim() || null,
    })
    .returning();
  await logActivity(proposal.id, proposal.userId, "question_raised", {
    req,
    eventData: { questionId: q.id, questionText: body.questionText.trim() },
  });
  notifyStaffProposalEvent(
    proposal.createdByUserId ?? proposal.userId,
    `Question on proposal ${proposal.proposalNo}`,
    `<p>A client asked a question on proposal <strong>${proposal.proposalNo}</strong> (Rev. ${proposal.proposalRevision}).</p>
<p><strong>Question:</strong><br/>${escapeHtml(body.questionText.trim()).replace(/\n/g, "<br/>")}</p>
${body.clientName ? `<p>From: ${escapeHtml(body.clientName)}</p>` : ""}
${body.clientEmail ? `<p>Email: ${escapeHtml(body.clientEmail)}</p>` : ""}`,
  );
  res.status(201).json({ ok: true, id: q.id });
});

router.post("/proposals/:id/public/confirm", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({ token: z.string().min(1), signatureName: z.string().min(1).max(200) }).parse(req.body ?? {});
  const result = await loadProposalByToken(id, body.token);
  if ("error" in result) {
    res.status(410).json({ error: "This proposal link is not available." });
    return;
  }
  const { proposal } = result.row;
  const now = new Date();
  const shareToken = proposal.shareToken;
  if (!shareToken) {
    res.status(410).json({ error: "This proposal link is not available." });
    return;
  }
  const [updated] = await db
    .update(proposalDocumentsTable)
    .set({
      status: "confirmed",
      clientConfirmedAt: now,
      clientSignatureName: body.signatureName.trim(),
      updatedAt: now,
    })
    .where(
      and(
        eq(proposalDocumentsTable.id, proposal.id),
        eq(proposalDocumentsTable.status, "sent"),
        eq(proposalDocumentsTable.shareToken, shareToken),
      ),
    )
    .returning({ id: proposalDocumentsTable.id });
  if (!updated) {
    res.status(409).json({ error: "This proposal cannot be confirmed in its current status." });
    return;
  }
  await logActivity(proposal.id, proposal.userId, "confirmed", {
    req,
    eventData: { signatureName: body.signatureName.trim() },
  });
  notifyStaffProposalEvent(
    proposal.createdByUserId ?? proposal.userId,
    `Proposal ${proposal.proposalNo} confirmed`,
    `<p>Proposal <strong>${proposal.proposalNo}</strong> (Rev. ${proposal.proposalRevision}) was confirmed by the client.</p>
<p>Signed by: ${escapeHtml(body.signatureName.trim())}</p>`,
  );
  res.json({ ok: true });
});

router.post("/proposals/:id/public/revise", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z
    .object({ token: z.string().min(1), comment: z.string().min(1).max(4000) })
    .parse(req.body ?? {});
  const result = await loadProposalByToken(id, body.token);
  if ("error" in result) {
    res.status(410).json({ error: "This proposal link is not available." });
    return;
  }
  const { proposal } = result.row;
  const now = new Date();
  const shareToken = proposal.shareToken;
  if (!shareToken) {
    res.status(410).json({ error: "This proposal link is not available." });
    return;
  }
  const [updated] = await db
    .update(proposalDocumentsTable)
    .set({
      status: "revision_requested",
      revisionRequestComment: body.comment.trim(),
      updatedAt: now,
    })
    .where(
      and(
        eq(proposalDocumentsTable.id, proposal.id),
        eq(proposalDocumentsTable.status, "sent"),
        eq(proposalDocumentsTable.shareToken, shareToken),
      ),
    )
    .returning({ id: proposalDocumentsTable.id });
  if (!updated) {
    res.status(409).json({ error: "Revision can only be requested for sent proposals." });
    return;
  }
  await logActivity(proposal.id, proposal.userId, "revision_requested", {
    req,
    eventData: { comment: body.comment.trim() },
  });
  notifyStaffProposalEvent(
    proposal.createdByUserId ?? proposal.userId,
    `Revision requested: ${proposal.proposalNo}`,
    `<p>A client requested a revision for proposal <strong>${proposal.proposalNo}</strong> (Rev. ${proposal.proposalRevision}).</p>
<p><strong>Comment:</strong><br/>${escapeHtml(body.comment.trim()).replace(/\n/g, "<br/>")}</p>`,
  );
  res.json({ ok: true });
});

export default router;
