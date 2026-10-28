import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListReceipts,
  useCreateReceipt,
  useUpdateReceipt,
  useDeleteReceipt,
  useListInvoices,
  useListClients,
  useEmailReceipt,
  useGetReceiptsStats,
  getListReceiptsQueryKey,
  type Receipt,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  Plus,
  Edit,
  Trash2,
  ReceiptText,
  FileDown,
  Send,
  Search,
  MoreHorizontal,
  Download,
  X,
  CheckCircle,
  Wallet,
  Users,
  FileCheck,
  CalendarDays,
  Landmark,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { PaginationControls } from "@/components/pagination-controls";
import { SortableHeader } from "@/components/sortable-header";
import { EmailDialog } from "@/components/email-dialog";
import { apiBulkDeleteReceipts, apiGetSettings } from "@/lib/modulesApi";
import { apiUrl } from "@/lib/api-base";
import { describeApiFailure } from "@/lib/describeApiFailure";
import { PdfPreviewIframe } from "@/components/pdf-preview-iframe";
import { DeletedItemsDialog } from "@/components/deleted-items-dialog";

const CURRENCIES = ["HKD", "USD", "CNY", "MOP"] as const;

const receiptSchema = z.object({
  invoiceId: z.string().min(1, "Please select an invoice"),
  clientId: z.string().optional(),
  amount: z.coerce.number().min(0, "Amount must be 0 or more"),
  currency: z.enum(CURRENCIES),
  chequeNumber: z.string().optional(),
  chequeDetails: z.string().optional(),
  receiptDate: z.string().min(1, "Receipt date is required"),
  notes: z.string().optional(),
});

type ReceiptFormValues = z.infer<typeof receiptSchema>;

