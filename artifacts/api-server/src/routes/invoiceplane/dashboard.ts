import { GetDashboardResponse, ListActivityResponse } from "@workspace/api-zod";
import {
  clientsTable,
  consultantsTable,
  db,
  invoiceConsultantsTable,
  invoicesTable,
  paymentsTable,
  quotationsTable,
} from "@workspace/db";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { scopedDataUserId } from "../../lib/auth/scopedUserId";
import { currentDataMode } from "../../lib/dataMode";
import {
  normalizeServiceCategory,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  toNumber,
} from "./helpers";

const router: IRouter = Router();

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Calendar month bounds as `YYYY-MM-DD` strings for lexicographic comparison with `invoice_date`. */
function calendarMonthRange(
  year: number,
  monthIndex0: number,
): { start: string; end: string } {
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  return {
    start: `${year}-${pad2(monthIndex0 + 1)}-01`,
    end: `${year}-${pad2(monthIndex0 + 1)}-${pad2(lastDay)}`,
  };
}

router.get("/dashboard", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const now = new Date();
  const curMonth = calendarMonthRange(now.getFullYear(), now.getMonth());
  const prevAnchor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = calendarMonthRange(
    prevAnchor.getFullYear(),
    prevAnchor.getMonth(),
  );
  const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const prevMonthStart = new Date(
    prevAnchor.getFullYear(),
    prevAnchor.getMonth(),
    1,
  );

  const invoiceUserFilter = and(
    eq(invoicesTable.userId, userId),
    eq(invoicesTable.dataMode, dataMode),
    isNull(invoicesTable.deletedAt),
  );
  const clientUserFilter = and(
    eq(clientsTable.userId, userId),
    eq(clientsTable.dataMode, dataMode),
    isNull(clientsTable.deletedAt),
  );
  const quotationUserFilter = and(
    eq(quotationsTable.userId, userId),
    eq(quotationsTable.dataMode, dataMode),
    isNull(quotationsTable.deletedAt),
  );

  const [
    [invoiceAgg],
    [clientCountRow],
    [invoiceCountRow],
    [quotationCountRow],
    [invoiceMonthStats],
    [clientMonthStats],
    monthlyRows,
    statusRows,
    categoryRows,
    consultantInvoiceRows,
  ] = await Promise.all([
    db
      .select({
        revenue: sql<string>`COALESCE(SUM(${invoicesTable.paidAmount}::numeric), 0)`,
        outstanding: sql<string>`COALESCE(SUM(GREATEST(${invoicesTable.total}::numeric - ${invoicesTable.paidAmount}::numeric, 0)), 0)`,
      })
      .from(invoicesTable)
      .where(invoiceUserFilter),
    db.select({ count: count() }).from(clientsTable).where(clientUserFilter),
    db.select({ count: count() }).from(invoicesTable).where(invoiceUserFilter),
    db
      .select({ count: count() })
      .from(quotationsTable)
      .where(quotationUserFilter),
    db
      .select({
        revenuePaidThisMonth: sql<string>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceDate} >= ${curMonth.start} AND ${invoicesTable.invoiceDate} <= ${curMonth.end} THEN ${invoicesTable.paidAmount}::numeric ELSE 0 END), 0)`,
        revenuePaidPreviousMonth: sql<string>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceDate} >= ${prevMonth.start} AND ${invoicesTable.invoiceDate} <= ${prevMonth.end} THEN ${invoicesTable.paidAmount}::numeric ELSE 0 END), 0)`,
        invoiceCountThisMonth: sql<number>`COUNT(CASE WHEN ${invoicesTable.invoiceDate} >= ${curMonth.start} AND ${invoicesTable.invoiceDate} <= ${curMonth.end} THEN 1 END)::int`,
        invoiceCountPreviousMonth: sql<number>`COUNT(CASE WHEN ${invoicesTable.invoiceDate} >= ${prevMonth.start} AND ${invoicesTable.invoiceDate} <= ${prevMonth.end} THEN 1 END)::int`,
      })
      .from(invoicesTable)
      .where(invoiceUserFilter),
    db
      .select({
        clientCountThisMonth: sql<number>`COUNT(CASE WHEN ${clientsTable.createdAt} >= ${curMonthStart} AND ${clientsTable.createdAt} < ${nextMonthStart} THEN 1 END)::int`,
        clientCountPreviousMonth: sql<number>`COUNT(CASE WHEN ${clientsTable.createdAt} >= ${prevMonthStart} AND ${clientsTable.createdAt} < ${curMonthStart} THEN 1 END)::int`,
      })
      .from(clientsTable)
      .where(clientUserFilter),
    db
      .select({
        month: sql<string>`TO_CHAR(${invoicesTable.invoiceDate}, 'YYYY-MM')`,
        revenue: sql<string>`COALESCE(SUM(${invoicesTable.paidAmount}::numeric), 0)`,
      })
      .from(invoicesTable)
      .where(invoiceUserFilter)
      .groupBy(sql`TO_CHAR(${invoicesTable.invoiceDate}, 'YYYY-MM')`),
    db
      .select({
        status: invoicesTable.status,
        count: count(),
      })
      .from(invoicesTable)
      .where(invoiceUserFilter)
      .groupBy(invoicesTable.status),
    db
      .select({
        serviceCategory: invoicesTable.serviceCategory,
        revenue: sql<string>`COALESCE(SUM(${invoicesTable.paidAmount}::numeric), 0)`,
      })
      .from(invoicesTable)
      .where(invoiceUserFilter)
      .groupBy(invoicesTable.serviceCategory),
    db
      .select({
        invoiceId: invoicesTable.id,
        invoiceDate: invoicesTable.invoiceDate,
        paidAmount: invoicesTable.paidAmount,
        consultantId: invoiceConsultantsTable.consultantId,
      })
      .from(invoiceConsultantsTable)
      .innerJoin(
        invoicesTable,
        eq(invoiceConsultantsTable.invoiceId, invoicesTable.id),
      )
      .where(invoiceUserFilter),
  ]);

  // Revenue splits evenly across an invoice's consultants; count consultants
  // per invoice first (one join row per consultant) before dividing.
  const consultantCountByInvoice = new Map<string, number>();
  for (const row of consultantInvoiceRows) {
    consultantCountByInvoice.set(
      row.invoiceId,
      (consultantCountByInvoice.get(row.invoiceId) ?? 0) + 1,
    );
  }
  const consultantPaidTotals = new Map<string, number>();
  const consultantMonthlyPaidTotals = new Map<string, number>();
  for (const row of consultantInvoiceRows) {
    const share =
      toNumber(row.paidAmount) /
      (consultantCountByInvoice.get(row.invoiceId) ?? 1);
    consultantPaidTotals.set(
      row.consultantId,
      (consultantPaidTotals.get(row.consultantId) ?? 0) + share,
    );
    const month = row.invoiceDate.slice(0, 7);
    const monthlyKey = `${row.consultantId}:${month}`;
    consultantMonthlyPaidTotals.set(
      monthlyKey,
      (consultantMonthlyPaidTotals.get(monthlyKey) ?? 0) + share,
    );
  }
  const consultantIdsAttributed = Array.from(consultantPaidTotals.keys());
  const consultantRows =
    consultantIdsAttributed.length > 0
      ? await db
          .select({ id: consultantsTable.id, name: consultantsTable.name })
          .from(consultantsTable)
          .where(inArray(consultantsTable.id, consultantIdsAttributed))
      : [];
  const consultantNameById = new Map(consultantRows.map((r) => [r.id, r.name]));
  const consultantRevenue = consultantIdsAttributed
    .map((consultantId) => ({
      consultantId,
      name: consultantNameById.get(consultantId) ?? "Unknown consultant",
      revenue: consultantPaidTotals.get(consultantId) ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
  const consultantMonthlyRevenue = Array.from(
    consultantMonthlyPaidTotals.entries(),
  )
    .map(([key, revenue]) => {
      const separator = key.lastIndexOf(":");
      const consultantId = key.slice(0, separator);
      return {
        consultantId,
        name: consultantNameById.get(consultantId) ?? "Unknown consultant",
        month: key.slice(separator + 1),
        revenue,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month) || b.revenue - a.revenue);

  const categoryRevenueByKey = new Map(
    categoryRows.map((row) => [
      normalizeServiceCategory(row.serviceCategory),
      toNumber(row.revenue),
    ]),
  );
  const serviceCategoryRevenue = SERVICE_CATEGORIES.map((serviceCategory) => ({
    serviceCategory,
    name: SERVICE_CATEGORY_LABELS[serviceCategory],
    revenue: categoryRevenueByKey.get(serviceCategory) ?? 0,
  }));

  const data = GetDashboardResponse.parse({
    revenue: toNumber(invoiceAgg?.revenue),
    outstanding: toNumber(invoiceAgg?.outstanding),
    invoiceCount: invoiceCountRow?.count ?? 0,
    quotationCount: quotationCountRow?.count ?? 0,
    clientCount: clientCountRow?.count ?? 0,
    revenuePaidThisMonth: toNumber(invoiceMonthStats?.revenuePaidThisMonth),
    revenuePaidPreviousMonth: toNumber(
      invoiceMonthStats?.revenuePaidPreviousMonth,
    ),
    invoiceCountThisMonth: invoiceMonthStats?.invoiceCountThisMonth ?? 0,
    invoiceCountPreviousMonth:
      invoiceMonthStats?.invoiceCountPreviousMonth ?? 0,
    clientCountThisMonth: clientMonthStats?.clientCountThisMonth ?? 0,
    clientCountPreviousMonth: clientMonthStats?.clientCountPreviousMonth ?? 0,
    monthlyRevenue: monthlyRows.map((row) => ({
      month: row.month,
      revenue: toNumber(row.revenue),
    })),
    invoiceStatusBreakdown: statusRows.map((row) => ({
      status: row.status,
      count: row.count,
    })),
    serviceCategoryRevenue,
    consultantRevenue,
    consultantMonthlyRevenue,
  });
  res.json(data);
});

const ACTIVITY_FEED_LIMIT = 12;

router.get("/activity", async (req, res) => {
  const userId = scopedDataUserId(req);
  const dataMode = await currentDataMode();
  const [invoices, quotations, payments] = await Promise.all([
    db
      .select()
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.userId, userId),
          eq(invoicesTable.dataMode, dataMode),
          isNull(invoicesTable.deletedAt),
        ),
      )
      .orderBy(desc(invoicesTable.createdAt))
      .limit(ACTIVITY_FEED_LIMIT),
    db
      .select()
      .from(quotationsTable)
      .where(
        and(
          eq(quotationsTable.userId, userId),
          eq(quotationsTable.dataMode, dataMode),
          isNull(quotationsTable.deletedAt),
        ),
      )
      .orderBy(desc(quotationsTable.createdAt))
      .limit(ACTIVITY_FEED_LIMIT),
    db
      .select()
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.userId, userId),
          eq(paymentsTable.dataMode, dataMode),
          isNull(paymentsTable.deletedAt),
        ),
      )
      .orderBy(desc(paymentsTable.createdAt))
      .limit(ACTIVITY_FEED_LIMIT),
  ]);
  const data = ListActivityResponse.parse(
    [
      ...invoices.map((invoice) => ({
        id: invoice.id,
        type: "invoice",
        title: `Invoice ${invoice.invoiceNumber}`,
        detail: `${invoice.status} · ${invoice.currency} ${toNumber(invoice.total).toLocaleString()}`,
        createdAt: invoice.createdAt.toISOString(),
      })),
      ...quotations.map((quotation) => ({
        id: quotation.id,
        type: "quotation",
        title: `Quotation ${quotation.quotationNumber}`,
        detail: `${quotation.status} · ${quotation.currency} ${toNumber(quotation.total).toLocaleString()}`,
        createdAt: quotation.createdAt.toISOString(),
      })),
      ...payments.map((payment) => ({
        id: payment.id,
        type: "payment",
        title: `Payment ${payment.paymentMethod.replace("_", " ")}`,
        detail: `HKD ${toNumber(payment.amount).toLocaleString()} received`,
        createdAt: payment.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12),
  );
  res.json(data);
});

export default router;
