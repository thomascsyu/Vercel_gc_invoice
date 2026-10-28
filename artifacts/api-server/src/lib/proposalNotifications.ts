import { eq } from "drizzle-orm";
import { db, usersTable, type GmailAccount } from "@workspace/db";
import { getCompanySettings } from "./companySettingsCache";
import { resolveSender, sendEmail } from "./emailHelpers";

async function sendStaffProposalNotification(
  userId: string,
  subject: string,
  bodyHtml: string,
): Promise<void> {
  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.googleSub, userId))
    .limit(1);
  if (!user?.email) return;

  const settings = await getCompanySettings();
  const g1 = settings?.gmailAccount1 as GmailAccount | null;
  const g2 = settings?.gmailAccount2 as GmailAccount | null;
  const sender = resolveSender(g1, g2, 1);
  if (!sender) return;

  const companyName = settings?.companyName || "Gabriel Consultant Limited";
  await sendEmail({
    sender,
    fromName: companyName,
    to: user.email,
    subject,
    htmlBody: bodyHtml,
  });
}

/** Fire-and-forget staff notification for proposal portal events. */
export function notifyStaffProposalEvent(userId: string, subject: string, bodyHtml: string): void {
  void sendStaffProposalNotification(userId, subject, bodyHtml).catch((err) => {
    console.error("[proposal-notify]", err);
  });
}

export async function sendClientProposalReplyEmail(opts: {
  to: string;
  companyName: string;
  proposalNo: string;
  questionText: string;
  reply: string;
  clientName?: string;
}): Promise<void> {
  const settings = await getCompanySettings();
  const g1 = settings?.gmailAccount1 as GmailAccount | null;
  const g2 = settings?.gmailAccount2 as GmailAccount | null;
  const sender = resolveSender(g1, g2, 1);
  if (!sender) return;

  const greeting = opts.clientName?.trim() ? `Dear ${opts.clientName.trim()},` : "Dear Client,";
  const htmlBody = `<p>${greeting}</p>
<p>Thank you for your question regarding proposal <strong>${opts.proposalNo}</strong>.</p>
<p><strong>Your question:</strong><br/>${escapeHtml(opts.questionText)}</p>
<p><strong>Our reply:</strong><br/>${escapeHtml(opts.reply)}</p>
<p>Best regards,<br/>${escapeHtml(opts.companyName)}</p>`;

  await sendEmail({
    sender,
    fromName: opts.companyName,
    to: opts.to,
    subject: `Re: Proposal ${opts.proposalNo}`,
    htmlBody,
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br/>");
}
