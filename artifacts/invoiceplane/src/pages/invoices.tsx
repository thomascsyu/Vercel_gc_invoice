import { useState, useEffect, useRef, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import {
  useListInvoices,
  useCreateInvoice,
  useUpdateInvoice,
  useDeleteInvoice,
  useGetInvoice,
  getGetInvoiceQueryKey,
  getListInvoicesQueryKey,
  useCreateQuotationTemplate,
  getListQuotationTemplatesQueryKey,
  useEmailInvoice,
  useEmailInvoiceReminder,
  useGenerateInvoiceShareToken,
  getInvoice,
  getClient,
  type Invoice,
  type InvoiceStatus,
} from "@workspace/api-client-react";
import DocumentForm, { serviceCategoryLabel, type DocumentFormValues } from "@/components/document-form";
import { EmailDialog } from "@/components/email-dialog";
import { PdfBrandingReadiness } from "@/components/pdf-branding-readiness";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiListConsultants, apiGetSettings, apiGetBrandingStorageStatus, apiPatchInvoiceStatus, apiBulkSetInvoiceStatus, apiBulkDeleteInvoices, type Consultant } from "@/lib/modulesApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate, copyText, isInvoiceOverdue } from "@/lib/utils";
import { formInvoiceStatuses, bulkInvoiceStatusTargets, isInvoiceFullyPaid, type InvoiceWorkflowStatus } from "@workspace/invoice-utils";
import {
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  FileText,
  Send,
  Download,
  Upload,
  X,
  CheckCircle,
  XCircle,
  ThumbsUp,
  ClipboardCheck,
  RefreshCw,
  BookmarkPlus,
  Eye,
  FileDown,
  Link,
  Search,
  CreditCard,
  ListChecks,
} from "lucide-react";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PaginationControls } from "@/components/pagination-controls";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import { SortableHeader } from "@/components/sortable-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiUrl } from "@/lib/api-base";
import { DeletedItemsDialog } from "@/components/deleted-items-dialog";
import { InvoiceContinuityDialog } from "@/components/invoice-continuity-dialog";
import { useDebounce } from "@/hooks/use-debounce";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { describeApiFailure } from "@/lib/describeApiFailure";
import { PdfPreviewIframe } from "@/components/pdf-preview-iframe";

const INVOICE_IMPORT_TEMPLATE = {
  filename: "invoices-template.csv",
  content: [
    "Invoice Number,Client name,Invoice Amount,Invoice Date,item1,item2",
    "INV-0001,Acme Corporation,1000,2026-04-17,First line of service,Another line item",
  ].join("\r\n"),
};


