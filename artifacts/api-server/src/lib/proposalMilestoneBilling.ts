import { and, count, eq, sql } from "drizzle-orm";
import {
  db,
  invoicesTable,
  proposalDocumentsTable,
  type LineItem,
  type ProposalMilestoneInvoice,
  type ProposalPaymentScheduleItem,
} from "@workspace/db";
import { withUniqueRetry } from "./withUniqueRetry";
import { currentDataMode, type DataMode } from "./dataMode";
import { INVOICE_CONSULTANTS, loadConsultantIds, PROPOSAL_CONSULTANTS, replaceConsultantIds } from "./consultantLinks";
import { INVOICE_ITEMS, replaceLineItems } from "./lineItems";

type QueryExecutor = Pick<typeof db, "select" | "update">;
type CountExecutor = Pick<typeof db, "select">;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function money(value: number): string {
  return value.toFixed(2);
}

function today(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function documentNumberStamp(): string {
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function nextInvoiceNumber(userId: string, executor: CountExecutor = db, dataMode?: DataMode): Promise<string> {
  const mode = dataMode ?? (await currentDataMode());
  const stamp = documentNumberStamp();
  const [{ total }] = await executor
    .select({ total: count() })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.userId, userId), eq(invoicesTable.dataMode, mode)));
  return `${stamp}${String(Number(total) + 1).padStart(3, "0")}`;
}

export type MilestoneInvoiceResult = {
  invoiceId: string;
  invoiceNumber: string;
  scheduleIndex: number;
  label: string;
  amount: number;
};

export async function createProposalMilestoneInvoice(
  userId: string,
  proposal: typeof proposalDocumentsTable.$inferSelect,
  scheduleIndex: number,
): Promise<MilestoneInvoiceResult | { error: string }> {
  if (proposal.status !== "confirmed") {
    return { error: "Milestone invoices can only be created from confirmed proposals." };
  }

  const schedule = (proposal.paymentSchedule ?? []) as ProposalPaymentScheduleItem[];
  const milestone = schedule[scheduleIndex];
  if (!milestone) {
    return { error: "Invalid payment schedule milestone index." };
  }

  const billed = (proposal.milestoneInvoices ?? []) as ProposalMilestoneInvoice[];
  if (billed.some((b) => b.scheduleIndex === scheduleIndex)) {
    return { error: "This milestone has already been invoiced." };
  }

  const proposalTotal = toNumber(proposal.totalAmount);
  const amount = (proposalTotal * (milestone.percentage || 0)) / 100;
  const label = milestone.label.trim() || `Milestone ${scheduleIndex + 1}`;
  const lineItem: LineItem = {
    name: label,
    details: `Proposal ${proposal.proposalNo} Rev.${proposal.proposalRevision} — ${milestone.percentage}% of ${proposal.currency} ${proposalTotal.toLocaleString()}`,
    quantity: 1,
    price: amount,
    taxRate: 0,
  };

  // Insert + proposal.milestoneInvoices update run in one retried transaction:
  // a crash between the two would otherwise leave a real invoice on record
  // that the proposal doesn't know was billed, and the invoice number itself
  // is retried on a rare cross-request numbering race (e.g. this same
  // milestone auto-billing running alongside a manual invoice creation).
  const dataMode = await currentDataMode();
  return withUniqueRetry(() =>
    db.transaction(async (tx) => {
      const proposalConsultantIds = await loadConsultantIds(tx, PROPOSAL_CONSULTANTS, proposal.id);
      const [invoice] = await tx
        .insert(invoicesTable)
        .values({
          userId,
          dataMode,
          clientId: proposal.clientId,
          invoiceNumber: await nextInvoiceNumber(userId, tx, dataMode),
          invoiceDate: today(),
          dueDate: today(30),
          status: "draft",
          currency: proposal.currency,
          serviceCategory: "others",
          subtotal: money(amount),
          taxAmount: money(0),
          discountAmount: money(0),
          total: money(amount),
          paidAmount: money(0),
          notes: `Milestone invoice from proposal ${proposal.proposalNo} (Rev. ${proposal.proposalRevision})`,
        })
        .returning();
      await replaceConsultantIds(tx, INVOICE_CONSULTANTS, invoice.id, proposalConsultantIds);
      await replaceLineItems(tx, INVOICE_ITEMS, invoice.id, [lineItem]);

      const entry: ProposalMilestoneInvoice = {
        scheduleIndex,
        label,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoicedAt: new Date().toISOString(),
      };

      await tx
        .update(proposalDocumentsTable)
        .set({
          milestoneInvoices: [...billed, entry],
          updatedAt: new Date(),
        })
        .where(eq(proposalDocumentsTable.id, proposal.id));

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        scheduleIndex,
        label,
        amount,
      };
    }),
  );
}