export default function Receipts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [filterClientId, setFilterClientId] = useState(() => {
    const params = new URLSearchParams(searchString);
    return params.get("clientId") ?? "";
  });
  const [sortBy, setSortBy] = useState<string | null>("receiptDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [previewPdfReceipt, setPreviewPdfReceipt] = useState<Receipt | null>(
    null,
  );
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailReceiptId, setEmailReceiptId] = useState<string | null>(null);
  const [emailReceiptNumber, setEmailReceiptNumber] = useState<string | null>(
    null,
  );
  const [emailDefaultTo, setEmailDefaultTo] = useState<string>("");

  const { data: settings } = useQuery({
    queryKey: ["/company-settings"],
    queryFn: apiGetSettings,
  });

  const emailReceiptMutation = useEmailReceipt();

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const clientId = params.get("clientId") ?? "";
    setFilterClientId(clientId);
    setPage(1);
  }, [searchString]);

  const today = new Date().toISOString().slice(0, 10);

  const params = {
    page,
    pageSize,
    ...(search.trim() ? { q: search.trim() } : {}),
    ...(filterClientId ? { clientId: filterClientId } : {}),
    ...(sortBy
      ? {
          sortBy: sortBy as
            | "receiptNumber"
            | "receiptDate"
            | "amount"
            | "createdAt",
          sortDir,
        }
      : {}),
  };

  const {
    data: receiptsPage,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useListReceipts(params, {
    query: { queryKey: getListReceiptsQueryKey(params) },
  });
  const receipts = receiptsPage?.data ?? [];
  const total = receiptsPage?.total ?? 0;

  const { data: invoicesPage } = useListInvoices({ pageSize: 500 });
  const invoices = invoicesPage?.data ?? [];

  const { data: clientsPage } = useListClients({ pageSize: 500 });
  const clients = clientsPage?.data ?? [];

  const createMutation = useCreateReceipt();
  const updateMutation = useUpdateReceipt();
  const deleteMutation = useDeleteReceipt();

  // Statistics — aggregated server-side across all matching receipts, not just
  // the current page (a client-side reduce over `receipts` would silently
  // under-report once there's more than one page of results).
  const statsParams = {
    ...(search.trim() ? { q: search.trim() } : {}),
    ...(filterClientId ? { clientId: filterClientId } : {}),
  };
  const { data: statsResponse } = useGetReceiptsStats(statsParams);
  const stats =
    statsResponse && statsResponse.count > 0
      ? {
          totalAmount: statsResponse.totalAmount,
          uniqueClients: statsResponse.clientCount,
          uniqueInvoices: statsResponse.invoiceCount,
          totalReceipts: statsResponse.count,
        }
      : null;

  // Bulk selection
  const allSelected =
    receipts.length > 0 && receipts.every((r) => bulkIds.has(r.id));
  const someSelected = receipts.some((r) => bulkIds.has(r.id)) && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setBulkIds((prev) => {
        const next = new Set(prev);
        receipts.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setBulkIds((prev) => {
        const next = new Set(prev);
        receipts.forEach((r) => next.add(r.id));
        return next;
      });
    }
  };

  const toggleOne = (id: string) => {
    setBulkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (bulkIds.size === 0) return;
    if (
      confirm(
        `Delete ${bulkIds.size} selected receipt${bulkIds.size > 1 ? "s" : ""}?`,
      )
    ) {
      const ids = Array.from(bulkIds);
      try {
        await apiBulkDeleteReceipts(ids);
        queryClient.invalidateQueries({ queryKey: getListReceiptsQueryKey() });
        setBulkIds(new Set());
        toast({
          title: `${ids.length} receipt${ids.length > 1 ? "s" : ""} deleted`,
        });
      } catch (err) {
        toast({
          title: "Failed to delete selected receipts",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    }
  };

  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      invoiceId: "",
      clientId: "",
      amount: 0,
      currency: "HKD",
      chequeNumber: "",
      chequeDetails: "",
      receiptDate: today,
      notes: "",
    },
  });

  const selectedInvoiceId = form.watch("invoiceId");
  const receiptAmount = form.watch("amount");
  const receiptDate = form.watch("receiptDate");
  const selectedInvoice = invoices.find(
    (invoice) => invoice.id === selectedInvoiceId,
  );
  const receiptPreparation = [
    Boolean(selectedInvoiceId),
    Number(receiptAmount) > 0,
    Boolean(receiptDate),
  ];
  const receiptProgress = Math.round(
    (receiptPreparation.filter(Boolean).length / receiptPreparation.length) *
      100,
  );

  const openCreate = () => {
    setEditing(null);
    form.reset({
      invoiceId: "",
      clientId: "",
      amount: 0,
      currency: "HKD" as const,
      chequeNumber: "",
      chequeDetails: "",
      receiptDate: today,
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (receipt: Receipt) => {
    setEditing(receipt);
    form.reset({
      invoiceId: receipt.invoiceId ?? "",
      clientId: receipt.clientId ?? "",
      amount: receipt.amount,
      currency: receipt.currency,
      chequeNumber: receipt.chequeNumber ?? "",
      chequeDetails: receipt.chequeDetails ?? "",
      receiptDate: receipt.receiptDate,
      notes: receipt.notes ?? "",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const handleInvoiceSelect = (invoiceId: string) => {
    form.setValue("invoiceId", invoiceId, { shouldValidate: true });
    const invoice = invoices.find((inv) => inv.id === invoiceId);
    if (invoice) {
      form.setValue("clientId", invoice.clientId);
      form.setValue("amount", invoice.total);
      form.setValue("currency", invoice.currency);
    }
  };

  const handleSubmit = form.handleSubmit((values) => {
    const payload = {
      invoiceId: values.invoiceId,
      clientId: values.clientId || undefined,
      amount: values.amount,
      currency: values.currency,
      chequeNumber: values.chequeNumber || undefined,
      chequeDetails: values.chequeDetails || undefined,
      receiptDate: values.receiptDate,
      notes: values.notes || undefined,
    };

    const onSuccess = (msg: string) => {
      queryClient.invalidateQueries({ queryKey: getListReceiptsQueryKey() });
      toast({ title: msg });
      closeDialog();
    };
    const onError = (err: Error) =>
      toast({
        title: "Failed",
        description: err.message,
        variant: "destructive",
      });

    if (editing) {
      updateMutation.mutate(
        { id: editing.id, data: payload },
        { onSuccess: () => onSuccess("Receipt updated"), onError },
      );
    } else {
      createMutation.mutate(
        { data: payload },
        { onSuccess: () => onSuccess("Receipt created"), onError },
      );
    }
  });

  const handleDownloadPdf = (id: string, receiptNumber: string) => {
    const url = apiUrl(`/receipts/${id}/pdf`);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${receiptNumber}.pdf`;
    a.click();
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this receipt?")) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getListReceiptsQueryKey(),
            });
            toast({ title: "Receipt deleted" });
          },
          onError: (err: Error) =>
            toast({
              title: "Failed to delete receipt",
              description: err.message,
              variant: "destructive",
            }),
        },
      );
    }
  };

  const openEmailDialog = (receipt: Receipt) => {
    setEmailReceiptId(receipt.id);
    setEmailReceiptNumber(receipt.receiptNumber);
    const client = clients.find((c) => c.id === receipt.clientId);
    setEmailDefaultTo(client?.email ?? "");
    setEmailDialogOpen(true);
  };

  const handleSendEmail = async (params: {
    to: string;
    slot: 1 | 2;
    cc?: string;
    bcc?: string;
  }) => {
    if (!emailReceiptId) return;

    try {
      await emailReceiptMutation.mutateAsync({
        id: emailReceiptId,
        data: params,
      });
      toast({
        title: "Receipt sent",
        description: `Email sent to ${params.to}`,
      });
      setEmailDialogOpen(false);
      setEmailReceiptId(null);
    } catch (err) {
      toast({
        title: "Failed to send email",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Receipts</h2>
          <p className="text-muted-foreground text-sm hidden sm:block">
            Issue and manage payment receipts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeletedOpen(true)}
            title="Deleted receipts"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> New Receipt
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-emerald-50/50 to-teal-50/50 dark:from-emerald-950/20 dark:to-teal-950/20 border-emerald-200/50 dark:border-emerald-800/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Total Amount
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                {formatCurrency(stats.totalAmount, "HKD")}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200/50 dark:border-blue-800/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Receipts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                {stats.totalReceipts}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50/50 to-violet-50/50 dark:from-purple-950/20 dark:to-violet-950/20 border-purple-200/50 dark:border-purple-800/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                Clients
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-700 dark:text-purple-400">
                {stats.uniqueClients}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200/50 dark:border-amber-800/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                Invoices Paid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                {stats.uniqueInvoices}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by receipt #, invoice #, client, or cheque #…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 h-9 text-sm w-full sm:w-[320px]"
          />
        </div>
        <Select
          value={filterClientId || "all"}
          onValueChange={(v) => {
            setFilterClientId(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48 h-9 text-sm">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Actions */}
      {bulkIds.size > 0 && (
        <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{bulkIds.size} selected</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkIds(new Set())}
              className="h-7"
            >
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={deleteMutation.isPending}
            className="h-7"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete Selected
          </Button>
        </div>
      )}

      {/* Receipt Form Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent className="sm:max-w-[680px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Receipt" : "New Receipt"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Record a payment against an invoice and prepare a client-ready
              receipt.
            </p>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50 to-teal-50/50 p-4 shadow-sm dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-teal-950/20">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Receipt readiness</p>
                  <p className="text-xs text-muted-foreground">
                    Confirm the source, payment, and issue date.
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  {receiptProgress}% ready
                </span>
              </div>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950"
                role="progressbar"
                aria-label={`${receiptProgress}% of receipt preparation complete`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={receiptProgress}
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                  style={{ width: `${receiptProgress}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                {["Invoice", "Payment", "Issue date"].map((label, index) => (
                  <span
                    key={label}
                    className={`flex items-center gap-1.5 ${receiptPreparation[index] ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 border-b pb-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <FileCheck className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Source invoice</p>
                <p className="text-xs text-muted-foreground">
                  Selecting an invoice fills the client, amount, and currency.
                </p>
              </div>
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label>
                  Invoice * (auto-fills client, amount &amp; currency)
                </Label>
                <Select
                  value={selectedInvoiceId || ""}
                  onValueChange={(v) => handleInvoiceSelect(v)}
                >
                  <SelectTrigger
                    className={
                      form.formState.errors.invoiceId
                        ? "border-destructive"
                        : ""
                    }
                  >
                    <SelectValue placeholder="Select an invoice…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {invoices.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoiceNumber}
                        {inv.clientName ? ` · ${inv.clientName}` : ""}
                        {" · "}
                        {formatCurrency(inv.total, inv.currency)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.invoiceId && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.invoiceId.message}
                  </p>
                )}
              </div>
            )}

            {selectedInvoice && !editing && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Client</p>
                  <p className="truncate font-medium">
                    {selectedInvoice.clientName || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Invoice total</p>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(
                      selectedInvoice.total,
                      selectedInvoice.currency,
                    )}
                  </p>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-xs text-muted-foreground">Invoice no.</p>
                  <p className="font-mono font-medium">
                    {selectedInvoice.invoiceNumber}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 border-b pb-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <Landmark className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Payment details</p>
                <p className="text-xs text-muted-foreground">
                  Confirm exactly what was received and when.
                </p>
              </div>
            </div>

            {editing && editing.invoiceNumber && (
              <div className="space-y-1.5">
                <Label>Invoice</Label>
                <Input
                  value={editing.invoiceNumber}
                  disabled
                  className="bg-muted"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="amount">Amount *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  {...form.register("amount")}
                />
                {form.formState.errors.amount && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.amount.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Currency *</Label>
                <Select
                  value={form.watch("currency")}
                  onValueChange={(v) =>
                    form.setValue("currency", v as (typeof CURRENCIES)[number])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="receiptDate">Receipt Date *</Label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  id="receiptDate"
                  type="date"
                  {...form.register("receiptDate")}
                />
              </div>
              {form.formState.errors.receiptDate && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.receiptDate.message}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 border-b pb-2 pt-1">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <ReceiptText className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Reference &amp; notes</p>
                <p className="text-xs text-muted-foreground">
                  Optional details that help reconcile or explain the payment.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chequeNumber">Cheque Number</Label>
              <Input
                id="chequeNumber"
                {...form.register("chequeNumber")}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="chequeDetails">Cheque Details / Notes</Label>
              <Textarea
                id="chequeDetails"
                {...form.register("chequeDetails")}
                placeholder="Optional cheque notes…"
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                {...form.register("notes")}
                placeholder="Optional notes — use Enter for more lines (shown on receipt PDF)"
                rows={3}
              />
            </div>

            <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? "Saving…"
                  : editing
                    ? "Save Changes"
                    : "Create Receipt"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* PDF Preview Dialog */}
      <Dialog
        open={!!previewPdfReceipt}
        onOpenChange={(open) => {
          if (!open) setPreviewPdfReceipt(null);
        }}
      >
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>
                PDF Preview — {previewPdfReceipt?.receiptNumber}
              </DialogTitle>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  previewPdfReceipt &&
                  handleDownloadPdf(
                    previewPdfReceipt.id,
                    previewPdfReceipt.receiptNumber,
                  )
                }
              >
                <FileDown className="h-3.5 w-3.5 mr-1" /> Download PDF
              </Button>
            </div>
          </DialogHeader>
          {previewPdfReceipt && (
            <PdfPreviewIframe
              pdfUrl={apiUrl(
                `/receipts/${previewPdfReceipt.id}/pdf?inline=true&v=${encodeURIComponent(settings?.updatedAt ?? "0")}`,
              )}
              title={`Receipt ${previewPdfReceipt.receiptNumber} PDF Preview`}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Receipts Table */}
      <Card className="bg-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-12 px-4 space-y-3">
              <p className="text-destructive text-sm">
                {describeApiFailure(error)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                Retry
              </Button>
            </div>
          ) : !receipts.length ? (
            <div className="text-center py-16 text-muted-foreground">
              <ReceiptText className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <p className="text-lg font-medium">
                {search.trim() || filterClientId
                  ? "No receipts match the selected filters."
                  : "No receipts yet. Create your first one."}
              </p>
              {!search.trim() && !filterClientId && (
                <Button onClick={openCreate} className="mt-4">
                  <Plus className="h-4 w-4 mr-2" /> New Receipt
                </Button>
              )}
            </div>
          ) : (
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b bg-muted/30">
                  <tr className="border-b transition-colors">
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-10">
                      <Checkbox
                        checked={allSelected}
                        data-state={
                          someSelected
                            ? "indeterminate"
                            : allSelected
                              ? "checked"
                              : "unchecked"
                        }
                        onCheckedChange={toggleAll}
                        aria-label="Select all receipts"
                      />
                    </th>
                    <SortableHeader
                      label="Receipt #"
                      field="receiptNumber"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={(field, dir) => {
                        setSortBy(field);
                        setSortDir(dir);
                      }}
                      className="w-[140px]"
                    />
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Client
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Invoice #
                    </th>
                    <SortableHeader
                      label="Amount"
                      field="amount"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={(field, dir) => {
                        setSortBy(field);
                        setSortDir(dir);
                      }}
                      className="w-[120px]"
                    />
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Cheque #
                    </th>
                    <SortableHeader
                      label="Receipt Date"
                      field="receiptDate"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={(field, dir) => {
                        setSortBy(field);
                        setSortDir(dir);
                      }}
                      className="w-[130px]"
                    />
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground w-[140px]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {receipts.map((receipt) => (
                    <tr
                      key={receipt.id}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="p-4 align-middle">
                        <Checkbox
                          checked={bulkIds.has(receipt.id)}
                          onCheckedChange={() => toggleOne(receipt.id)}
                          aria-label={`Select receipt ${receipt.receiptNumber}`}
                        />
                      </td>
                      <td className="p-4 align-middle">
                        <div className="font-medium flex items-center">
                          <ReceiptText className="h-4 w-4 mr-2 text-muted-foreground" />
                          {receipt.receiptNumber}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="font-medium">
                          {receipt.clientName ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        <div>
                          {receipt.invoiceNumber ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(receipt.amount, receipt.currency)}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        <div>
                          {receipt.chequeNumber ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        <div>{formatDate(receipt.receiptDate)}</div>
                      </td>
                      <td className="p-4 align-middle text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Send via Email"
                            onClick={() => openEmailDialog(receipt)}
                            disabled={emailReceiptMutation.isPending}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Preview PDF"
                            onClick={() => setPreviewPdfReceipt(receipt)}
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(receipt)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(receipt.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>

      {/* Email Dialog */}
      <EmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        title={`Send Receipt ${emailReceiptNumber ?? ""}`}
        description="Send the receipt PDF to the client via email."
        defaultEmail={emailDefaultTo}
        senderEmail1={settings?.gmailAccount1?.senderEmail}
        senderEmail2={settings?.gmailAccount2?.senderEmail}
        onSend={handleSendEmail}
        isSending={emailReceiptMutation.isPending}
      />

      <DeletedItemsDialog
        open={deletedOpen}
        onOpenChange={setDeletedOpen}
        entity="receipts"
        title="Deleted receipts"
        renderLabel={(row) => String(row.receiptNumber ?? "Untitled")}
        renderSubLabel={(row) =>
          row.clientName
            ? String(row.clientName)
            : row.invoiceNumber
              ? `Invoice ${row.invoiceNumber}`
              : undefined
        }
        onRestored={() =>
          queryClient.invalidateQueries({ queryKey: getListReceiptsQueryKey() })
        }
      />
    </div>
  );
}
