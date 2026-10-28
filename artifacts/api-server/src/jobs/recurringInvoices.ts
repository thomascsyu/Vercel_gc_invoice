import { db, invoicesTable, recurringInvoicesTable } from "@workspace/db";
import { and, eq, lte } from "drizzle-orm";
import { schedule } from "node-cron";
import { businessCalendarToday, businessTimeZone } from "@workspace/invoice-utils";
import { LIVE_DATA_MODE } from "../lib/dataMode";
import { logger } from "../lib/logger";
import { withUniqueRetry } from "../lib/withUniqueRetry";
import { calculateTotals, nextDocumentNumber } from "../routes/invoiceplane/helpers";
import { INVOICE_ITEMS, loadLineItems, RECURRING_INVOICE_ITEMS, replaceLineItems } from "../lib/lineItems";

function advanceDate(dateStr: string, freq: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (freq === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (freq === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (freq === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (freq === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export type RunDueRecurringInvoicesOptions = {
  /** When set, only schedules owned by this workspace user are processed. */
  userId?: string;
};

/** Generate draft invoices for all enabled recurring schedules that are due. */
export async function runDueRecurringInvoices(
  options: RunDueRecurringInvoicesOptions = {},
): Promise<{ generated: number }> {
  const today = businessCalendarToday();
  const conditions = [
    eq(recurringInvoicesTable.enabled, true),
    lte(recurringInvoicesTable.nextRunDate, today),
  ];
  if (options.userId) {
    conditions.push(eq(recurringInvoicesTable.userId, options.userId));
  }

  const dueRows = await db
    .select()
    .from(recurringInvoicesTable)
    .where(and(...conditions));

  let generated = 0;
  for (const sched of dueRows) {
    const created = await withUniqueRetry(async () => {
      return await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(recurringInvoicesTable)
          .where(eq(recurringInvoicesTable.id, sched.id))
          .for("update");
        if (!locked || !locked.enabled || locked.nextRunDate > today) {
          return false;
        }
        const items = await loadLineItems(tx, RECURRING_INVOICE_ITEMS, locked.id);
        const totals = calculateTotals(items, 0);
        const invoiceNumber = await nextDocumentNumber(locked.userId, "invoice", undefined, tx, LIVE_DATA_MODE);
        const [inserted] = await tx
          .insert(invoicesTable)
          .values({
            userId: locked.userId,
            dataMode: LIVE_DATA_MODE,
            clientId: locked.clientId,
            invoiceNumber,
            invoiceDate: today,
            dueDate: today,
            status: "draft",
            currency: locked.currency,
            subtotal: totals.subtotal.toFixed(2),
            taxAmount: totals.taxAmount.toFixed(2),
            discountAmount: "0",
            total: totals.total.toFixed(2),
            paidAmount: "0",
          })
          .returning();
        await replaceLineItems(tx, INVOICE_ITEMS, inserted.id, items);
        await tx
          .update(recurringInvoicesTable)
          .set({
            lastRunAt: new Date(),
            nextRunDate: advanceDate(locked.nextRunDate, locked.frequency),
            updatedAt: new Date(),
          })
          .where(eq(recurringInvoicesTable.id, locked.id));
        return true;
      });
    });
    if (created) generated++;
  }

  return { generated };
}

export function startRecurringInvoiceJob(): void {
  // Same business zone as quotation reminders (TZ, or Asia/Hong_Kong).
  const tz = businessTimeZone();
  schedule(
    "0 6 * * *",
    () => {
      runDueRecurringInvoices()
        .then(({ generated }) => {
          if (generated > 0) {
            logger.info({ generated }, "Recurring invoice job generated draft invoices");
          }
        })
        .catch((err) => {
          logger.error({ err }, "Uncaught error in recurring invoice job");
        });
    },
    { timezone: tz },
  );
  logger.info(
    { tz },
    "Recurring invoice job scheduled (daily at 06:00 business time, all workspace users)",
  );
}