export async function createAllUnbilledMilestoneInvoices(
  userId: string,
  proposal: typeof proposalDocumentsTable.$inferSelect,
): Promise<{ created: MilestoneInvoiceResult[]; errors: string[] }> {
  const schedule = (proposal.paymentSchedule ?? []) as ProposalPaymentScheduleItem[];
  const billed = new Set(((proposal.milestoneInvoices ?? []) as ProposalMilestoneInvoice[]).map((b) => b.scheduleIndex));
  const created: MilestoneInvoiceResult[] = [];
  const errors: string[] = [];

  let current = proposal;
  for (let i = 0; i < schedule.length; i++) {
    if (billed.has(i)) continue;
    const result = await createProposalMilestoneInvoice(userId, current, i);
    if ("error" in result) {
      errors.push(`Milestone ${i + 1}: ${result.error}`);
      break;
    }
    created.push(result);
    const [updated] = await db
      .select()
      .from(proposalDocumentsTable)
      .where(eq(proposalDocumentsTable.id, proposal.id));
    if (updated) current = updated;
  }

  return { created, errors };
}

/** Auto-bill the first payment milestone when a job order is created (confirmation deposit). */
export async function autoBillFirstMilestoneIfNeeded(
  userId: string,
  proposal: typeof proposalDocumentsTable.$inferSelect,
): Promise<MilestoneInvoiceResult | null> {
  const schedule = (proposal.paymentSchedule ?? []) as ProposalPaymentScheduleItem[];
  if (!schedule.length) return null;
  const billed = (proposal.milestoneInvoices ?? []) as ProposalMilestoneInvoice[];
  if (billed.length > 0) return null;
  const result = await createProposalMilestoneInvoice(userId, proposal, 0);
  if ("error" in result) return null;
  return result;
}

/** Keep proposal milestone invoiceNumber copies in sync when an invoice is revised. */
export async function syncMilestoneInvoiceNumber(
  userId: string,
  invoiceId: string,
  invoiceNumber: string,
  executor: QueryExecutor = db,
): Promise<void> {
  const proposals = await executor
    .select({
      id: proposalDocumentsTable.id,
      milestoneInvoices: proposalDocumentsTable.milestoneInvoices,
    })
    .from(proposalDocumentsTable)
    .where(
      and(
        eq(proposalDocumentsTable.userId, userId),
        sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${proposalDocumentsTable.milestoneInvoices}) AS elem
          WHERE elem->>'invoiceId' = ${invoiceId}
        )`,
      ),
    );

  for (const proposal of proposals) {
    const billed = (proposal.milestoneInvoices ?? []) as ProposalMilestoneInvoice[];
    const next = billed.map((entry) =>
      entry.invoiceId === invoiceId ? { ...entry, invoiceNumber } : entry,
    );
    const changed = next.some((entry, i) => entry.invoiceNumber !== billed[i]?.invoiceNumber);
    if (!changed) continue;
    await executor
      .update(proposalDocumentsTable)
      .set({ milestoneInvoices: next, updatedAt: new Date() })
      .where(eq(proposalDocumentsTable.id, proposal.id));
  }
}
