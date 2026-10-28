import { useMemo, useState } from "react";
import {
  useGetDashboard,
  getGetDashboardQueryKey,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { apiGetSettings } from "@/lib/modulesApi";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "short" });

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthFormatter.format(new Date(year, monthNumber - 1, 1));
}

export default function ConsultantPerformancePage() {
  const [selectedYear, setSelectedYear] = useState(
    String(new Date().getFullYear()),
  );
  const { data: settings } = useQuery({
    queryKey: ["/company-settings"],
    queryFn: apiGetSettings,
  });
  const { data, isLoading, isError, isFetching, refetch } = useGetDashboard({
    query: { queryKey: getGetDashboardQueryKey() },
  });
  const currency = settings?.defaultCurrency ?? "HKD";

  const years = useMemo(() => {
    const available = new Set(
      (data?.consultantMonthlyRevenue ?? []).map((item) =>
        item.month.slice(0, 4),
      ),
    );
    available.add(String(new Date().getFullYear()));
    return [...available].sort((a, b) => b.localeCompare(a));
  }, [data]);

  const report = useMemo(() => {
    const entries = (data?.consultantMonthlyRevenue ?? []).filter((item) =>
      item.month.startsWith(selectedYear),
    );
    const consultants = new Map<string, { name: string; months: number[] }>();
    for (const entry of entries) {
      const row = consultants.get(entry.consultantId) ?? {
        name: entry.name,
        months: Array(12).fill(0),
      };
      row.months[Number(entry.month.slice(5, 7)) - 1] += entry.revenue;
      consultants.set(entry.consultantId, row);
    }
    const rows = [...consultants.entries()]
      .map(([id, row]) => ({
        id,
        ...row,
        total: row.months.reduce((sum, value) => sum + value, 0),
      }))
      .sort((a, b) => b.total - a.total);
    return { rows, total: rows.reduce((sum, row) => sum + row.total, 0) };
  }, [data, selectedYear]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <TrendingUp className="h-4 w-4" aria-hidden /> Consultants ·
            Performance
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Monthly consultant revenue
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paid invoice revenue, divided equally when more than one consultant
            is assigned.
          </p>
        </div>
        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Reporting year">
            <CalendarDays className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={year}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
          <CardHeader className="pb-2">
            <CardDescription>
              Attributed revenue · {selectedYear}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-end justify-between gap-3">
            <div className="text-3xl font-bold tabular-nums">
              {formatCurrency(report.total, currency)}
            </div>
            <BarChart3 className="h-8 w-8 text-primary/60" aria-hidden />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Consultants with revenue</CardDescription>
          </CardHeader>
          <CardContent className="flex items-end justify-between gap-3">
            <div className="text-3xl font-bold tabular-nums">
              {report.rows.length}
            </div>
            <Users className="h-8 w-8 text-muted-foreground/50" aria-hidden />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by month</CardTitle>
          <CardDescription>
            Scroll horizontally to compare all twelve months.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div
              className="h-40 animate-pulse rounded-lg bg-muted"
              aria-label="Loading consultant performance"
            />
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                Consultant performance could not be loaded.
              </p>
              <Button
                variant="outline"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                />{" "}
                Retry
              </Button>
            </div>
          ) : report.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center">
              <BarChart3
                className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50"
                aria-hidden
              />
              <p className="font-medium">
                No attributed revenue in {selectedYear}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Assign consultants to paid invoices to populate this report.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[1180px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 min-w-48 bg-card">
                      Consultant
                    </TableHead>
                    {Array.from({ length: 12 }, (_, month) => (
                      <TableHead key={month} className="text-right">
                        {monthLabel(
                          `${selectedYear}-${String(month + 1).padStart(2, "0")}`,
                        )}
                      </TableHead>
                    ))}
                    <TableHead className="text-right font-bold">
                      Total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="sticky left-0 z-10 bg-card font-medium">
                        {row.name}
                      </TableCell>
                      {row.months.map((value, month) => (
                        <TableCell
                          key={month}
                          className="text-right tabular-nums text-muted-foreground"
                        >
                          {value ? formatCurrency(value, currency) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(row.total, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
