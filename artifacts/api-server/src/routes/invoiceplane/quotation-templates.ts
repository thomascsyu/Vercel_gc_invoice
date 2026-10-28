import {
  CreateQuotationTemplateBody,
  DeleteQuotationTemplateParams,
  ListQuotationTemplatesQueryParams,
  UpdateQuotationTemplateBody,
  UpdateQuotationTemplateParams,
} from "@workspace/api-zod";
import { z as zz } from "zod";
import { db, quotationTemplatesTable, type LineItem } from "@workspace/db";
import { and, asc, count, desc, eq, ilike, max } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { loadLineItems, loadLineItemsByParent, QUOTATION_TEMPLATE_ITEMS, replaceLineItems } from "../../lib/lineItems";
import { money, quotationTemplateDto } from "./helpers";

const router: IRouter = Router();

const ReorderQuotationTemplatesBody = zz.object({ ids: zz.array(zz.string()) });
// ── Quotation Templates ──────────────────────────────────────────────────────

router.get("/quotation-templates", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const query = ListQuotationTemplatesQueryParams.parse(req.query);
  const search = query.q?.trim();
  const where = search
    ? and(eq(quotationTemplatesTable.userId, userId), ilike(quotationTemplatesTable.name, `%${search}%`))
    : eq(quotationTemplatesTable.userId, userId);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 100;
  const offset = (page - 1) * pageSize;
  const [{ total }] = await db.select({ total: count() }).from(quotationTemplatesTable).where(where);
  const rows = await db
    .select()
    .from(quotationTemplatesTable)
    .where(where)
    .orderBy(asc(quotationTemplatesTable.sortOrder), desc(quotationTemplatesTable.createdAt))
    .limit(pageSize)
    .offset(offset);
  const itemsByTemplate = await loadLineItemsByParent(db, QUOTATION_TEMPLATE_ITEMS, rows.map((r) => r.id));
  res.json({
    data: rows.map((row) => quotationTemplateDto(row, itemsByTemplate.get(row.id) ?? [])),
    total: Number(total),
    page,
    pageSize,
  });
});

router.post("/quotation-templates", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const body = CreateQuotationTemplateBody.parse(req.body);
  const [{ maxOrder }] = await db
    .select({ maxOrder: max(quotationTemplatesTable.sortOrder) })
    .from(quotationTemplatesTable)
    .where(eq(quotationTemplatesTable.userId, userId));
  const nextOrder = (maxOrder ?? -1) + 1;
  const items = (body.items ?? []) as LineItem[];
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(quotationTemplatesTable)
      .values({
        userId,
        name: body.name,
        currency: body.currency ?? "HKD",
        discountAmount: money(body.discountAmount ?? 0),
        sortOrder: nextOrder,
      })
      .returning();
    await replaceLineItems(tx, QUOTATION_TEMPLATE_ITEMS, inserted.id, items);
    return inserted;
  });
  res.status(201).json(quotationTemplateDto(row, items));
});

router.get("/quotation-templates/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const { id } = UpdateQuotationTemplateParams.parse(req.params);
  const [row] = await db
    .select()
    .from(quotationTemplatesTable)
    .where(and(eq(quotationTemplatesTable.userId, userId), eq(quotationTemplatesTable.id, id)));
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  const items = await loadLineItems(db, QUOTATION_TEMPLATE_ITEMS, id);
  res.json(quotationTemplateDto(row, items));
});

router.patch("/quotation-templates/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const { id } = UpdateQuotationTemplateParams.parse(req.params);
  const body = UpdateQuotationTemplateBody.parse(req.body);
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(quotationTemplatesTable)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.discountAmount !== undefined ? { discountAmount: money(body.discountAmount) } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(quotationTemplatesTable.userId, userId), eq(quotationTemplatesTable.id, id)))
      .returning();
    // items is optional on this endpoint (a notes/sort-only PATCH must not
    // touch line items) — only replace when the caller actually sent items.
    if (updated && body.items !== undefined) {
      await replaceLineItems(tx, QUOTATION_TEMPLATE_ITEMS, id, body.items as LineItem[]);
    }
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  const items = body.items !== undefined
    ? (body.items as LineItem[])
    : await loadLineItems(db, QUOTATION_TEMPLATE_ITEMS, id);
  res.json(quotationTemplateDto(row, items));
});

router.post("/quotation-templates/reorder", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const { ids } = ReorderQuotationTemplatesBody.parse(req.body);
  await Promise.all(
    ids.map((id, idx) =>
      db
        .update(quotationTemplatesTable)
        .set({ sortOrder: idx })
        .where(and(eq(quotationTemplatesTable.userId, userId), eq(quotationTemplatesTable.id, id))),
    ),
  );
  res.status(204).send();
});

router.delete("/quotation-templates/:id", async (req, res) => {
  const userId = (req as unknown as AuthedRequest).userId;
  const { id } = DeleteQuotationTemplateParams.parse(req.params);
  await db
    .delete(quotationTemplatesTable)
    .where(and(eq(quotationTemplatesTable.userId, userId), eq(quotationTemplatesTable.id, id)));
  res.status(204).send();
});

export default router;
