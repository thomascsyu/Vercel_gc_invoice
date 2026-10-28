import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  apiGetInvoiceContinuity,
  type InvoiceContinuityReport,
  type MissingSequenceSlot,
  type MonthContinuity,
} from "@/lib/modulesApi";
import { describeApiFailure } from "@/lib/describeApiFailure";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  AlertCircle,
  CheckCircle2,
  ListChecks,
  RefreshCw,
} from "lucide-react";

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

function formatMonth(month: string): string {
  if (month === "unknown") return "Unparsed / unknown month";
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return monthFormatter.format(new Date(year, monthNumber - 1, 1));
}

function formatMissingSlot(slot: MissingSequenceSlot): string {
  if (!slot.alternates?.length) return slot.likelyNumber;
  return `${slot.likelyNumber} (or ${slot.alternates.join(", ")})`;
}

function filterReport(
  report: InvoiceContinuityReport,
  year: string,
): InvoiceContinuityReport {
  if (year === "all") return report;
  const months = report.months.filter((month) => month.month.startsWith(year));
  const missingNumbers = months.flatMap((month) => month.missingNumbers);
  const missingSequenceSlots = report.missingSequenceSlots.filter((slot) =>
    slot.likelyNumber.startsWith(year.slice(2)),
  );
  const voidedInvoices = months.flatMap((month) => month.voidedInvoices);
  return {
    ...report,
    months,
    lastInvoiceNumberByMonth: Object.fromEntries(
      months.map((month) => [month.month, month.lastInvoiceNumber]),
    ),
    missingNumbers,
    missingSequenceSlots,
    voidedInvoices,
    intact: missingNumbers.length === 0,
  };
}

function MonthRow({ month }: { month: MonthContinuity }) {
  const hasGaps = month.missingNumbers.length > 0;
  const hasVoided = month.voidedInvoices.length > 0;
  return (
    <TableRow>
      <TableCell className="font-medium">{formatMonth(month.month)}</TableCell>
      <TableCell className="font-mono text-xs sm:text-sm">
        {month.lastInvoiceNumber ?? "—"}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{month.invoiceCount}</TableCell>
      <TableCell>
        {hasGaps ? (
          <span className="font-mono text-xs text-destructive">{month.missingNumbers.join(", ")}</span>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell>
        {hasVoided ? (
          <div className="space-y-1">
            {month.voidedInvoices.map((invoice) => (
              <div key={`${invoice.id ?? invoice.invoiceNumber}`} className="font-mono text-xs">
                {invoice.invoiceNumber}
                {invoice.cancellationReason ? (
                  <span className="ml-1 font-sans text-muted-foreground">
                    ({invoice.cancellationReason})
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function InvoiceContinuityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [year, setYear] = useState("all");
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["/invoices/continuity"],
    queryFn: apiGetInvoiceContinuity,
    enabled: open,
  });

  const years = useMemo(() => {
    const values = new Set<string>(
      (data?.months ?? [])
        .map((month: MonthContinuity) => month.month.slice(0, 4))
        .filter((value: string) => /^\d{4}$/.test(value)),
    );
    return [...values].sort((a, b) => b.localeCompare(a));
  }, [data]);

  const report = useMemo(
    () => (data ? filterReport(data, year) : null),
    [data, year],
  );

  const hasWarnings =
    !!report &&
    (report.duplicateSequenceSlots.length > 0 ||
      report.duplicateBaseNumbers.length > 0 ||
      report.reissuedNumbers.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-muted-foreground" aria-hidden />
            Invoice continuity
          </DialogTitle>
          <DialogDescription>
            Final invoice number for each month, gaps in the global sequence counter, and voided
            (soft-deleted) invoices. Permanently purged invoices are removed from this check and
            may appear as missing numbers. Custom imported numbers are excluded from the sequence
            check.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {years.length > 0 && (
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-8 w-[140px] text-sm" aria-label="Reporting year">
                <SelectValue placeholder="All years" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Recheck
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3 py-2" aria-label="Loading invoice continuity">
            <div className="h-16 animate-pulse rounded-md bg-muted" />
            <div className="h-40 animate-pulse rounded-md bg-muted" />
          </div>
        ) : isError ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-destructive">{describeApiFailure(error)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : report && report.months.length === 0 && report.unparsedInvoiceNumbers.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No invoices to verify.
          </p>
        ) : report ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <Alert variant={report.intact ? "default" : "destructive"}>
              {report.intact ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {report.intact ? (
                    <span>Sequence is intact for the selected period.</span>
                  ) : (
                    <span>
                      {report.missingSequenceSlots.length} missing sequence slot
                      {report.missingSequenceSlots.length === 1 ? "" : "s"}.
                    </span>
                  )}
                  <Badge variant={report.voidedInvoices.length ? "secondary" : "outline"}>
                    {report.voidedInvoices.length} voided
                  </Badge>
                  {report.reissuedNumbers.length > 0 && (
                    <Badge variant="secondary">
                      {report.reissuedNumbers.length} reissued
                    </Badge>
                  )}
                </div>
                {!report.intact && report.missingSequenceSlots.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
                    {report.missingSequenceSlots.map((slot) => (
                      <li key={slot.sequence}>{formatMissingSlot(slot)}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>

            {hasWarnings && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="space-y-2 text-sm">
                  {report.reissuedNumbers.length > 0 && (
                    <div>
                      <span className="font-medium">Reissued after void: </span>
                      <span className="font-mono text-xs">
                        {report.reissuedNumbers.map((row) => row.invoiceNumber).join(", ")}
                      </span>
                    </div>
                  )}
                  {report.duplicateSequenceSlots.length > 0 && (
                    <div>
                      <span className="font-medium">Duplicate sequence indices: </span>
                      <span className="font-mono text-xs">
                        {report.duplicateSequenceSlots
                          .map((row) => `#${row.sequence} (${row.baseNumbers.join(" / ")})`)
                          .join("; ")}
                      </span>
                    </div>
                  )}
                  {report.duplicateBaseNumbers.length > 0 && (
                    <div>
                      <span className="font-medium">Duplicate base numbers: </span>
                      <span className="font-mono text-xs">
                        {report.duplicateBaseNumbers.map((row) => row.baseNumber).join(", ")}
                      </span>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Last invoice</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Missing</TableHead>
                  <TableHead>Voided</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.months.map((month) => (
                  <MonthRow key={month.month} month={month} />
                ))}
              </TableBody>
            </Table>

            {data && data.unparsedInvoiceNumbers.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Custom numbers excluded from the sequence check:{" "}
                <span className="font-mono">{data.unparsedInvoiceNumbers.join(", ")}</span>
              </p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
