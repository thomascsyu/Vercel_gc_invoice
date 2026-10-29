import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, proposalActivityLogTable, proposalQuestionsTable } from "@workspace/db";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { sendClientProposalReplyEmail } from "../../lib/proposalNotifications";
import { loadProposalOwned } from "./helpers";

const router: IRouter = Router();

router.get("/proposals/:id/activity", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const rows = await db
    .select()
    .from(proposalActivityLogTable)
    .where(eq(proposalActivityLogTable.proposalId, id))
    .orderBy(desc(proposalActivityLogTable.createdAt));
  res.json(
    rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      eventData: r.eventData ?? undefined,
      actorType: r.actorType,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.get("/proposals/:id/questions", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const rows = await db
    .select()
    .from(proposalQuestionsTable)
    .where(eq(proposalQuestionsTable.proposalId, id))
    .orderBy(desc(proposalQuestionsTable.createdAt));
  res.json(
    rows.map((r) => ({
      id: r.id,
      questionText: r.questionText,
      clientName: r.clientName ?? undefined,
      clientEmail: r.clientEmail ?? undefined,
      status: r.status,
      staffReply: r.staffReply ?? undefined,
      repliedAt: r.repliedAt?.toISOString() ?? undefined,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.post("/proposals/:id/questions/:questionId/reply", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id, questionId } = z.object({ id: z.string().uuid(), questionId: z.string().uuid() }).parse(req.params);
  const body = z.object({ reply: z.string().min(1).max(4000) }).parse(req.body ?? {});
  const existing = await loadProposalOwned(userId, id);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const [question] = await db
    .select()
    .from(proposalQuestionsTable)
    .where(and(eq(proposalQuestionsTable.id, questionId), eq(proposalQuestionsTable.proposalId, id)));
  if (!question) {
    res.status(404).json({ error: "Question not found" });
    return;
  }
  const now = new Date();
  const replyText = body.reply.trim();
  const [row] = await db
    .update(proposalQuestionsTable)
    .set({
      staffReply: replyText,
      status: "answered",
      repliedAt: now,
      repliedByUserId: userId,
    })
    .where(and(eq(proposalQuestionsTable.id, questionId), eq(proposalQuestionsTable.proposalId, id)))
    .returning();

  const recipient = question.clientEmail?.trim() || existing.client?.email?.trim();
  if (recipient) {
    const settings = await getCompanySettings({ fresh: true });
    const companyName = settings?.companyName || "Gabriel Consultant Limited";
    void sendClientProposalReplyEmail({
      to: recipient,
      companyName,
      proposalNo: existing.proposal.proposalNo,
      questionText: question.questionText,
      reply: replyText,
      clientName: question.clientName ?? existing.client?.contactPerson ?? existing.client?.name ?? undefined,
    }).catch((err) => {
      console.error("[proposal-reply-email]", err);
    });
  }

  res.json({
    id: row.id,
    staffReply: row.staffReply,
    status: row.status,
    repliedAt: row.repliedAt?.toISOString(),
  });
});

export default router;
