import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  MessageSquare,
  Plus,
  RefreshCw,
  ScrollText,
  Send,
  Shield,
  TrendingUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import {
  apiGetProposalsDashboard,
  type ProposalStatus,
  type ProposalsDashboardActivityItem,
  type ProposalsDashboardAttentionItem,
  type ProposalsDashboardExpiringItem,
} from "@/lib/proposals-api";
import { eventLabel, formatLabel, statusBadge } from "@/lib/proposal-shared";

const PIPELINE_ORDER: ProposalStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "confirmed",
  "revision_requested",
  "no_response",
];

function pctDelta(prev: number, cur: number): string | null {
  if (prev === 0 && cur === 0) return null;
  if (prev === 0) return "vs prev month · new";
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

function activityIcon(eventType: string) {
  if (eventType === "confirmed") return CheckCircle2;
  if (eventType === "question_raised") return MessageSquare;
  if (eventType === "sent") return Send;
  if (eventType === "revision_requested") return RefreshCw;
  return FileSignature;
}

type ProposalsDashboardPanelProps = {
  onFilterStatus: (status: ProposalStatus | "") => void;
  onOpenProposal: (id: string) => void;
  onViewList: () => void;
};

export function ProposalsDashboardPanel({
  onFilterStatus,
  onOpenProposal,
  onViewList,
}: ProposalsDashboardPanelProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["proposals-dashboard"],
    queryFn: apiGetProposalsDashboard,
  });

  const chartData = useMemo(() => {
    if (!data?.statusBreakdown?.length) return [];
    const byStatus = new Map(data.statusBreakdown.map((row) => [row.status, row]));
    return PIPELINE_ORDER.map((status) => {
      const row = byStatus.get(status);
      return {
        status,
        name: formatLabel(status),
        count: row?.count ?? 0,
        value: row?.value ?? 0,
      };
    }).filter((row) => row.count > 0);
  }, [data]);

  const isoChartData = useMemo(() => {
    if (!data?.isoBreakdown?.length) return [];
    return data.isoBreakdown.map((row) => ({
      standard: row.standard,
      name: row.standard.length > 22 ? `${row.standard.slice(0, 20)}…` : row.standard,
      fullName: row.standard,
      count: row.count,
      value: row.value,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
        <div className="h-48 bg-muted animate-pulse rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 h-64 bg-muted animate-pulse rounded-xl" />
          <div className="lg:col-span-5 h-64 bg-muted animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="border-destructive/30 bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Could not load proposal pipeline
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

  const pipelineDelta = pctDelta(
    data.pipelineCountPreviousMonth ?? 0,
    data.pipelineCountThisMonth ?? 0,
  );
  const confirmedDelta = pctDelta(
    data.confirmedCountPreviousMonth ?? 0,
    data.confirmedCountThisMonth ?? 0,
  );

  const statCards = [
    {
      key: "pipeline",
      label: "Active pipeline",
      value: String(data.pipelineCount),
      sub: formatCurrency(data.pipelineValue, "HKD"),
      delta: pipelineDelta,
      icon: ScrollText,
      filter: "" as const,
    },
    {
      key: "pending",
      label: "Awaiting approval",
      value: String(data.pendingApprovalCount),
      sub: "Click to review",
      delta: null,
      icon: ClipboardCheck,
      filter: "pending_approval" as const,
    },
    {
      key: "sent",
      label: "With clients",
      value: String(data.sentCount),
      sub: "Awaiting response",
      delta: null,
      icon: Send,
      filter: "sent" as const,
    },
    {
      key: "confirmed",
      label: "Confirmed",
      value: String(data.confirmedCount),
      sub: formatCurrency(data.confirmedValue, "HKD"),
      delta: confirmedDelta,
      icon: CheckCircle2,
      filter: "confirmed" as const,
    },
  ];

  if (data.totalCount === 0) {
    return (
      <div className="space-y-6">
        <DashboardHeader />
        <Card className="bg-card border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="rounded-full bg-primary/10 p-4 text-primary">
              <ScrollText className="h-8 w-8" aria-hidden />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="text-lg font-semibold">No proposals yet</h3>
              <p className="text-sm text-muted-foreground">
                Create your first ISO consulting proposal to start tracking your pipeline here.
              </p>
            </div>
            <Button asChild>
              <Link href="/proposals/new">
                <Plus className="mr-2 h-4 w-4" />
                New proposal
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardHeader />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                onFilterStatus(card.filter);
                onViewList();
              }}
              className="text-left rounded-xl border bg-card p-0 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
            >
              <Card className="border-0 shadow-none bg-transparent">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                  <Icon className="h-4 w-4 text-primary" aria-hidden />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tabular-nums">{card.value}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{card.sub}</p>
                  {card.delta ? <p className="mt-1 text-xs text-muted-foreground/80">{card.delta}</p> : null}
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" aria-hidden />
            Pipeline value by ISO standard
          </CardTitle>
          <CardDescription>
            Active pipeline proposals grouped by certification standard (multi-standard proposals count toward each).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isoChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ISO standards assigned in the active pipeline yet.</p>
          ) : (
            <div
              className="w-full max-h-[420px] min-h-[160px]"
              style={{ height: Math.min(420, Math.max(160, isoChartData.length * 44)) }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={isoChartData}
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  accessibilityLayer
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => formatCurrency(Number(v), "HKD")}
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
                    formatter={(value: number, _name, payload) => {
                      const row = payload?.payload as { count?: number } | undefined;
                      const count = row?.count ?? 0;
                      return [
                        `${formatCurrency(value, "HKD")} · ${count} proposal${count === 1 ? "" : "s"}`,
                        "Pipeline value",
                      ];
                    }}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullName != null ? String(payload[0].payload.fullName) : ""
                    }
                  />
                  <Bar
                    dataKey="value"
                    name="Value"
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

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7 bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" aria-hidden />
              Pipeline by status
            </CardTitle>
            <CardDescription>Click a bar to filter the proposal list.</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No proposals in the pipeline yet.</p>
            ) : (
              <div className="h-[260px] w-full" role="img" aria-label="Bar chart of proposal counts by status">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                      formatter={(value: number, _name, payload) => {
                        const row = payload?.payload as { value?: number } | undefined;
                        return [
                          `${value} proposal${value === 1 ? "" : "s"} · ${formatCurrency(row?.value ?? 0, "HKD")}`,
                          "Count",
                        ];
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="Proposals"
                      fill="hsl(var(--chart-1))"
                      radius={[4, 4, 0, 0]}
                      className="cursor-pointer"
                      isAnimationActive={!prefersReducedMotion}
                      onClick={(bar) => {
                        const status = (bar as { payload?: { status?: ProposalStatus } }).payload?.status;
                        if (status) {
                          onFilterStatus(status);
                          onViewList();
                        }
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-5 bg-card">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Proposals that need your next action.</CardDescription>
          </CardHeader>
          <CardContent>
            <AttentionList items={data.needsAttention} onOpenProposal={onOpenProposal} />
          </CardContent>
        </Card>
      </div>

      {data.expiringSoon.length > 0 ? (
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" aria-hidden />
              Expiring soon
            </CardTitle>
            <CardDescription>Proposals reaching their validity end date within 14 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <ExpiringList items={data.expiringSoon} onOpenProposal={onOpenProposal} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-5 bg-card">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest client and staff actions across proposals.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityList items={data.recentActivity} onOpenProposal={onOpenProposal} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-7 bg-card">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Recently updated</CardTitle>
              <CardDescription>Latest changes across your proposals.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onViewList}>
              View all
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {data.recentProposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No proposals yet.</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {data.recentProposals.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenProposal(item.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.proposalNo}
                        {item.clientName ? ` · ${item.clientName}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(item.totalAmount, item.currency)} ·{" "}
                        <time dateTime={item.updatedAt}>
                          {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
                        </time>
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("capitalize shrink-0", statusBadge(item.status))}>
                      {formatLabel(item.status)}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashboardHeader() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Pipeline overview</h2>
        <p className="text-muted-foreground text-sm">Track proposal status, value, and client activity at a glance.</p>
      </div>
    </div>
  );
}

function AttentionList({
  items,
  onOpenProposal,
}: {
  items: ProposalsDashboardAttentionItem[];
  onOpenProposal: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>;
  }

  return (
    <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpenProposal(item.id)}
          className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <div className="rounded-full bg-primary/10 p-2 text-primary mt-0.5 shrink-0">
            <AlertCircle className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-none">
              {item.proposalNo}
              {item.clientName ? ` · ${item.clientName}` : ""}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
            <p className="mt-1 text-xs text-muted-foreground/80">
              {formatCurrency(item.totalAmount, item.currency)} ·{" "}
              <time dateTime={item.updatedAt}>
                {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
              </time>
            </p>
          </div>
          <Badge variant="outline" className={cn("capitalize shrink-0", statusBadge(item.status))}>
            {formatLabel(item.status)}
          </Badge>
        </button>
      ))}
    </div>
  );
}

function ExpiringList({
  items,
  onOpenProposal,
}: {
  items: ProposalsDashboardExpiringItem[];
  onOpenProposal: (id: string) => void;
}) {
  return (
    <div className="divide-y rounded-lg border">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpenProposal(item.id)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {item.proposalNo}
              {item.clientName ? ` · ${item.clientName}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(item.totalAmount, item.currency)}
              {item.validUntil ? ` · Valid until ${item.validUntil}` : ""}
            </p>
          </div>
          <Badge variant="outline" className={cn("capitalize shrink-0", statusBadge(item.status))}>
            {formatLabel(item.status)}
          </Badge>
        </button>
      ))}
    </div>
  );
}

function ActivityList({
  items,
  onOpenProposal,
}: {
  items: ProposalsDashboardActivityItem[];
  onOpenProposal: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No recent activity.</p>;
  }

  return (
    <div className="space-y-6 max-h-[360px] overflow-y-auto pr-1">
      {items.map((item) => {
        const Icon = activityIcon(item.eventType);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenProposal(item.proposalId)}
            className="flex w-full items-start gap-4 text-left transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md cursor-pointer"
          >
            <div className="rounded-full bg-primary/10 p-2 text-primary mt-0.5 shrink-0">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-medium leading-none">
                {item.proposalNo}
                {item.clientName ? ` · ${item.clientName}` : ""}
              </p>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {eventLabel(item.eventType, item.eventData)}
              </p>
              <p className="text-xs text-muted-foreground/80">
                <time dateTime={item.createdAt}>
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                </time>
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
