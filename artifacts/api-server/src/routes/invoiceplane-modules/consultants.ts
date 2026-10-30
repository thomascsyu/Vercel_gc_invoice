import {
  consultantsTable,
  db,
  invoiceConsultantsTable,
  invoicesTable,
  jobOrderConsultantsTable,
  proposalDocumentConsultantsTable,
  proposalDocumentsTable,
} from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import { scopedDataUserId } from "../../lib/auth/scopedUserId";
import { currentDataMode } from "../../lib/dataMode";

const router: IRouter = Router();

// ---------- Consultants ----------
const ConsultantSchema = z.object({
  shortCode: z.string().min(1).max(8),
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

function consultantDto(row: typeof consultantsTable.$inferSelect) {
  return {
    id: row.id,
    shortCode: row.shortCode,
    name: row.name,
    email: row.email ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/consultants", async (_req, res) => {
  const rows = await db
    .select()
    .from(consultantsTable)
    .orderBy(asc(consultantsTable.shortCode));
  res.json(rows.map(consultantDto));
});

/** Monthly invoiced revenue attributed to each consultant. */
router.get("/consultants/performance", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const rows = await db
    .select({
      consultantId: consultantsTable.id,
      shortCode: consultantsTable.shortCode,
      name: consultantsTable.name,
      month: sql<string>`to_char(${invoicesTable.invoiceDate}, 'YYYY-MM')`,
      currency: invoicesTable.currency,
      revenue: sql<string>`sum(${invoicesTable.total}::numeric)`,
      invoiceCount: sql<number>`count(distinct ${invoicesTable.id})::int`,
    })
    .from(invoiceConsultantsTable)
    .innerJoin(
      consultantsTable,
      eq(invoiceConsultantsTable.consultantId, consultantsTable.id),
    )
    .innerJoin(
      invoicesTable,
      eq(invoiceConsultantsTable.invoiceId, invoicesTable.id),
    )
    .where(
      and(
        eq(invoicesTable.userId, userId),
        eq(invoicesTable.dataMode, dataMode),
        isNull(invoicesTable.deletedAt),
      ),
    )
    .groupBy(
      consultantsTable.id,
      consultantsTable.shortCode,
      consultantsTable.name,
      sql`to_char(${invoicesTable.invoiceDate}, 'YYYY-MM')`,
      invoicesTable.currency,
    )
    .orderBy(
      sql`to_char(${invoicesTable.invoiceDate}, 'YYYY-MM') desc`,
      asc(consultantsTable.shortCode),
    );

  res.json(
    rows.map((row) => ({
      ...row,
      revenue: Number(row.revenue),
      invoiceCount: Number(row.invoiceCount),
    })),
  );
});

router.post("/consultants", requireAdmin, async (req, res) => {
  const body = ConsultantSchema.parse(req.body);
  const [row] = await db
    .insert(consultantsTable)
    .values({ ...body, email: body.email || null })
    .returning();
  res.status(201).json(consultantDto(row));
});

router.patch("/consultants/:id", requireAdmin, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = ConsultantSchema.partial().parse(req.body);
  const [row] = await db
    .update(consultantsTable)
    .set({
      ...body,
      email: body.email === "" ? null : body.email,
      updatedAt: new Date(),
    })
    .where(eq(consultantsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Consultant not found" });
    return;
  }
  res.json(consultantDto(row));
});

/**
 * Deleting a consultant that's still referenced would leave a dangling link
 * behind. invoiceConsultantsTable/jobOrderConsultantsTable/
 * proposalDocumentConsultantsTable all carry a real ON DELETE RESTRICT FK
 * now (migration 0036), so the database itself would refuse the delete --
 * this check just turns that into a clean 409 with an explanation instead of
 * a raw constraint-violation error. consultantPortfolio is a separate,
 * richer jsonb array (photo/bio) that's still out of scope for the join-table
 * migration, so it's still checked the old way.
 */
async function findConsultantReferences(id: string): Promise<string[]> {
  const [[invoiceRef], [jobOrderRef], [proposalRef], [portfolioRef]] =
    await Promise.all([
      db
        .select({ consultantId: invoiceConsultantsTable.consultantId })
        .from(invoiceConsultantsTable)
        .where(eq(invoiceConsultantsTable.consultantId, id))
        .limit(1),
      db
        .select({ consultantId: jobOrderConsultantsTable.consultantId })
        .from(jobOrderConsultantsTable)
        .where(eq(jobOrderConsultantsTable.consultantId, id))
        .limit(1),
      db
        .select({ consultantId: proposalDocumentConsultantsTable.consultantId })
        .from(proposalDocumentConsultantsTable)
        .where(eq(proposalDocumentConsultantsTable.consultantId, id))
        .limit(1),
      db
        .select({ id: proposalDocumentsTable.id })
        .from(proposalDocumentsTable)
        .where(
          sql`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${proposalDocumentsTable.consultantPortfolio}) AS elem
        WHERE elem->>'consultantId' = ${id}
      )`,
        )
        .limit(1),
    ]);

  const references: string[] = [];
  if (invoiceRef) references.push("invoices");
  if (jobOrderRef) references.push("job orders");
  if (proposalRef || portfolioRef) references.push("proposals");
  return references;
}

router.delete("/consultants/:id", requireAdmin, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const references = await findConsultantReferences(id);
  if (references.length > 0) {
    res.status(409).json({
      error: `Cannot delete: this consultant is still assigned to ${references.join(", ")}. Deactivate them instead (edit → uncheck Active), or unassign them first.`,
    });
    return;
  }
  await db.delete(consultantsTable).where(eq(consultantsTable.id, id));
  res.status(204).send();
});

export default router;
