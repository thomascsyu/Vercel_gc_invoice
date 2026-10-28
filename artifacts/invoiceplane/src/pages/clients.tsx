import { useState, useEffect, useRef, useMemo, useCallback, type MouseEvent } from "react";
import {
  useListClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  useListReceipts,
  listInvoices,
  getListReceiptsQueryKey,
  getListClientsQueryKey,
  getListClientsQueryOptions,
  customFetch,
  useGetClientProposal,
  getGetClientProposalQueryKey,
  getQuotation,
  updateQuotation,
  type Client,
  type ClientListSortBy,
  type ListClientsParams,
  type Invoice,
  type QuotationPatch,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, MoreHorizontal, Edit, Trash2, Download, Upload, ReceiptText, ExternalLink, Eye, EyeOff, FileText, FileSignature, Link2, Save, X, ClipboardList } from "lucide-react";
import { SortableHeader } from "@/components/sortable-header";
import { keepPreviousData, useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiMigrateClientProposal } from "@/lib/modulesApi";
import { DeletedItemsDialog } from "@/components/deleted-items-dialog";
import { useDebounce } from "@/hooks/use-debounce";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PaginationControls } from "@/components/pagination-controls";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { describeApiFailure } from "@/lib/describeApiFailure";
import { ClientAuditHistoryDialog } from "@/components/client-audit-history-dialog";
import { formatAuditVisitStatus } from "@/lib/clientCertificationDisplay";
import type { ClientCertification } from "@workspace/api-client-react";

function generateClientCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(w => w.length > 0);
  const initials = words.slice(0, 3).map(w => w[0].toUpperCase()).join("");
  return `${initials || "CLI"}001`;
}

const clientSchema = z.object({
  clientCode: z.string().optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  addressLine3: z.string().optional(),
  addressLine4: z.string().optional(),
  country: z.string().optional(),
  isActive: z.boolean().default(true),
});

type ClientFormValues = z.infer<typeof clientSchema>;

function ClientCertificationLines({
  certifications,
  pick,
}: {
  certifications?: ClientCertification[];
  pick: "certificationBody" | "standard";
}) {
  const items = certifications ?? [];
  if (items.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-1">
      {items.map((c) => (
        <div key={c.id} className="text-sm leading-tight">
          {c[pick]}
        </div>
      ))}
    </div>
  );
}

