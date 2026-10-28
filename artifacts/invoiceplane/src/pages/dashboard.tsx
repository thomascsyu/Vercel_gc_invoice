import { useEffect, useMemo, useState } from "react";
import {
  useGetDashboard,
  useListActivity,
  getGetDashboardQueryKey,
  getListActivityQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { apiGetSettings } from "@/lib/modulesApi";
import {
  CreditCard,
  FileSignature,
  FileText,
  Users,
  TrendingUp,
  AlertCircle,
  RefreshCw,
  UserCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

function pctDelta(prev: number, cur: number): string | null {
  if (prev === 0 && cur === 0) return null;
  if (prev === 0) return "vs prev · new";
  const pct = ((cur - prev) / prev) * 100;
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}% vs prev month`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

export default function Dashboard() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const {
    data: dashboard,
    isLoading: isDashboardLoading,
    isError: isDashboardError,
    refetch,
    isFetching,
  } = useGetDashboard({
    query: { queryKey: getGetDashboardQueryKey() },
  });

  const { data: activities, isLoading: isActivityLoading } = useListActivity({
    query: { queryKey: getListActivityQueryKey() },
  });

  const { data: settings } = useQuery({
    queryKey: ["/company-settings"],
    queryFn: apiGetSettings,
  });
  const currency = settings?.defaultCurrency ?? "HKD";

  const statusChartData = useMemo(() => {
    if (!dashboard?.invoiceStatusBreakdown?.length) return [];
    return dashboard.invoiceStatusBreakdown.map((item) => ({
      name: item.status.replace(/_/g, " "),
      count: item.count,
    }));
  }, [dashboard]);

  const consultantChartData = useMemo(() => {
    if (!dashboard?.consultantRevenue?.length) return [];
    return dashboard.consultantRevenue.map((c) => ({
      id: c.consultantId,
      name: c.name.length > 28 ? `${c.name.slice(0, 26)}…` : c.name,
      fullName: c.name,
      revenue: c.revenue,
    }));
  }, [dashboard]);

  if (isDashboardLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-7 h-64 bg-muted animate-pulse rounded-xl" />
          <div className="lg:col-span-5 h-64 bg-muted animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  if (isDashboardError || !dashboard) {
    return (
      <Card className="border-destructive/30 bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Could not load dashboard
          </CardTitle>
          <CardDescription>Check your connection and try again.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const revenueDelta = pctDelta(dashboard.revenuePaidPreviousMonth, dashboard.revenuePaidThisMonth);
  const invoiceDelta = pctDelta(dashboard.invoiceCountPreviousMonth, dashboard.invoiceCountThisMonth);
  const clientDelta = pctDelta(dashboard.clientCountPreviousMonth, dashboard.clientCountThisMonth);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground text-sm">Your business performance at a glance.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/invoices?status=paid" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="bg-card h-full transition-colors hover:bg-muted/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{formatCurrency(dashboard.revenue, currency)}</div>
            {revenueDelta ? (
              <p className="mt-1 text-xs text-muted-foreground">{revenueDelta}</p>
            ) : null}
          </CardContent>
        </Card>
        </Link>

        <Link href="/invoices" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="bg-card h-full transition-colors hover:bg-muted/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Outstanding</CardTitle>
            <CreditCard
              className={cn(
                "h-4 w-4",
                dashboard.outstanding > 0 ? "text-destructive" : "text-muted-foreground",
              )}
              aria-hidden
            />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{formatCurrency(dashboard.outstanding, currency)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Unpaid invoice balance</p>
          </CardContent>
        </Card>
        </Link>

        <Link href="/invoices" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="bg-card h-full transition-colors hover:bg-muted/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Invoices</CardTitle>
            <FileText className="h-4 w-4 text-primary" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{dashboard.invoiceCount}</div>
            {invoiceDelta ? (
              <p className="mt-1 text-xs text-muted-foreground">{invoiceDelta}</p>
            ) : null}
          </CardContent>
        </Card>
        </Link>

        <Link href="/clients" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="bg-card h-full transition-colors hover:bg-muted/40">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Clients</CardTitle>
            <Users className="h-4 w-4 text-primary" aria-hidden />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{dashboard.clientCount}</div>
            {clientDelta ? (
              <p className="mt-1 text-xs text-muted-foreground">{clientDelta}</p>
            ) : null}
          </CardContent>
        </Card>
        </Link>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-primary" aria-hidden />
            Revenue by consultant
          </CardTitle>
          <CardDescription>
            Each invoice&apos;s paid amount is counted toward assigned consultants, split equally (two consultants → 50%
            each; three → one third each).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consultantChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No consultant-attributed revenue yet. Assign consultants on invoices to see attribution here.
            </p>
          ) : (
            <div
              className="w-full max-h-[420px] min-h-[160px]"
              style={{ height: Math.min(420, Math.max(160, consultantChartData.length * 44)) }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={consultantChartData}
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  accessibilityLayer
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => formatCurrency(Number(v), currency)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                  />
                  <RechartsTooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--card))",
                    }}
                    formatter={(value: number) => [formatCurrency(value, currency), "Attributed revenue"]}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullName != null ? String(payload[0].payload.fullName) : ""
                    }
                  />
                  <Bar
                    dataKey="revenue"
                    name="Revenue"
                    fill="hsl(var(--chart-2))"
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={!prefersReducedMotion}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-12">
        <Card className="lg:col-span-7 bg-card">
          <CardHeader>
            <CardTitle>Invoice status</CardTitle>
            <CardDescription>Count by status for all invoices.</CardDescription>
          </CardHeader>
          <CardContent>
            {statusChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <div className="h-[260px] w-full" role="img" aria-label="Bar chart of invoice counts by status">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                    <RechartsTooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--card))",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="Invoices"
                      fill="hsl(var(--chart-1))"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={!prefersReducedMotion}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-5 bg-card">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest actions in your account.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {isActivityLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : !activities || activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity.</p>
              ) : (
                activities.slice(0, 5).map((activity) => (
                <div key={activity.id} className="flex items-start gap-4">
                  <div className="rounded-full bg-primary/10 p-2 text-primary mt-0.5">
                    {activity.type === "invoice" ? (
                      <FileText className="h-4 w-4" aria-hidden />
                    ) : activity.type === "payment" ? (
                      <CreditCard className="h-4 w-4" aria-hidden />
                    ) : activity.type === "client" ? (
                      <Users className="h-4 w-4" aria-hidden />
                    ) : (
                      <FileSignature className="h-4 w-4" aria-hidden />
                    )}
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-medium leading-none">{activity.title}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{activity.detail}</p>
                    <p className="text-xs text-muted-foreground/80">
                      <time dateTime={activity.createdAt}>
                        {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                      </time>
                    </p>
                  </div>
                </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