export default function Invoices() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"list" | "create">("list");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [importOpen, setImportOpen] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [continuityOpen, setContinuityOpen] = useState(false);

  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const searchString = useSearch();
  const [searchQuery, setSearchQuery] = useState(() => {
    const params = new URLSearchParams(searchString);
    return params.get("q") ?? "";
  });
  const debouncedSearch = useDebounce(searchQuery, 250);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());

  const [, setLocation] = useLocation();
  const openId = new URLSearchParams(searchString).get("open") ?? "";
  const [autoOpenedId, setAutoOpenedId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    setSearchQuery(params.get("q") ?? "");
    const status = params.get("status") ?? "";
    if (status) setFilterStatus(status);
    setFilterOverdue(params.get("overdue") === "1");
    setPage(1);
  }, [searchString]);

  const params = {
    page,
    pageSize,
    ...(filterStatus ? { status: filterStatus as InvoiceStatus } : {}),
    ...(filterDateFrom ? { dateFrom: filterDateFrom } : {}),
    ...(filterDateTo ? { dateTo: filterDateTo } : {}),
    ...(filterOverdue ? { overdue: "true" as const } : {}),
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
    ...(sortBy ? { sortBy: sortBy as "invoiceNumber" | "invoiceDate" | "dueDate" | "total" | "status" | "createdAt", sortDir } : {}),
  };
  const { data: invoicesPage, isLoading, isFetching, isError: listError, error: listFetchError, refetch: refetchInvoices } = useListInvoices(
    params,
    { query: { queryKey: getListInvoicesQueryKey(params), placeholderData: keepPreviousData } },
  );
  const invoices = invoicesPage?.data ?? [];
  const total = invoicesPage?.total ?? 0;

  const bulkSelectedInvoices = useMemo(
    () => invoices.filter((inv) => bulkIds.has(inv.id)),
    [invoices, bulkIds],
  );
  const bulkInvoiceActions = useMemo(() => {
    const rows = bulkSelectedInvoices.map((inv) => ({
      status: inv.status,
      paidAmount: inv.paidAmount ?? 0,
      total: inv.total,
    }));
    return bulkInvoiceStatusTargets(rows).filter((target) =>
      rows.some((row) => row.status !== target),
    );
  }, [bulkSelectedInvoices]);

  const invoiceBulkLabel = (status: InvoiceWorkflowStatus) => {
    switch (status) {
      case "pending_approval":
        return "Submit";
      case "approved":
        return "Approve";
      case "sent":
        return "Mark sent";
      case "revised":
        return "Mark revised";
      case "paid":
        return "Mark paid";
      default:
        return status.replace(/_/g, " ");
    }
  };
  const showListSkeleton = isLoading && !invoicesPage;

  const { data: consultants = [] } = useQuery<Consultant[]>({
    queryKey: ["/consultants"],
    queryFn: apiListConsultants,
  });

  const deleteMutation = useDeleteInvoice();
  const updateMutation = useUpdateInvoice();
  const createMutation = useCreateInvoice();
  const createTplMutation = useCreateQuotationTemplate();
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
  const [saveAsTemplateInvoice, setSaveAsTemplateInvoice] = useState<Invoice | null>(null);
  const [saveAsTemplateName, setSaveAsTemplateName] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  /** Bumped whenever the invoice editor opens so DocumentForm remounts with fresh state. */
  const [invoiceFormKey, setInvoiceFormKey] = useState(0);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [reasonModal, setReasonModal] = useState<{ invoice: Invoice; newStatus: InvoiceStatus } | null>(null);
  const [previewPdfInvoice, setPreviewPdfInvoice] = useState<Invoice | null>(null);
  const [reasonText, setReasonText] = useState("");
  const reasonTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  /** Two-step confirmation when the user changes an existing invoice number. */
  const [numberChangeConfirm, setNumberChangeConfirm] = useState<{
    values: DocumentFormValues;
    from: string;
    to: string;
    step: 1 | 2;
  } | null>(null);

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailInvoiceId, setEmailInvoiceId] = useState<string | null>(null);
  const [emailInvoiceNumber, setEmailInvoiceNumber] = useState<string | null>(null);
  const [emailDefaultTo, setEmailDefaultTo] = useState<string>("");
  const [emailMode, setEmailMode] = useState<"invoice" | "reminder">("invoice");
  const [formDirty, setFormDirty] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["/company-settings"],
    queryFn: apiGetSettings,
  });
  const hasBranding = Boolean(settings?.logoUrl || settings?.headerLogoUrl);
  const { data: brandingStorageStatus } = useQuery({
    queryKey: ["/uploads/branding/storage-status"],
    queryFn: apiGetBrandingStorageStatus,
    enabled: hasBranding,
    staleTime: 60_000,
  });

  const emailInvoiceMutation = useEmailInvoice();
  const emailReminderMutation = useEmailInvoiceReminder();
  const generateShareTokenMutation = useGenerateInvoiceShareToken();

  const { data: openTarget, isError: openError } = useGetInvoice(openId, {
    query: {
      queryKey: getGetInvoiceQueryKey(openId),
      enabled: !!openId && autoOpenedId !== openId,
      retry: false,
    },
  });

  useEffect(() => {
    if (openTarget && autoOpenedId !== openId) {
      setAutoOpenedId(openId);
      setEditing(openTarget);
      setInvoiceFormKey((k) => k + 1);
      if (isMobile) {
        setMobileTab("create");
      } else {
        setEditorOpen(true);
      }
      setLocation("/invoices", { replace: true });
    }
  }, [openTarget, openId, autoOpenedId, setLocation, isMobile]);

  useEffect(() => {
    if (openError && openId) {
      toast({ title: "Invoice not found", description: "The linked invoice could not be found or has been deleted.", variant: "destructive" });
      setLocation("/invoices", { replace: true });
    }
  }, [openError, openId, setLocation, toast]);

  const INVOICE_STATUSES: InvoiceStatus[] = [
    "draft", "pending_approval", "approved", "sent", "revised", "paid",
  ];

  const hasFilters = !!(filterStatus || filterDateFrom || filterDateTo || filterOverdue || searchQuery);

  const clearFilters = () => {
    setFilterStatus("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterOverdue(false);
    setSearchQuery("");
    setPage(1);
    setLocation("/invoices", { replace: true });
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
    setPage(1);
  };

  const invoiceIds = invoices.map(i => i.id);
  const allBulkSelected = invoiceIds.length > 0 && invoiceIds.every(id => bulkIds.has(id));
  const someBulkSelected = invoiceIds.some(id => bulkIds.has(id)) && !allBulkSelected;

  const toggleBulkSelectAll = () => {
    if (allBulkSelected) {
      setBulkIds(prev => { const n = new Set(prev); invoiceIds.forEach(id => n.delete(id)); return n; });
    } else {
      setBulkIds(prev => { const n = new Set(prev); invoiceIds.forEach(id => n.add(id)); return n; });
    }
  };

  const toggleBulkSelect = (id: string) => {
    setBulkIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const bulkDeleteInvoices = async () => {
    const ids = [...bulkIds];
    if (!ids.length) return;
    try {
      await apiBulkDeleteInvoices(ids);
      setBulkIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      toast({ title: `Deleted ${ids.length} invoice(s)` });
    } catch (err) {
      toast({
        title: "Bulk delete failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const bulkSetInvoiceStatus = async (status: InvoiceStatus) => {
    const ids = [...bulkIds];
    if (!ids.length) return;
    try {
      await apiBulkSetInvoiceStatus(ids, status);
      setBulkIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      toast({ title: `Updated ${ids.length} invoice(s) to ${status}` });
    } catch (err) {
      toast({
        title: "Bulk update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const closeEditor = () => {
    if (formDirty && !window.confirm("Discard unsaved changes?")) return;
    setFormDirty(false);
    setEditorOpen(false);
    setEditing(null);
    setNumberChangeConfirm(null);
    if (isMobile) setMobileTab("list");
    if (openId) setLocation("/invoices", { replace: true });
  };

  const openCreateEditor = () => {
    setEditing(null);
    setInvoiceFormKey((k) => k + 1);
    if (isMobile) {
      setMobileTab("create");
    } else {
      setEditorOpen(true);
    }
  };

  const handleMobileTabChange = (value: string) => {
    if (value === "list" && mobileTab === "create") {
      if (formDirty && !window.confirm("Discard unsaved changes?")) return;
      setFormDirty(false);
      setEditing(null);
      setNumberChangeConfirm(null);
    }
    setMobileTab(value as "list" | "create");
  };

  const saveInvoiceFromForm = (values: DocumentFormValues) => {
    const payload = {
      clientId: values.clientId,
      invoiceDate: values.date,
      dueDate: values.dueOrValid,
      status: values.status as InvoiceStatus,
      currency: values.currency,
      discountAmount: values.discountAmount,
      items: values.items,
      consultantIds: values.consultantIds ?? editing?.consultantIds ?? [],
      serviceCategory: values.serviceCategory,
      notes: values.notes || undefined,
      internalNote: editing
        ? (values.internalNote?.trim() ?? "")
        : (values.internalNote?.trim() || undefined),
      termsConditions: values.termsConditions || undefined,
      remark: values.remark || undefined,
      ...(values.invoiceNumber?.trim()
        ? { invoiceNumber: values.invoiceNumber.trim() }
        : {}),
    };
    const onSuccess = (msg: string, updated?: Invoice) => {
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      const title =
        updated?.status === "revised" && updated.invoiceNumber
          ? `Invoice revised — ${updated.invoiceNumber}`
          : msg;
      toast({ title });
      closeEditor();
    };
    const onError = (err: Error) => {
      const duplicate = (err as Error & { data?: { error?: string } }).data?.error === "Duplicate invoice number";
      toast({
        title: duplicate ? "Duplicate invoice number" : "Failed",
        description: duplicate ? undefined : err.message,
        variant: "destructive",
      });
    };
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: (updated) => onSuccess("Invoice updated", updated),
          onError,
        },
      );
    } else {
      createMutation.mutate(
        { data: payload },
        { onSuccess: () => onSuccess("Invoice created"), onError },
      );
    }
  };

  const handleEditorSubmit = (values: DocumentFormValues) => {
    if (editing) {
      const from = editing.invoiceNumber.trim();
      const to = values.invoiceNumber?.trim() ?? "";
      if (to && to !== from) {
        setNumberChangeConfirm({ values, from, to, step: 1 });
        return;
      }
    }
    saveInvoiceFromForm(values);
  };

  const cancelNumberChangeConfirm = () => setNumberChangeConfirm(null);

  const advanceNumberChangeConfirm = () => {
    if (!numberChangeConfirm) return;
    if (numberChangeConfirm.step === 1) {
      setNumberChangeConfirm({ ...numberChangeConfirm, step: 2 });
      return;
    }
    const { values } = numberChangeConfirm;
    setNumberChangeConfirm(null);
    saveInvoiceFromForm(values);
  };

  const handleStatusUpdate = async (invoice: Invoice, newStatus: InvoiceStatus, reason?: string) => {
    setStatusUpdatingId(invoice.id);
    const isRejection = newStatus === "draft" && invoice.status === "pending_approval";
    try {
      await apiPatchInvoiceStatus(invoice.id, {
        status: newStatus,
        ...(isRejection ? { cancellationReason: reason ?? "" } : {}),
      });
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      toast({ title: `Invoice ${newStatus.replace("_", " ")}` });
    } catch (err) {
      toast({
        title: "Failed to update status",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const openEditorForInvoice = async (invoice: Invoice) => {
    try {
      const full = await getInvoice(invoice.id);
      setEditing(full);
      setInvoiceFormKey((k) => k + 1);
      if (isMobile) {
        setMobileTab("create");
      } else {
        setEditorOpen(true);
      }
    } catch (err) {
      toast({
        title: "Failed to load invoice",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openRejectModal = (invoice: Invoice, newStatus: InvoiceStatus) => {
    setReasonText("");
    setReasonModal({ invoice, newStatus });
    setTimeout(() => reasonTextareaRef.current?.focus(), 50);
  };

  const confirmRejectModal = async () => {
    if (!reasonModal) return;
    await handleStatusUpdate(reasonModal.invoice, reasonModal.newStatus, reasonText);
    setReasonModal(null);
    setReasonText("");
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this invoice?")) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
            toast({ title: "Invoice deleted" });
          },
          onError: (err: Error) =>
            toast({ title: "Failed to delete invoice", description: err.message, variant: "destructive" }),
        },
      );
    }
  };

  const openSaveAsTemplate = async (invoice: Invoice) => {
    const defaultName = invoice.invoiceNumber || invoice.clientName || "Template";
    try {
      const full = await getInvoice(invoice.id);
      setSaveAsTemplateInvoice(full);
      setSaveAsTemplateName(defaultName);
      setSaveAsTemplateOpen(true);
    } catch (err) {
      toast({
        title: "Failed to load invoice",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleSaveAsTemplate = () => {
    if (!saveAsTemplateInvoice || !saveAsTemplateName.trim()) return;
    const inv = saveAsTemplateInvoice;
    createTplMutation.mutate(
      { data: { name: saveAsTemplateName.trim(), items: inv.items, currency: inv.currency, discountAmount: inv.discountAmount } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListQuotationTemplatesQueryKey() });
          toast({ title: "Template saved", description: `"${saveAsTemplateName.trim()}" has been added to your templates.` });
          setSaveAsTemplateOpen(false);
          setSaveAsTemplateInvoice(null);
          setSaveAsTemplateName("");
        },
        onError: (err: Error) => toast({ title: "Failed to save template", description: err.message, variant: "destructive" }),
      },
    );
  };

  const consultantCodes = (ids?: string[]) => {
    if (!ids || ids.length === 0) return null;
    return ids.map((id) => consultants.find((c) => c.id === id)?.shortCode ?? "?").join(" · ");
  };

  const openEmailDialog = (invoice: Invoice, mode: "invoice" | "reminder" = "invoice") => {
    setEmailInvoiceId(invoice.id);
    setEmailInvoiceNumber(invoice.invoiceNumber);
    setEmailDefaultTo("");
    setEmailMode(mode);
    setEmailDialogOpen(true);
    if (invoice.clientId) {
      void getClient(invoice.clientId)
        .then((client) => {
          if (client.email) setEmailDefaultTo(client.email);
        })
        .catch(() => {
          /* recipient stays blank; user can type it */
        });
    }
  };

  const handleSendEmail = async (params: { to: string; slot: 1 | 2; cc?: string; bcc?: string }) => {
    if (!emailInvoiceId) return;

    try {
      if (emailMode === "invoice") {
        await emailInvoiceMutation.mutateAsync({
          id: emailInvoiceId,
          data: params,
        });
      } else {
        await emailReminderMutation.mutateAsync({
          id: emailInvoiceId,
          data: params,
        });
      }
      toast({
        title: emailMode === "invoice" ? "Invoice sent" : "Reminder sent",
        description: `Email sent to ${params.to}`,
      });
      if (emailMode === "invoice") {
        // Update status to "sent" after successful email
        const invoice = invoices.find((i) => i.id === emailInvoiceId);
        if (invoice && invoice.status === "approved") {
          handleStatusUpdate(invoice, "sent");
        }
      }
      setEmailDialogOpen(false);
      setEmailInvoiceId(null);
    } catch (err) {
      toast({
        title: "Failed to send email",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const getStatusColor = (status: string) => {
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

  const renderWorkflowButtons = (invoice: Invoice) => {
    const status = invoice.status;
    if (status === "draft") {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => handleStatusUpdate(invoice, "pending_approval")}
          disabled={statusUpdatingId === invoice.id}
        >
          <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Submit
        </Button>
      );
    }
    if (status === "pending_approval") {
      return (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950"
            onClick={() => handleStatusUpdate(invoice, "approved")}
            disabled={statusUpdatingId === invoice.id}
          >
            <ThumbsUp className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
            onClick={() => openRejectModal(invoice, "draft")}
            disabled={statusUpdatingId === invoice.id}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
          </Button>
        </div>
      );
    }
    if (status === "approved") {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs text-blue-700 border-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950"
          onClick={() => openEmailDialog(invoice, "invoice")}
          disabled={emailInvoiceMutation.isPending || emailReminderMutation.isPending}
        >
          <Send className="h-3.5 w-3.5 mr-1" /> Send Invoice
        </Button>
      );
    }
    if (status === "sent") {
      const fullyPaid = isInvoiceFullyPaid(invoice.paidAmount ?? 0, invoice.total);
      return (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-blue-700 border-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950"
            onClick={() => openEmailDialog(invoice, "reminder")}
            disabled={emailReminderMutation.isPending || emailInvoiceMutation.isPending}
          >
            <Send className="h-3.5 w-3.5 mr-1" /> Send Reminder
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-purple-700 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-800 dark:hover:bg-purple-950"
            onClick={() => handleStatusUpdate(invoice, "revised")}
            disabled={statusUpdatingId === invoice.id}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Revise
          </Button>
          {fullyPaid && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950"
              onClick={() => handleStatusUpdate(invoice, "paid")}
              disabled={statusUpdatingId === invoice.id}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" /> Mark Paid
            </Button>
          )}
        </div>
      );
    }
    if (status === "revised") {
      const fullyPaid = isInvoiceFullyPaid(invoice.paidAmount ?? 0, invoice.total);
      if (!fullyPaid) return null;
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950"
          onClick={() => handleStatusUpdate(invoice, "paid")}
          disabled={statusUpdatingId === invoice.id}
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Mark Paid
        </Button>
      );
    }
    return null;
  };

  const handleDownloadPdf = (id: string, invoiceNumber: string) => {
    const url = apiUrl(`/invoices/${id}/pdf`);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${invoiceNumber}.pdf`;
    a.click();
  };

  const handleExport = () => {
    const url = apiUrl("/invoices/export");
    const a = document.createElement("a");
    a.href = url;
    a.download = "invoices.csv";
    a.click();
  };

  const invoiceDocumentForm = (
    <DocumentForm
      key={`invoice-${editing?.id ?? "new"}-${invoiceFormKey}`}
      kind="invoice"
      statuses={formInvoiceStatuses(editing?.status ?? "draft")}
      submitting={createMutation.isPending || updateMutation.isPending}
      consultants={consultants}
      initialClientName={editing?.clientName}
      invoiceNumber={editing?.invoiceNumber}
      initial={
        editing
          ? {
              clientId: editing.clientId,
              date: editing.invoiceDate,
              dueOrValid: editing.dueDate ?? editing.invoiceDate,
              currency: editing.currency,
              status: editing.status,
              discountAmount: editing.discountAmount,
              items: editing.items,
              invoiceNumber: editing.invoiceNumber,
              notes: editing.notes ?? "",
              internalNote: editing.internalNote ?? "",
              termsConditions: editing.termsConditions ?? "",
              remark: editing.remark ?? "",
              consultantIds: editing.consultantIds ?? [],
              serviceCategory: editing.serviceCategory,
            }
          : undefined
      }
      onSubmit={handleEditorSubmit}
      onCancel={closeEditor}
      onDirtyChange={setFormDirty}
    />
  );

  const filterToolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="w-[280px] h-8 text-sm pl-8"
          placeholder="Search invoice, client, or amount…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          aria-label="Search invoices by number, client, or amount"
        />
      </div>
      <Select
        value={filterStatus || "all"}
        onValueChange={(v) => { setFilterStatus(v === "all" ? "" : v); setPage(1); }}
      >
        <SelectTrigger className="w-[160px] h-8 text-sm">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {INVOICE_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant={filterOverdue ? "default" : "outline"}
        size="sm"
        className="h-8"
        onClick={() => { setFilterOverdue((v) => !v); setPage(1); }}
      >
        Overdue
      </Button>
      <div className="hidden md:contents">
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          isLoading={isFetching}
        />
      </div>
      <Input
        type="date"
        className="w-[150px] h-8 text-sm"
        value={filterDateFrom}
        onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
        aria-label="Invoice date from"
      />
      <span className="text-muted-foreground text-sm">—</span>
      <Input
        type="date"
        className="w-[150px] h-8 text-sm"
        value={filterDateTo}
        onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
        aria-label="Invoice date to"
      />
      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={clearFilters}>
          <X className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
      )}
    </div>
  );

  const invoiceListCard = (
    <Card className="bg-card">
      <CardContent className="p-0">
        {listError ? (
          <div className="text-center py-12 px-4 space-y-3">
            <p className="text-destructive text-sm">{describeApiFailure(listFetchError)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetchInvoices()}>
              Retry
            </Button>
          </div>
        ) : showListSkeleton ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded"></div>
            ))}
          </div>
        ) : !invoices.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>{hasFilters ? "No invoices match the current filters." : "No invoices found. Create your first one."}</p>
            {!hasFilters && (
              <Button className="mt-4" onClick={openCreateEditor}>
                <Plus className="h-4 w-4 mr-2" /> New Invoice
              </Button>
            )}
          </div>
        ) : (
          <div className="relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="[&_tr]:border-b bg-muted/30">
                <tr className="border-b transition-colors">
                  <th className="h-12 w-10 px-2 align-middle">
                    <Checkbox checked={allBulkSelected} onCheckedChange={toggleBulkSelectAll} aria-label="Select all" className={someBulkSelected ? "opacity-70" : ""} />
                  </th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader label="Invoice" field="invoiceNumber" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Client</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader label="Date" field="invoiceDate" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Service</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Consultants</th>
                  <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                    <SortableHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                    <SortableHeader label="Amount" field="total" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="ml-auto" />
                  </th>
                  <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {invoices.map((invoice) => {
                  const codes = consultantCodes(invoice.consultantIds);
                  return (
                    <tr key={invoice.id} className={`border-b transition-colors hover:bg-muted/50 ${bulkIds.has(invoice.id) ? "bg-muted/30" : ""}`}>
                      <td className="w-10 px-2 align-middle">
                        <Checkbox checked={bulkIds.has(invoice.id)} onCheckedChange={() => toggleBulkSelect(invoice.id)} aria-label="Select row" />
                      </td>
                      <td className="p-4 align-middle">
                        <div className="font-medium flex items-center">
                          <FileText className="h-4 w-4 mr-2 text-muted-foreground" />
                          {invoice.invoiceNumber}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="font-medium">{invoice.clientName}</div>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="text-sm">{formatDate(invoice.invoiceDate)}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          Due: {formatDate(invoice.dueDate || invoice.invoiceDate)}
                          {isInvoiceOverdue(invoice) && (
                            <Badge variant="destructive" className="text-[10px] uppercase tracking-wider">
                              Overdue
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        <Badge variant="outline" className="text-xs">
                          {serviceCategoryLabel(invoice.serviceCategory)}
                        </Badge>
                      </td>
                      <td className="p-4 align-middle">
                        {codes ? (
                          <Badge variant="outline" className="font-mono text-xs">{codes}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="p-4 align-middle">
                        {invoice.cancellationReason ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className={`uppercase text-[10px] tracking-wider cursor-help ${getStatusColor(invoice.status)}`}>
                                  {invoice.status.replace("_", " ")}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                <p className="font-medium mb-0.5">Rejection reason:</p>
                                <p>{invoice.cancellationReason}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <Badge variant="outline" className={`uppercase text-[10px] tracking-wider ${getStatusColor(invoice.status)}`}>
                            {invoice.status.replace("_", " ")}
                          </Badge>
                        )}
                      </td>
                      <td className="p-4 align-middle text-right">
                        <div className="font-bold">{formatCurrency(invoice.total, invoice.currency)}</div>
                        {invoice.paidAmount > 0 && invoice.paidAmount < invoice.total && (
                          <>
                            <div className="text-xs text-muted-foreground">
                              Paid: {formatCurrency(invoice.paidAmount, invoice.currency)}
                              {" "}({Math.round((invoice.paidAmount / invoice.total) * 100)}%)
                            </div>
                            <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden ml-auto mt-1">
                              <div
                                className="h-full rounded-full bg-amber-500"
                                style={{ width: `${Math.min(100, Math.round((invoice.paidAmount / invoice.total) * 100))}%` }}
                              />
                            </div>
                          </>
                        )}
                        {invoice.paidAmount > 0 && invoice.paidAmount >= invoice.total && (
                          <div className="text-xs text-muted-foreground">
                            Paid: {formatCurrency(invoice.paidAmount, invoice.currency)}
                          </div>
                        )}
                      </td>
                      <td className="p-4 align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          {renderWorkflowButtons(invoice)}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Preview PDF"
                            onClick={() => setPreviewPdfInvoice(invoice)}
                          >
                            <FileDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => {
                              void openEditorForInvoice(invoice);
                            }}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {invoice.paidAmount < invoice.total && (
                                <DropdownMenuItem onClick={() => setLocation(`/payments?invoiceId=${encodeURIComponent(invoice.id)}&new=1`)}>
                                  <CreditCard className="h-4 w-4 mr-2" /> Record payment
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => handleDownloadPdf(invoice.id, invoice.invoiceNumber)}>
                                <Download className="h-4 w-4 mr-2" /> Download PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openSaveAsTemplate(invoice)}>
                                <BookmarkPlus className="h-4 w-4 mr-2" /> Save as Quotation Template
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDelete(invoice.id)} className="text-destructive">
                                <Trash2 className="h-4 w-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const bulkToolbar = bulkIds.size > 0 ? (
    <div className="flex items-center gap-2 p-2 bg-muted/60 rounded-md text-sm">
      <span className="font-medium">{bulkIds.size} selected</span>
      <div className="flex items-center gap-1 ml-2 flex-wrap">
        {bulkInvoiceActions.map((status) => (
          <Button
            key={status}
            size="sm"
            variant="outline"
            onClick={() => bulkSetInvoiceStatus(status)}
          >
            {invoiceBulkLabel(status)}
          </Button>
        ))}
        {bulkInvoiceActions.length === 0 && (
          <span className="text-muted-foreground text-xs">No shared status change for this selection</span>
        )}
        <Button size="sm" variant="destructive" onClick={bulkDeleteInvoices}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
        </Button>
      </div>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setBulkIds(new Set())}>Clear</Button>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Invoices</h2>
          <p className="text-muted-foreground text-sm hidden sm:block">Manage invoices and track payments.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport} title="Export CSV" className="hidden sm:inline-flex">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} title="Import CSV" className="hidden sm:inline-flex">
            <Upload className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeletedOpen(true)} title="Deleted invoices">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setContinuityOpen(true)} title="Verify invoice continuity">
            <ListChecks className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Continuity</span>
          </Button>
          <Button onClick={openCreateEditor} className="hidden md:inline-flex">
            <Plus className="h-4 w-4 mr-2" /> New Invoice
          </Button>
        </div>
      </div>

      {isMobile ? (
        <Tabs value={mobileTab} onValueChange={handleMobileTabChange}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">Invoice List</TabsTrigger>
            <TabsTrigger value="create">{editing ? "Edit Invoice" : "Create Invoice"}</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="space-y-6 mt-4">
            {filterToolbar}
            {bulkToolbar}
            {invoiceListCard}
          </TabsContent>
          <TabsContent value="create" className="mt-4">
            <div className="space-y-4">
              {editing && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPreviewPdfInvoice(editing)}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" /> Preview PDF
                  </Button>
                </div>
              )}
              {invoiceDocumentForm}
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {filterToolbar}
          {bulkToolbar}
          {invoiceListCard}
        </>
      )}

      {!isMobile && (
        <Dialog open={editorOpen} onOpenChange={(open) => (open ? setEditorOpen(true) : closeEditor())}>
          <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between gap-2">
                <DialogTitle>{editing ? "Edit Invoice" : "New Invoice"}</DialogTitle>
                {editing && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPreviewPdfInvoice(editing)}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" /> Preview PDF
                  </Button>
                )}
              </div>
            </DialogHeader>
            {invoiceDocumentForm}
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={!!numberChangeConfirm} onOpenChange={(open) => { if (!open) cancelNumberChangeConfirm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {numberChangeConfirm?.step === 2
                ? "Confirm invoice number change"
                : "Change invoice number?"}
            </DialogTitle>
            <DialogDescription>
              {numberChangeConfirm?.step === 2
                ? "Please confirm again. Changing the invoice number updates this invoice and any linked references."
                : "You are about to change the invoice number. This should only be done intentionally."}
            </DialogDescription>
          </DialogHeader>
          {numberChangeConfirm && (
            <div className="rounded-md border bg-muted/40 px-3 py-3 text-sm space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Current</span>
                <span className="font-mono font-medium">{numberChangeConfirm.from}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">New</span>
                <span className="font-mono font-medium">{numberChangeConfirm.to}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={cancelNumberChangeConfirm}>
              Cancel
            </Button>
            <Button
              variant={numberChangeConfirm?.step === 2 ? "destructive" : "default"}
              onClick={advanceNumberChangeConfirm}
              disabled={updateMutation.isPending}
            >
              {numberChangeConfirm?.step === 2 ? "Confirm change" : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reasonModal} onOpenChange={(open) => { if (!open) { setReasonModal(null); setReasonText(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Invoice</DialogTitle>
            <DialogDescription>Optionally provide a reason. This will be visible as a tooltip on the status badge.</DialogDescription>
          </DialogHeader>
          <Textarea
            ref={reasonTextareaRef}
            placeholder="Reason for rejection (optional)"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            className="min-h-[100px]"
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) confirmRejectModal(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReasonModal(null); setReasonText(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={confirmRejectModal} disabled={statusUpdatingId !== null}>
              <XCircle className="h-4 w-4 mr-2" /> Reject Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewPdfInvoice} onOpenChange={(open) => { if (!open) setPreviewPdfInvoice(null); }}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>
                PDF Preview — {previewPdfInvoice?.invoiceNumber}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={generateShareTokenMutation.isPending}
                  onClick={() => {
                    if (!previewPdfInvoice) return;
                    generateShareTokenMutation.mutate(
                      { id: previewPdfInvoice.id },
                      {
                        onSuccess: async (data) => {
                          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
                          const base = import.meta.env.BASE_URL ?? "/";
                          const path = `${base}invoices/${previewPdfInvoice.id}/preview?token=${encodeURIComponent(data.token)}`
                            .replace(/\/+/g, "/")
                            .replace(":/", "://");
                          const url = `${window.location.origin}${path}`;
                          const expiryDate = new Date(data.expiresAt).toLocaleDateString();
                          const copied = await copyText(url);
                          toast({
                            title: copied ? "Link copied" : "Share link ready",
                            description: copied
                              ? `Share link copied to clipboard. Expires on ${expiryDate}.`
                              : `${url} (expires ${expiryDate})`,
                          });
                        },
                        onError: () => {
                          toast({ title: "Error", description: "Failed to generate share link.", variant: "destructive" });
                        },
                      },
                    );
                  }}
                >
                  <Link className="h-3.5 w-3.5 mr-1" /> Copy share link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => previewPdfInvoice && handleDownloadPdf(previewPdfInvoice.id, previewPdfInvoice.invoiceNumber)}
                >
                  <FileDown className="h-3.5 w-3.5 mr-1" /> Download PDF
                </Button>
              </div>
            </div>
          </DialogHeader>
          <PdfBrandingReadiness
            logo={Boolean(settings?.logoUrl)}
            header={Boolean(settings?.headerLogoUrl)}
            chop={Boolean(settings?.chopUrl)}
            nonPersistentStorage={hasBranding && brandingStorageStatus?.persistent === false}
          />
          {previewPdfInvoice && (
            <PdfPreviewIframe
              pdfUrl={apiUrl(
                `/invoices/${previewPdfInvoice.id}/pdf?inline=true&v=${encodeURIComponent(settings?.updatedAt ?? "0")}`,
              )}
              title={`Invoice ${previewPdfInvoice.invoiceNumber} PDF Preview`}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={saveAsTemplateOpen} onOpenChange={(open) => { if (!open) { setSaveAsTemplateOpen(false); setSaveAsTemplateInvoice(null); setSaveAsTemplateName(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as Quotation Template</DialogTitle>
            <DialogDescription>Give this template a name. It will be available when creating quotations, not other invoices.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Template name"
            value={saveAsTemplateName}
            onChange={(e) => setSaveAsTemplateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveAsTemplate(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSaveAsTemplateOpen(false); setSaveAsTemplateInvoice(null); setSaveAsTemplateName(""); }}>Cancel</Button>
            <Button onClick={handleSaveAsTemplate} disabled={!saveAsTemplateName.trim() || createTplMutation.isPending}>
              <BookmarkPlus className="h-4 w-4 mr-2" /> Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        title={emailMode === "invoice" ? `Send Invoice ${emailInvoiceNumber ?? ""}` : `Send Reminder for ${emailInvoiceNumber ?? ""}`}
        description={emailMode === "invoice" ? "Send the invoice PDF to the client via email." : "Send a payment reminder to the client via email."}
        defaultEmail={emailDefaultTo}
        senderEmail1={settings?.gmailAccount1?.senderEmail}
        senderEmail2={settings?.gmailAccount2?.senderEmail}
        onSend={handleSendEmail}
        isSending={emailMode === "invoice" ? emailInvoiceMutation.isPending : emailReminderMutation.isPending}
      />

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importUrl={apiUrl("/invoices/import")}
        entityName="Invoices"
        validRowsImportFocus
        onSuccess={() => queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() })}
        templateUrl={apiUrl("/invoices/import/template")}
        csvTemplate={INVOICE_IMPORT_TEMPLATE}
      />

      <DeletedItemsDialog
        open={deletedOpen}
        onOpenChange={setDeletedOpen}
        entity="invoices"
        title="Deleted invoices"
        renderLabel={(row) => String(row.invoiceNumber ?? "Untitled")}
        renderSubLabel={(row) => (row.clientName ? String(row.clientName) : undefined)}
        onRestored={() => queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() })}
        canPurge
      />

      <InvoiceContinuityDialog open={continuityOpen} onOpenChange={setContinuityOpen} />
    </div>
  );
}
