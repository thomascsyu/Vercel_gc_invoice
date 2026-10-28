import { schedule } from "node-cron";
import { db, quotationsTable, usersTable, type GmailAccount } from "@workspace/db";
import { and, eq, inArray, not } from "drizzle-orm";
import { businessCalendarToday, businessTimeZone } from "@workspace/invoice-utils";
import { logger } from "../lib/logger";
import { sendViaGmailApi } from "../lib/gmailApi";
import { resolveGmailForSend } from "../lib/gmailSettings";
import { getCompanySettings } from "../lib/companySettingsCache";

const EXCLUDED_STATUSES = ["canceled", "confirmed", "invoiced"];
const DEFAULT_REMINDER_DAYS = 3;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parsedReminderDays(): number {
  const raw = process.env["QUOTATION_REMINDER_DAYS"];
  if (!raw) return DEFAULT_REMINDER_DAYS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn(
      { QUOTATION_REMINDER_DAYS: raw },
      `Invalid QUOTATION_REMINDER_DAYS value; falling back to ${DEFAULT_REMINDER_DAYS}`,
    );
    return DEFAULT_REMINDER_DAYS;
  }
  return parsed;
}

function dateOffsetStr(days: number): string {
  const today = businessCalendarToday();
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function sendQuotationExpiryReminders(): Promise<void> {
  const reminderDays = parsedReminderDays();
  // Target quotations whose validUntil is exactly `reminderDays` from today so
  // each quotation is only reminded once per N-day window rather than daily.
  const targetDate = dateOffsetStr(reminderDays);

  logger.info({ reminderDays, targetDate }, "Running quotation expiry reminder job");

  const expiring = await db
    .select()
    .from(quotationsTable)
    .where(
      and(
        eq(quotationsTable.validUntil, targetDate),
        eq(quotationsTable.dataMode, "live"),
        not(inArray(quotationsTable.status, EXCLUDED_STATUSES)),
      ),
    );

  if (expiring.length === 0) {
    logger.info("No expiring quotations found — skipping reminder emails");
    return;
  }

  const settings = await getCompanySettings();
  const primary = settings?.gmailAccount1 as GmailAccount | null;
  const gmail = resolveGmailForSend(primary, primary);
  const canSend = gmail && (gmail.refreshToken || gmail.authMethod === "serviceAccount");

  if (!canSend) {
    logger.warn("Gmail API not connected in company settings — skipping quotation reminder emails");
    return;
  }

  const companyName = settings?.companyName || "InvoicePlane";

  const byUser = new Map<string, typeof expiring>();
  for (const q of expiring) {
    const group = byUser.get(q.userId) ?? [];
    group.push(q);
    byUser.set(q.userId, group);
  }

  const userIds = [...byUser.keys()];
  const users = await db
    .select({ googleSub: usersTable.googleSub, email: usersTable.email, fullName: usersTable.fullName })
    .from(usersTable)
    .where(inArray(usersTable.googleSub, userIds));

  const foundIds = new Set(users.map((u) => u.googleSub));
  const missingUserIds = userIds.filter((id) => !foundIds.has(id));
  if (missingUserIds.length > 0) {
    logger.warn(
      { missingUserIds, count: missingUserIds.length },
      "Skipping quotation reminders for user IDs with no invoiceplane_users row",
    );
  }

  for (const user of users) {
    const quotations = byUser.get(user.googleSub);
    if (!quotations || quotations.length === 0) continue;

    const rows = quotations
      .map((q) => {
        const num = escapeHtml(q.quotationNumber);
        const vu = q.validUntil ? escapeHtml(q.validUntil) : "—";
        const amt = `${escapeHtml(q.currency)} ${escapeHtml(Number(q.total).toLocaleString())}`;
        const st = escapeHtml(q.status);
        return `<tr><td style="padding:4px 8px">${num}</td><td style="padding:4px 8px">${vu}</td><td style="padding:4px 8px">${amt}</td><td style="padding:4px 8px">${st}</td></tr>`;
      })
      .join("");

    const greetingName = escapeHtml((user.fullName || user.email).trim());
    const safeCompany = escapeHtml(companyName);

    const html = `
<p>Dear ${greetingName},</p>
<p>The following quotation${quotations.length > 1 ? "s are" : " is"} expiring within the next ${reminderDays} day${reminderDays !== 1 ? "s" : ""} and may need your attention:</p>
<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
  <thead>
    <tr style="background:#f5f5f5">
      <th style="padding:6px 8px;text-align:left">Quotation #</th>
      <th style="padding:6px 8px;text-align:left">Expires</th>
      <th style="padding:6px 8px;text-align:left">Amount</th>
      <th style="padding:6px 8px;text-align:left">Status</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<p>Please log in to follow up before they expire.</p>
<p>Regards,<br/>${safeCompany}</p>
`;

    const subject =
      quotations.length === 1
        ? `Reminder: Quotation ${quotations[0]!.quotationNumber} expires on ${quotations[0]!.validUntil ?? ""}`
        : `Reminder: ${quotations.length} quotations expiring within ${reminderDays} days`;

    try {
      if (gmail.authMethod === "serviceAccount") {
        await sendViaGmailApi({
          from: `"${companyName}" <${gmail.senderEmail}>`,
          to: user.email,
          subject,
          html,
          serviceAccountCredentials: gmail.serviceAccountCredentials,
        });
      } else {
        await sendViaGmailApi({
          refreshToken: gmail.refreshToken!,
          from: `"${companyName}" <${gmail.senderEmail}>`,
          to: user.email,
          subject,
          html,
        });
      }
      logger.info({ to: user.email, count: quotations.length }, "Quotation expiry reminder sent");
    } catch (err) {
      logger.error({ err, to: user.email }, "Failed to send quotation expiry reminder");
    }
  }
}

export function startQuotationReminderJob(): void {
  // Same zone as validUntil matching (TZ, or Asia/Hong_Kong). The container
  // clock is often UTC; cron uses businessTimeZone(), not the host zone. One replica.
  const tz = businessTimeZone();
  schedule(
    "0 8 * * *",
    () => {
      sendQuotationExpiryReminders().catch((err) => {
        logger.error({ err }, "Uncaught error in quotation reminder job");
      });
    },
    { timezone: tz },
  );
  logger.info({ tz }, "Quotation expiry reminder job scheduled (daily at 08:00 business time)");
}
