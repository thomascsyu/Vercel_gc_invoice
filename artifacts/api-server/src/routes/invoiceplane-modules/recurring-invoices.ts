import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import { JobOrderItemSchema } from "./helpers";
import { runDueRecurringInvoices } from "../../jobs/recurringInvoices";
import { db, recurringInvoicesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import type { LineItem } from "@workspace/db";
import { assertClientOwnedByUser } from "../../lib/clientOwnership";
import { loadLineItems, loadLineItemsByParent, RECURRING_INVOICE_ITEMS, replaceLineItems } from "../../lib/lineItems";

const router: IRouter = Router();

// ---------- Recurring Invoices ----------
const RecurringSchema = z.object({
  clientId: z.string().uuid(),
  label: z.string().min(1),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  nextRunDate: z.string(),
  currency: z.enum(["HKD", "USD", "CNY", "MOP"]).default("HKD"),
  items: z.array(JobOrderItemSchema).default([]),
  enabled: z.boolean().default(true),
});

function recurringDto(row: typeof recurringInvoicesTable.$inferSelect, items: LineItem[]) {
  return {
    id: row.id,
    clientId: row.clientId,
    label: row.label,
    frequency: row.frequency,
    nextRunDate: row.nextRunDate,
    currency: row.currency,
    items,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** No pagination UI exists for this resource (schedules are naturally few per
 * user), but the query itself must still be bounded rather than unbounded. */
const RECURRING_INVOICES_LIST_CAP = 500;

router.get("/recurring-invoices", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const rows = await db
    .select()
    .from(recurringInvoicesTable)
    .where(eq(recurringInvoicesTable.userId, userId))
    .orderBy(desc(recurringInvoicesTable.createdAt))
    .limit(RECURRING_INVOICES_LIST_CAP);
  const itemsByRecurring = await loadLineItemsByParent(db, RECURRING_INVOICE_ITEMS, rows.map((r) => r.id));
  res.json(rows.map((row) => recurringDto(row, itemsByRecurring.get(row.id) ?? [])));
});

router.post("/recurring-invoices", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const body = RecurringSchema.parse(req.body);
  const clientCheck = await assertClientOwnedByUser(userId, body.clientId);
  if (!clientCheck.ok) {
    res.status(clientCheck.status).json({ error: clientCheck.error });
    return;
  }
  const { items, ...rest } = body;
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(recurringInvoicesTable)
      .values({ ...rest, userId })
      .returning();
    await replaceLineItems(tx, RECURRING_INVOICE_ITEMS, inserted.id, items);
    return inserted;
  });
  res.status(201).json(recurringDto(row, items));
});

router.patch("/recurring-invoices/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  // NOTE: RecurringSchema declares `items` with `.default([])`, and zod v4's
  // `.partial()` still applies that default when the key is absent from the
  // request body -- so `body.items` is `[]`, never `undefined`, even on a
  // PATCH that never mentioned items. Presence has to be checked against the
  // raw, pre-parse request body instead.
  const itemsProvided = Boolean(req.body) && typeof req.body === "object" && "items" in (req.body as object);
  const body = RecurringSchema.partial().parse(req.body);
  if (body.clientId) {
    const clientCheck = await assertClientOwnedByUser(userId, body.clientId);
    if (!clientCheck.ok) {
      res.status(clientCheck.status).json({ error: clientCheck.error });
      return;
    }
  }
  const { items, ...rest } = body;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(recurringInvoicesTable)
      .set({ ...rest, updatedAt: new Date() })
      .where(and(eq(recurringInvoicesTable.userId, userId), eq(recurringInvoicesTable.id, id)))
      .returning();
    // items is optional on this endpoint (.partial()) — a label/enabled-only
    // PATCH must not wipe existing line items, so only replace when the
    // caller actually sent an `items` key (see itemsProvided note above).
    if (updated && itemsProvided) {
      await replaceLineItems(tx, RECURRING_INVOICE_ITEMS, id, items ?? []);
    }
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  const responseItems = itemsProvided ? (items ?? []) : await loadLineItems(db, RECURRING_INVOICE_ITEMS, id);
  res.json(recurringDto(row, responseItems));
});

router.delete("/recurring-invoices/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  await db
    .delete(recurringInvoicesTable)
    .where(and(eq(recurringInvoicesTable.userId, userId), eq(recurringInvoicesTable.id, id)));
  res.status(204).send();
});

/** Manual trigger: processes due schedules for every workspace user (admin only). */
router.post("/recurring-invoices/run-due", requireAdmin, async (_req, res) => {
  const { generated } = await runDueRecurringInvoices();
  res.json({ generated });
});

export default router;
