import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Invoice, Quotation } from "@workspace/api-client-react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

const HISTORY_YEARS = 4;
const HISTORY_PAGE_SIZE = 500;

type ListResponse<T> = { data: T[]; total: number };

function historyDateFrom() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - HISTORY_YEARS);
  return d.toISOString().slice(0, 10);
}

const invoiceStatusColor = (status: string) => {
  switch (status) {
    case "paid": return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
    case "approved": return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
    case "sent": return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
    case "revised": return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
    case "pending_approval": return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
    case "draft": return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20";
    default: return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20";
  }
};

const quotationStatusColor = (status: string) => {
  switch (status) {
    case "invoiced": return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
    case "confirmed": return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20";
    case "approved": return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
    case "sent": return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
    case "skip": return "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20";
    case "pending_approval": return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
    case "canceled": return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
    default: return "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20";
  }
};

function StatusBadge({ status, colorClass }: { status: string; colorClass: string }) {
  return (
    <Badge variant="outline" className={cn("uppercase text-[9px] tracking-wider px-1.5 py-0", colorClass)}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function HistoryRow({
  number,
  date,
  amount,
  currency,
  status,
  colorClass,
  highlight,
}: {
  number: string;
  date: string;
  amount: number;
  currency: string;
  status: string;
  colorClass: string;
  highlight?: boolean;
}) {
  return (
    <li
      className={cn(
        "rounded-md border px-2.5 py-2 text-xs",
        highlight ? "border-primary/50 bg-primary/5" : "bg-background",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-medium truncate" title={number}>{number}</span>
        <StatusBadge status={status} colorClass={colorClass} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-muted-foreground">
        <span>{formatDate(date)}</span>
        <span className="font-semibold tabular-nums text-foreground">{formatCurrency(amount, currency)}</span>
      </div>
    </li>
  );
}

function HistoryState({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{children}</p>;
}

type Props = {
  clientId: string;
  /** The quotation being edited, highlighted in the list. */
  currentQuotationId?: string;
};

/** Selected client's invoices and quotations from the last four years, shown beside the quotation editor. */
export function ClientHistoryPanel({ clientId, currentQuotationId }: Props) {
  const dateFrom = historyDateFrom();
  const enabled = Boolean(clientId);

  const invoicesQuery = useQuery({
    queryKey: ["client-history", "invoices", clientId, dateFrom],
    enabled,
    queryFn: () =>
      customFetch<ListResponse<Invoice>>(
        `/api/invoices?${new URLSearchParams({
          clientId,
          dateFrom,
          sortBy: "invoiceDate",
          sortDir: "desc",
          pageSize: String(HISTORY_PAGE_SIZE),
        })}`,
      ),
  });

  const quotationsQuery = useQuery({
    queryKey: ["client-history", "quotations", clientId, dateFrom],
    enabled,
    queryFn: () =>
      customFetch<ListResponse<Quotation>>(
        `/api/quotations?${new URLSearchParams({
          clientId,
          sortBy: "quotationDate",
          sortDir: "desc",
          pageSize: String(HISTORY_PAGE_SIZE),
        })}`,
      ),
    // The quotations list has no date filter, so trim to the window here.
    select: (res) => res.data.filter((q) => q.quotationDate >= dateFrom),
  });

  const invoices = invoicesQuery.data?.data ?? [];
  const quotations = quotationsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        Client history
        <span className="font-normal text-xs">(last {HISTORY_YEARS} years)</span>
      </div>
      {!enabled ? (
        <HistoryState>Select a client to see their invoices and quotations.</HistoryState>
      ) : (
        <Tabs defaultValue="invoices">
          <TabsList className="grid w-full grid-cols-2 h-8">
            <TabsTrigger value="invoices" className="text-xs">
              Invoices{invoicesQuery.isSuccess ? ` (${invoices.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="quotations" className="text-xs">
              Quotations{quotationsQuery.isSuccess ? ` (${quotations.length})` : ""}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="invoices" className="mt-2">
            {invoicesQuery.isLoading ? (
              <HistoryState>Loading invoices…</HistoryState>
            ) : invoicesQuery.isError ? (
              <HistoryState>Could not load invoices.</HistoryState>
            ) : invoices.length === 0 ? (
              <HistoryState>No invoices in the last {HISTORY_YEARS} years.</HistoryState>
            ) : (
              <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                {invoices.map((inv) => (
                  <HistoryRow
                    key={inv.id}
                    number={inv.invoiceNumber}
                    date={inv.invoiceDate}
                    amount={inv.total}
                    currency={inv.currency}
                    status={inv.status}
                    colorClass={invoiceStatusColor(inv.status)}
                  />
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="quotations" className="mt-2">
            {quotationsQuery.isLoading ? (
              <HistoryState>Loading quotations…</HistoryState>
            ) : quotationsQuery.isError ? (
              <HistoryState>Could not load quotations.</HistoryState>
            ) : quotations.length === 0 ? (
              <HistoryState>No quotations in the last {HISTORY_YEARS} years.</HistoryState>
            ) : (
              <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                {quotations.map((q) => {
                  const status = q.convertedInvoiceId ? "invoiced" : q.status;
                  return (
                    <HistoryRow
                      key={q.id}
                      number={q.quotationNumber}
                      date={q.quotationDate}
                      amount={q.total}
                      currency={q.currency}
                      status={status}
                      colorClass={quotationStatusColor(status)}
                      highlight={q.id === currentQuotationId}
                    />
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