function ClientLatestAuditLines({ certifications }: { certifications?: ClientCertification[] }) {
  const items = certifications ?? [];
  if (items.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-1">
      {items.map((c) => {
        const latest = c.latestAudit;
        if (!latest) {
          return (
            <div key={c.id} className="text-sm text-muted-foreground leading-tight">
              —
            </div>
          );
        }
        const statusLabel = formatAuditVisitStatus(latest.status);
        return (
          <div key={c.id} className="text-sm leading-tight flex flex-wrap items-center gap-1">
            <span>{formatDate(latest.auditDate)}</span>
            {statusLabel ? (
              <Badge variant="outline" className="text-xs font-normal px-1.5 py-0">
                {statusLabel}
              </Badge>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function isClientListSortField(field: string | null): field is ClientListSortBy {
  return (
    field === "name" ||
    field === "clientCode" ||
    field === "email" ||
    field === "createdAt" ||
    field === "isActive"
  );
}

const CLIENT_RECENT_INVOICES_LIMIT = 25;

function invoiceLineItemsDescription(invoice: Invoice): string {
  const items = invoice.items ?? [];
  if (!items.length) return "—";
  return items
    .map((line) => {
      const name = line.name?.trim() || "Item";
      const detail = line.details?.trim();
      return detail ? `${name} (${detail})` : name;
    })
    .join("; ");
}

function ClientInvoicesSheet({ client, onClose, onNavigateToInvoices }: {
  client: Client;
  onClose: () => void;
  onNavigateToInvoices: (clientName: string) => void;
}) {
  /** API supports sortBy/sortDir; generated OpenAPI types omit them. */
  const invoiceParams = {
    clientId: client.id,
    page: 1,
    pageSize: CLIENT_RECENT_INVOICES_LIMIT,
    sortBy: "invoiceDate" as const,
    sortDir: "desc" as const,
  };
  const { data: invoicesPage, isLoading } = useQuery({
    queryKey: ["/api/invoices", "client-recent", client.id],
    queryFn: () => listInvoices(invoiceParams as Parameters<typeof listInvoices>[0]),
  });
  const invoices = invoicesPage?.data ?? [];
  const total = invoicesPage?.total ?? 0;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Recent invoices — {client.name}
          </SheetTitle>
        </SheetHeader>

        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Showing {invoices.length} of {total} invoice{total !== 1 ? "s" : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigateToInvoices(client.name)}
            className="gap-1.5 shrink-0"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View in Invoices
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No invoices for this client yet.
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full caption-bottom text-sm table-fixed">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="h-10 w-[110px] px-3 text-left align-middle font-medium text-muted-foreground">Date</th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Description</th>
                  <th className="h-10 w-[120px] px-3 text-right align-middle font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b transition-colors hover:bg-muted/50">
                    <td className="px-3 py-2.5 align-middle text-muted-foreground whitespace-nowrap">
                      {formatDate(invoice.invoiceDate)}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <div className="font-medium text-foreground">{invoice.invoiceNumber}</div>
                      <div className="text-xs text-muted-foreground break-words" title={invoiceLineItemsDescription(invoice)}>
                        {invoiceLineItemsDescription(invoice)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-middle text-right font-semibold whitespace-nowrap">
                      {formatCurrency(invoice.total, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ClientReceiptsSheet({ client, onClose, onNavigateToReceipts }: {
  client: Client;
  onClose: () => void;
  onNavigateToReceipts: (clientId: string) => void;
}) {
  const [receiptPage, setReceiptPage] = useState(1);
  const [receiptPageSize, setReceiptPageSize] = useState(25);
  const receiptParams = { clientId: client.id, page: receiptPage, pageSize: receiptPageSize };
  const { data: receiptsPage, isLoading } = useListReceipts(
    receiptParams,
    { query: { queryKey: getListReceiptsQueryKey(receiptParams) } }
  );
  const receipts = receiptsPage?.data ?? [];
  const total = receiptsPage?.total ?? 0;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-muted-foreground" />
            Receipts — {client.name}
          </SheetTitle>
        </SheetHeader>

        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} receipt{total !== 1 ? "s" : ""} found
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigateToReceipts(client.id)}
            className="gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View in Receipts page
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No receipts found for this client.
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <table className="w-full caption-bottom text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Receipt #</th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Invoice #</th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Amount</th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {receipts.map((receipt) => (
                  <tr key={receipt.id} className="border-b transition-colors hover:bg-muted/50">
                    <td className="px-3 py-2.5 align-middle font-medium">{receipt.receiptNumber}</td>
                    <td className="px-3 py-2.5 align-middle text-muted-foreground">
                      {receipt.invoiceNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 align-middle font-semibold">
                      {formatCurrency(receipt.amount, receipt.currency)}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-muted-foreground">
                      {formatDate(receipt.receiptDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <PaginationControls
            page={receiptPage}
            pageSize={receiptPageSize}
            total={total}
            onPageChange={setReceiptPage}
            onPageSizeChange={(s) => {
              setReceiptPageSize(s);
              setReceiptPage(1);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

const CURRENCY_OPTIONS = ["HKD", "USD", "CNY", "MOP"] as const;

function normalizeLink(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function DriveLinkPreview({ url }: { url: string }) {
  const href = normalizeLink(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      title="Open the file in a new tab to preview it"
    >
      <ExternalLink className="h-3.5 w-3.5" /> Preview file
    </a>
  );
}

function ClientProposalSheet({ client, onClose }: { client: Client; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const proposalKey = getGetClientProposalQueryKey(client.id);
  const { data, isLoading } = useGetClientProposal(client.id, { query: { queryKey: proposalKey } });
  const confirmed = data?.confirmedQuotation;
  const legacy = data?.proposal;

  const [quotationDrive, setQuotationDrive] = useState("");
  const [savingQuotation, setSavingQuotation] = useState(false);

  const initialized = useRef(false);
  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    setQuotationDrive(data.confirmedQuotation?.driveFileUrl ?? "");
  }, [data]);

  const migrateMut = useMutation({
    mutationFn: () => apiMigrateClientProposal(client.id),
    onSuccess: (result) => {
      toast({
        title: result.alreadyExists ? "Proposal already exists" : "Proposal migrated",
        description: "The Proposals module is currently turned off, so the document cannot be opened here. Public client links still work.",
      });
      onClose();
    },
    onError: (err: Error) =>
      toast({ title: "Migration failed", description: err.message, variant: "destructive" }),
  });

  const saveQuotationLink = async () => {
    if (!confirmed) return;
    setSavingQuotation(true);
    try {
      const q = await getQuotation(confirmed.id);
      const patch: QuotationPatch = {
        clientId: q.clientId,
        quotationDate: q.quotationDate,
        validUntil: q.validUntil ?? "",
        status: q.status,
        currency: q.currency,
        discountAmount: q.discountAmount,
        items: q.items,
        serviceCategory: q.serviceCategory,
        cancellationReason: q.cancellationReason,
        termsConditions: q.termsConditions,
        remark: q.remark,
        quotationAttn: q.quotationAttn,
        driveFileUrl: quotationDrive.trim(),
      };
      await updateQuotation(q.id, patch);
      queryClient.invalidateQueries({ queryKey: proposalKey });
      toast({ title: "Quotation link saved" });
    } catch (err) {
      toast({
        title: "Failed to save quotation link",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSavingQuotation(false);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-muted-foreground" />
            Proposal &amp; Quotation &mdash; {client.name}
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Confirmed Quotation
              </h3>
              {confirmed ? (
                <div className="rounded-md border p-4 space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Quotation Number</p>
                      <p className="font-medium">{confirmed.quotationNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p className="font-medium">{formatDate(confirmed.quotationDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Amount</p>
                      <p className="font-medium">{formatCurrency(confirmed.total, confirmed.currency)}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5" /> Google Drive file link
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={quotationDrive}
                        onChange={(e) => setQuotationDrive(e.target.value)}
                        placeholder="https://drive.google.com/file/d/.../view"
                      />
                      <Button onClick={saveQuotationLink} disabled={savingQuotation} className="shrink-0">
                        <Save className="h-4 w-4 mr-1.5" /> Save
                      </Button>
                    </div>
                    <DriveLinkPreview url={quotationDrive} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">
                  No system-generated confirmed quotation for this client. Enter the proposal details below.
                </p>
              )}
            </section>

            <Separator />

            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Full proposals
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Use the Proposals module for generated PDFs, client portal, workflow, and milestone billing.
                  Legacy tracker data below can be migrated into a draft proposal document.
                </p>
              </div>

              {legacy ? (
                <div className="rounded-md border p-4 space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Legacy proposal no.</p>
                      <p className="font-medium">{legacy.proposalNo ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Revision</p>
                      <p className="font-medium">{legacy.proposalRevision}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Amount</p>
                      <p className="font-medium">{formatCurrency(legacy.totalAmount, legacy.currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Milestones</p>
                      <p className="font-medium">{legacy.paymentSchedule.length}</p>
                    </div>
                  </div>
                  {legacy.driveFileUrl && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">External file</p>
                      <DriveLinkPreview url={legacy.driveFileUrl} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">
                  No legacy tracker data for this client. Use Quotations for new work — staff proposal editing is turned off.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => migrateMut.mutate()}
                  disabled={migrateMut.isPending}
                >
                  {legacy ? "Migrate to full proposal" : "Create draft proposal"}
                </Button>
                <p className="text-xs text-muted-foreground self-center">
                  Staff proposal editing is turned off. Confirmed quotations and Drive links below still work.
                </p>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Clients() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [detailClient, setDetailClient] = useState<Client | null>(null);
  const [invoiceHistoryClient, setInvoiceHistoryClient] = useState<Client | null>(null);
  const [proposalClient, setProposalClient] = useState<Client | null>(null);
  const [auditHistoryClient, setAuditHistoryClient] = useState<Client | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [importOpen, setImportOpen] = useState(false);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const listParams = useMemo((): ListClientsParams => {
    const base: ListClientsParams = {
      q: debouncedSearch || undefined,
      page,
      pageSize,
      active: showInactive ? undefined : true,
    };
    if (isClientListSortField(sortBy)) {
      base.sortBy = sortBy;
      base.sortDir = sortDir;
    }
    return base;
  }, [debouncedSearch, page, pageSize, sortBy, sortDir, showInactive]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data: clientsPage, isLoading, isFetching, isError: listError, error: listFetchError, refetch: refetchClients } = useListClients(
    listParams,
    { query: { queryKey: getListClientsQueryKey(listParams), placeholderData: keepPreviousData } }
  );
  const clients = clientsPage?.data ?? [];
  const total = clientsPage?.total ?? 0;
  const showListSkeleton = isLoading && !clientsPage;

  // Debounced page change to prevent rapid clicks
  const [isPageChanging, setIsPageChanging] = useState(false);
  const debouncedSetPage = useCallback((newPage: number) => {
    if (isPageChanging) return;
    setIsPageChanging(true);
    setPage(newPage);
    setTimeout(() => setIsPageChanging(false), 150);
  }, [isPageChanging]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
    setPage(1);
  };

  const allPageIds = clients.map(c => c.id);
  const allSelected = allPageIds.length > 0 && allPageIds.every(id => selectedIds.has(id));
  const someSelected = allPageIds.some(id => selectedIds.has(id)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => { const n = new Set(prev); allPageIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); allPageIds.forEach(id => n.add(id)); return n; });
    }
  };

  const handleClientRowDoubleClick = (event: MouseEvent, client: Client) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, [role='checkbox'], [data-radix-collection-item]")) return;
    setAuditHistoryClient(client);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} client(s)? This cannot be undone.`)) return;
    try {
      await customFetch<void>("/api/clients/bulk-delete", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      toast({ title: `Deleted ${ids.length} client(s)` });
    } catch {
      toast({ title: "Bulk delete failed", variant: "destructive" });
    }
  };

  const bulkSetActive = async (active: boolean) => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      await customFetch<void>("/api/clients/bulk-status", {
        method: "PATCH",
        body: JSON.stringify({ ids, isActive: active }),
      });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
      toast({ title: `Updated ${ids.length} client(s)` });
    } catch {
      toast({ title: "Bulk update failed", variant: "destructive" });
    }
  };

  const createMutation = useCreateClient();
  const updateMutation = useUpdateClient();
  const deleteMutation = useDeleteClient();

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      clientCode: "", name: "", email: "", contactPerson: "", phone: "",
      addressLine1: "", addressLine2: "", addressLine3: "", addressLine4: "",
      country: "", isActive: true
    }
  });

  const onSubmit = (rawData: ClientFormValues) => {
    const data = { ...rawData, clientCode: rawData.clientCode ?? "" };
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setEditingClient(null);
          setIsCreateOpen(false);
          toast({ title: "Client updated successfully" });
        },
        onError: (err: Error) => {
          toast({ title: "Failed to update client", description: describeApiFailure(err), variant: "destructive" });
        }
      });
    } else {
      createMutation.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setIsCreateOpen(false);
          form.reset();
          lastAutoCode.current = "";
          toast({ title: "Client created successfully" });
        },
        onError: (err: Error) => {
          toast({ title: "Failed to create client", description: describeApiFailure(err), variant: "destructive" });
        }
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this client?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: "Client deleted" });
        },
        onError: (err: Error) => {
          toast({ title: "Failed to delete client", description: describeApiFailure(err), variant: "destructive" });
        }
      });
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    form.reset({
      clientCode: client.clientCode,
      name: client.name,
      email: client.email,
      contactPerson: client.contactPerson || "",
      phone: client.phone || "",
      addressLine1: client.addressLine1 || "",
      addressLine2: client.addressLine2 || "",
      addressLine3: client.addressLine3 || "",
      addressLine4: client.addressLine4 || "",
      country: client.country || "",
      isActive: client.isActive
    });
  };

  const lastAutoCode = useRef("");
  const watchedName = form.watch("name");
  useEffect(() => {
    if (editingClient) return;
    if (!watchedName || watchedName.trim().length < 2) return;
    const currentCode = form.getValues("clientCode") ?? "";
    if (currentCode === "" || currentCode === lastAutoCode.current) {
      const generated = generateClientCode(watchedName);
      lastAutoCode.current = generated;
      form.setValue("clientCode", generated, { shouldValidate: false });
    }
  }, [watchedName]);

  const handleExport = () => {
    const url = "/api/clients/export";
    const a = document.createElement("a");
    a.href = url;
    a.download = "clients.csv";
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Clients</h2>
          <p className="text-muted-foreground text-sm">Manage your client list and details.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport} title="Export CSV">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} title="Import CSV">
            <Upload className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeletedOpen(true)} title="Deleted clients">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setShowInactive(!showInactive); setPage(1); }}
            title={showInactive ? "Hide Inactive" : "Show Inactive"}
          >
            {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={(open) => {
            setIsCreateOpen(open);
            if (!open) {
              setEditingClient(null);
              form.reset();
              lastAutoCode.current = "";
            }
          }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Add Client</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{editingClient ? "Edit Client" : "Add New Client"}</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem><FormLabel>Company Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage/></FormItem>
                    )} />
                    <FormField control={form.control} name="clientCode" render={({ field }) => (
                      <FormItem><FormLabel>Client Code</FormLabel><FormControl><Input {...field} placeholder="Auto-generated from name" /></FormControl><FormMessage/></FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="contactPerson" render={({ field }) => (
                      <FormItem><FormLabel>Contact Person</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage/></FormItem>
                    )} />
                    <FormField control={form.control} name="phone" render={({ field }) => (
                      <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage/></FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage/></FormItem>
                  )} />
                  <div className="space-y-2">
                    <p className="text-sm font-medium leading-none">Address</p>
                    <FormField control={form.control} name="addressLine1" render={({ field }) => (
                      <FormItem>
                      <FormLabel className="sr-only">Address line 1</FormLabel>
                      <FormControl><Input {...field} placeholder="Address line 1" /></FormControl>
                      <FormMessage/>
                    </FormItem>
                    )} />
                    <FormField control={form.control} name="addressLine2" render={({ field }) => (
                      <FormItem>
                      <FormLabel className="sr-only">Address line 2</FormLabel>
                      <FormControl><Input {...field} placeholder="Address line 2" /></FormControl>
                      <FormMessage/>
                    </FormItem>
                    )} />
                    <FormField control={form.control} name="addressLine3" render={({ field }) => (
                      <FormItem>
                      <FormLabel className="sr-only">Address line 3</FormLabel>
                      <FormControl><Input {...field} placeholder="Address line 3" /></FormControl>
                      <FormMessage/>
                    </FormItem>
                    )} />
                    <FormField control={form.control} name="addressLine4" render={({ field }) => (
                      <FormItem>
                      <FormLabel className="sr-only">Address line 4</FormLabel>
                      <FormControl><Input {...field} placeholder="Address line 4" /></FormControl>
                      <FormMessage/>
                    </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="country" render={({ field }) => (
                    <FormItem><FormLabel>Country</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage/></FormItem>
                  )} />
                  <FormField control={form.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Active Status</FormLabel>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                      {editingClient ? "Update Client" : "Save Client"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="bg-card">
        <div className="p-4 border-b space-y-2">
          <div className="flex items-center gap-3 justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search clients..."
                className="pl-9"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <PaginationControls
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={debouncedSetPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
              isLoading={isFetching}
            />
          </div>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 p-2 bg-muted/60 rounded-md text-sm">
              <span className="font-medium">{selectedIds.size} selected</span>
              <div className="flex items-center gap-1 ml-2">
                <Button size="sm" variant="outline" onClick={() => bulkSetActive(true)}>Set Active</Button>
                <Button size="sm" variant="outline" onClick={() => bulkSetActive(false)}>Set Inactive</Button>
                <Button size="sm" variant="destructive" onClick={bulkDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            </div>
          )}
        </div>
        <CardContent className="p-0">
          {listError ? (
            <div className="text-center py-12 px-4 space-y-3">
              <p className="text-destructive text-sm">{describeApiFailure(listFetchError)}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetchClients()}>
                Retry
              </Button>
            </div>
          ) : showListSkeleton ? (
            <div className="p-6 space-y-4">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded"></div>)}
            </div>
          ) : !clients.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No clients found. Add one to get started.</p>
              <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Add Client
              </Button>
            </div>
          ) : (
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                    <th className="h-10 w-10 px-2 align-middle">
                      <Checkbox checked={allSelected} ref={(el) => { if (el) (el as HTMLButtonElement).dataset.indeterminate = someSelected ? "true" : "false"; }} onCheckedChange={toggleSelectAll} aria-label="Select all" className={someSelected ? "opacity-70" : ""} />
                    </th>
                    <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">
                      <SortableHeader label="Client" field="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">Contact</th>
                    <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">CB</th>
                    <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">Standard</th>
                    <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">Latest audit</th>
                    <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">
                      <SortableHeader label="Status" field="isActive" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="h-10 px-2 text-right align-middle font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {clients.map((client) => (
                    <tr
                      key={client.id}
                      className={`border-b transition-colors hover:bg-muted/50 cursor-pointer select-none ${selectedIds.has(client.id) ? "bg-muted/30" : ""}`}
                      title="Double-click for audit history"
                      onDoubleClick={(e) => handleClientRowDoubleClick(e, client)}
                    >
                      <td className="w-10 px-2 align-middle" onDoubleClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(client.id)} onCheckedChange={() => toggleSelect(client.id)} aria-label="Select row" />
                      </td>
                      <td className="p-2 align-middle">
                        <div className="font-medium">{client.name}</div>
                        <div className="text-xs text-muted-foreground">{client.clientCode}</div>
                      </td>
                      <td className="p-2 align-middle">
                        <div className="text-sm">{client.email}</div>
                        {client.phone && <div className="text-xs text-muted-foreground">{client.phone}</div>}
                      </td>
                      <td className="p-2 align-middle">
                        <ClientCertificationLines
                          certifications={client.certifications}
                          pick="certificationBody"
                        />
                      </td>
                      <td className="p-2 align-middle">
                        <ClientCertificationLines
                          certifications={client.certifications}
                          pick="standard"
                        />
                      </td>
                      <td className="p-2 align-middle">
                        <ClientLatestAuditLines certifications={client.certifications} />
                      </td>
                      <td className="p-2 align-middle">
                        <Badge variant={client.isActive ? "default" : "secondary"}>
                          {client.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="p-2 align-middle text-right" onDoubleClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0" aria-label={`Actions for ${client.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setInvoiceHistoryClient(client)}>
                              <FileText className="h-4 w-4 mr-2" /> View invoices
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDetailClient(client)}>
                              <ReceiptText className="h-4 w-4 mr-2" /> View Receipts
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setAuditHistoryClient(client)}>
                              <ClipboardList className="h-4 w-4 mr-2" /> Audit history
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setProposalClient(client)}>
                              <FileSignature className="h-4 w-4 mr-2" /> Quotation &amp; proposal notes
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              handleEdit(client);
                              setIsCreateOpen(true);
                            }}>
                              <Edit className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDelete(client.id)} className="text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importUrl={"/api/clients/import"}
        entityName="Clients"
        validRowsImportFocus
        onSuccess={() => queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() })}
        templateUrl={"/api/clients/import/template"}
        supportsOverwrite={true}
      />

      <DeletedItemsDialog
        open={deletedOpen}
        onOpenChange={setDeletedOpen}
        entity="clients"
        title="Deleted clients"
        renderLabel={(row) => String(row.name ?? "Untitled")}
        renderSubLabel={(row) => (row.clientCode ? String(row.clientCode) : undefined)}
        onRestored={() => queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() })}
      />

      {detailClient && (
        <ClientReceiptsSheet
          client={detailClient}
          onClose={() => setDetailClient(null)}
          onNavigateToReceipts={(clientId) => {
            setDetailClient(null);
            setLocation(`/receipts?clientId=${encodeURIComponent(clientId)}`);
          }}
        />
      )}

      {invoiceHistoryClient && (
        <ClientInvoicesSheet
          client={invoiceHistoryClient}
          onClose={() => setInvoiceHistoryClient(null)}
          onNavigateToInvoices={(clientName) => {
            setInvoiceHistoryClient(null);
            setLocation(`/invoices?q=${encodeURIComponent(clientName)}`);
          }}
        />
      )}

      {proposalClient && (
        <ClientProposalSheet
          client={proposalClient}
          onClose={() => setProposalClient(null)}
        />
      )}

      {auditHistoryClient && (
        <ClientAuditHistoryDialog
          client={auditHistoryClient}
          onClose={() => setAuditHistoryClient(null)}
        />
      )}
    </div>
  );
}
