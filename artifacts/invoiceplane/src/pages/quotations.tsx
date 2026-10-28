import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  useListQuotations,
  useDeleteQuotation,
  useCreateQuotation,
  useUpdateQuotation,
  useGetQuotation,
  getGetQuotationQueryKey,
  useListQuotationTemplates,
  useCreateQuotationTemplate,
  useUpdateQuotationTemplate,
  useDeleteQuotationTemplate,
  useReorderQuotationTemplates,
  useGenerateShareToken,
  useRevokeShareToken,
  useEmailQuotation,
  getListQuotationsQueryKey,
  getListQuotationTemplatesQueryKey,
  getListInvoicesQueryKey,
  getQuotation,
  getClient,
  convertQuotation,
  type ConvertQuotationInput,
  type Quotation,
  type QuotationStatus,
  type Currency,
  type InvoiceLineItem,
  type QuotationListSortBy,
  type SortDirection,
} from "@workspace/api-client-react";
import { useSearch, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate, copyText } from "@/lib/utils";
import { businessCalendarToday, bulkQuotationStatusTargets, canConvertQuotation, formInvoiceStatuses, formQuotationStatuses, type QuotationWorkflowStatus } from "@workspace/invoice-utils";
import {
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  FileSignature,
  Download,
  Upload,
  X,
  LayoutTemplate,
  CheckCircle,
  XCircle,
  Send,
  ThumbsUp,
  ClipboardCheck,
  FilePlus,
  ExternalLink,
  BookmarkPlus,
  FileDown,
  User,
  Eye,
  Link,
  Link2Off,
  Search,
} from "lucide-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmailDialog } from "@/components/email-dialog";
import { PdfBrandingReadiness } from "@/components/pdf-branding-readiness";
import { apiGetSettings, apiGetBrandingStorageStatus, apiPatchQuotationStatus, apiBulkDeleteQuotations, apiBulkSetQuotationStatus, apiListConsultants } from "@/lib/modulesApi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import DocumentForm, { serviceCategoryLabel, type DocumentFormValues, type DocumentFormTemplateProps } from "@/components/document-form";
import { PaginationControls } from "@/components/pagination-controls";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import { TemplatesDrawer } from "@/components/templates-drawer";
import { Checkbox } from "@/components/ui/checkbox";
import { SortableHeader } from "@/components/sortable-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiUrl } from "@/lib/api-base";
import { DeletedItemsDialog } from "@/components/deleted-items-dialog";
import { useDebounce } from "@/hooks/use-debounce";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { describeApiFailure } from "@/lib/describeApiFailure";
import { PdfPreviewIframe } from "@/components/pdf-preview-iframe";

const QUOTATION_STATUSES: QuotationStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "skip",
  "confirmed",
  "canceled",
  "invoiced",
];

type QuotationValidity = "expired" | "expiring_soon" | "active";

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function getQuotationValidity(validUntil: string | null | undefined): QuotationValidity {
  if (!validUntil) return "active";
  const today = businessCalendarToday();
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const dueMs = Date.parse(`${validUntil}T00:00:00Z`);
  const diffDays = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "expired";
  if (diffDays <= 7) return "expiring_soon";
  return "active";
}

export default function Quotations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"list" | "create">("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  /** Bumped whenever the quotation editor opens so DocumentForm remounts with fresh state. */
  const [quotationFormKey, setQuotationFormKey] = useState(0);
  const [convertFormKey, setConvertFormKey] = useState(0);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [templateInitial, setTemplateInitial] = useState<Partial<DocumentFormValues> | undefined>(undefined);
  const [openWithTemplates, setOpenWithTemplates] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [importOpen, setImportOpen] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [templatesDrawerOpen, setTemplatesDrawerOpen] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [convertingQuotation, setConvertingQuotation] = useState<Quotation | null>(null);
  const [convertSubmitting, setConvertSubmitting] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
  const [saveAsTemplateQuotation, setSaveAsTemplateQuotation] = useState<Quotation | null>(null);
  const [saveAsTemplateName, setSaveAsTemplateName] = useState("");
  const [previewPdfQuotation, setPreviewPdfQuotation] = useState<Quotation | null>(null);

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailQuotationId, setEmailQuotationId] = useState<string | null>(null);
  const [emailQuotationNumber, setEmailQuotationNumber] = useState<string | null>(null);
  const [emailDefaultTo, setEmailDefaultTo] = useState<string>("");

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
  const { data: consultants = [] } = useQuery({
    queryKey: ["/consultants"],
    queryFn: apiListConsultants,
  });

  const emailQuotationMutation = useEmailQuotation();

  const search = useSearch();
  const [location, setLocation] = useLocation();
  const openId = new URLSearchParams(search).get("open") ?? "";
  const [autoOpenedId, setAutoOpenedId] = useState("");

  const { data: openTarget, isError: openError } = useGetQuotation(openId, {
    query: {
      queryKey: getGetQuotationQueryKey(openId),
      enabled: !!openId && autoOpenedId !== openId,
      retry: false,
    },
  });

  useEffect(() => {
    if (openTarget && autoOpenedId !== openId) {
      setAutoOpenedId(openId);
      const sp = new URLSearchParams(search);
      sp.delete("open");
      const qs = sp.toString();
      setLocation(qs ? `/quotations?${qs}` : "/quotations", { replace: true });
      if (openTarget.status === "invoiced") {
        toast({ title: "Cannot edit invoiced quotation", description: "This quotation has already been invoiced and cannot be edited.", variant: "destructive" });
      } else {
        setEditing(openTarget);
        setTemplateInitial(undefined);
        setQuotationFormKey((k) => k + 1);
        if (isMobile) {
          setMobileTab("create");
        } else {
          setDialogOpen(true);
        }
      }
    }
  }, [openTarget, openId, autoOpenedId, setLocation, toast, search, isMobile]);

  useEffect(() => {
    if (openError && openId) {
      toast({ title: "Quotation not found", description: "The linked quotation may have been deleted.", variant: "destructive" });
      const sp = new URLSearchParams(search);
      sp.delete("open");
      const qs = sp.toString();
      setLocation(qs ? `/quotations?${qs}` : "/quotations", { replace: true });
    }
  }, [openError, openId, setLocation, toast, search]);

  const FILTER_KEY = "quotations_filters";
  const readSavedFilters = () => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? "{}"); } catch { return {}; }
  };
  const [filterStatus, setFilterStatusRaw] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("status");
      if (fromUrl) return fromUrl;
    }
    return readSavedFilters().status ?? "";
  });
  const [filterValidityStatus, setFilterValidityStatusRaw] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("validity");
      if (fromUrl) return fromUrl;
    }
    return readSavedFilters().validityStatus ?? "";
  });
  const [searchQuery, setSearchQueryRaw] = useState(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("q");
      if (fromUrl) return fromUrl;
    }
    return readSavedFilters().q ?? "";
  });
  const debouncedSearch = useDebounce(searchQuery, 250);

  const persistFilters = (status: string, validityStatus: string, q: string) => {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ status, validityStatus, q })); } catch { /* ignore */ }
    const params = new URLSearchParams(search);
    if (status) params.set("status", status); else params.delete("status");
    if (validityStatus) params.set("validity", validityStatus); else params.delete("validity");
    if (q.trim()) params.set("q", q.trim()); else params.delete("q");
    params.delete("clientId");
    const qs = params.toString();
    const nextSearch = qs ? `?${qs}` : "";
    if (nextSearch !== search) {
      setLocation(qs ? `/quotations?${qs}` : "/quotations", { replace: true });
    }
  };

  const setFilterStatus = (value: string) => {
    setFilterStatusRaw(value);
    persistFilters(value, filterValidityStatus, searchQuery);
  };
  const setFilterValidityStatus = (value: string) => {
    setFilterValidityStatusRaw(value);
    persistFilters(filterStatus, value, searchQuery);
  };
  const setSearchQuery = (value: string) => {
    setSearchQueryRaw(value);
    persistFilters(filterStatus, filterValidityStatus, value);
  };

  const SORT_KEY = "quotations_sort";
  const readSavedSort = () => {
    try { return JSON.parse(sessionStorage.getItem(SORT_KEY) ?? "{}"); } catch { return {}; }
  };
  const [sortBy, setSortByRaw] = useState<QuotationListSortBy | null>(
    () => (readSavedSort().sortBy as QuotationListSortBy | undefined) ?? null,
  );
  const [sortDir, setSortDirRaw] = useState<SortDirection>(() => (readSavedSort().sortDir as SortDirection | undefined) ?? "asc");

  const persistSort = (by: QuotationListSortBy | null, dir: SortDirection) => {
    try {
      if (by) { sessionStorage.setItem(SORT_KEY, JSON.stringify({ sortBy: by, sortDir: dir })); }
      else { sessionStorage.removeItem(SORT_KEY); }
    } catch { /* ignore */ }
  };

  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());

  const params = {
    page,
    pageSize,
    ...(filterStatus ? { status: filterStatus as QuotationStatus } : {}),
    ...(filterValidityStatus ? { validityStatus: filterValidityStatus as "active" | "expired" } : {}),
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
    ...(sortBy ? { sortBy, sortDir } : {}),
  };
  const { data: quotationsPage, isLoading, isFetching, isError: listError, error: listFetchError, refetch: refetchQuotations } = useListQuotations(
    params,
    { query: { queryKey: getListQuotationsQueryKey(params), placeholderData: keepPreviousData } },
  );
  const quotations = quotationsPage?.data ?? [];
  const total = quotationsPage?.total ?? 0;

  const bulkSelectedQuotations = useMemo(
    () => quotations.filter((q) => bulkIds.has(q.id)),
    [quotations, bulkIds],
  );
  const bulkQuotationActions = useMemo(() => {
    const statuses = bulkSelectedQuotations.map((q) =>
      q.convertedInvoiceId ? "invoiced" : q.status,
    );
    return bulkQuotationStatusTargets(statuses).filter((target) =>
      statuses.some((s) => s !== target),
    );
  }, [bulkSelectedQuotations]);

  const quotationBulkLabel = (status: QuotationWorkflowStatus) => {
    switch (status) {
      case "pending_approval":
        return "Submit";
      case "approved":
        return "Approve";
      case "sent":
        return "Mark sent";
      case "skip":
        return "Skip send";
      case "canceled":
        return "Cancel";
      case "confirmed":
        return "Confirm";
      default:
        return status.replace(/_/g, " ");
    }
  };
  const showListSkeleton = isLoading && !quotationsPage;

  const deleteMutation = useDeleteQuotation();
  const createMutation = useCreateQuotation();
  const updateMutation = useUpdateQuotation();
  const generateShareTokenMutation = useGenerateShareToken();
  const revokeShareTokenMutation = useRevokeShareToken();
  const [reasonModal, setReasonModal] = useState<{ quotation: Quotation; newStatus: QuotationStatus; action: string } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const reasonTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const { data: tplPage } = useListQuotationTemplates({ pageSize: 200 });
  const templates = tplPage?.data ?? [];
  const createTplMutation = useCreateQuotationTemplate();
  const updateTplMutation = useUpdateQuotationTemplate();
  const deleteTplMutation = useDeleteQuotationTemplate();
  const reorderTplMutation = useReorderQuotationTemplates();

  const hasFilters = !!(filterStatus || filterValidityStatus || searchQuery);

  const clearFilters = () => {
    setFilterStatusRaw("");
    setFilterValidityStatusRaw("");
    setSearchQueryRaw("");
    persistFilters("", "", "");
    try { sessionStorage.removeItem(FILTER_KEY); } catch { /* ignore */ }
    setPage(1);
  };

  const handleSort = (field: string) => {
    const f = field as QuotationListSortBy;
    if (sortBy === f) {
      const newDir: SortDirection = sortDir === "asc" ? "desc" : "asc";
      setSortDirRaw(newDir);
      persistSort(f, newDir);
    } else {
      setSortByRaw(f);
      setSortDirRaw("asc");
      persistSort(f, "asc");
    }
    setPage(1);
  };

  const quotationIds = quotations.map(q => q.id);
  const allBulkSelected = quotationIds.length > 0 && quotationIds.every(id => bulkIds.has(id));
  const someBulkSelected = quotationIds.some(id => bulkIds.has(id)) && !allBulkSelected;

  const toggleBulkSelectAll = () => {
    if (allBulkSelected) {
      setBulkIds(prev => { const n = new Set(prev); quotationIds.forEach(id => n.delete(id)); return n; });
    } else {
      setBulkIds(prev => { const n = new Set(prev); quotationIds.forEach(id => n.add(id)); return n; });
    }
  };

  const toggleBulkSelect = (id: string) => {
    setBulkIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const bulkDeleteQuotations = async () => {
    const ids = [...bulkIds];
    if (!ids.length) return;
    try {
      await apiBulkDeleteQuotations(ids);
      setBulkIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
      toast({ title: `Deleted ${ids.length} quotation(s)` });
    } catch (err) {
      toast({
        title: "Bulk delete failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const bulkSetQuotationStatus = async (status: QuotationStatus) => {
    const ids = [...bulkIds];
    if (!ids.length) return;
    try {
      await apiBulkSetQuotationStatus(ids, status);
      setBulkIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
      toast({ title: `Updated ${ids.length} quotation(s) to ${status}` });
    } catch (err) {
      toast({
        title: "Bulk update failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const closeDialog = () => {
    if (formDirty && !window.confirm("Discard unsaved changes?")) return;
    setFormDirty(false);
    setDialogOpen(false);
    setEditing(null);
    setTemplateInitial(undefined);
    setOpenWithTemplates(false);
    if (isMobile) setMobileTab("list");
    if (openId) {
      const sp = new URLSearchParams(search);
      sp.delete("open");
      const qs = sp.toString();
      setLocation(qs ? `/quotations?${qs}` : "/quotations", { replace: true });
    }
  };

  const openCreateEditor = (options?: { withTemplates?: boolean }) => {
    setEditing(null);
    setTemplateInitial(undefined);
    setOpenWithTemplates(options?.withTemplates ?? false);
    setQuotationFormKey((k) => k + 1);
    if (isMobile) {
      setMobileTab("create");
    } else {
      setDialogOpen(true);
    }
  };

  const handleMobileTabChange = (value: string) => {
    if (value === "list" && mobileTab === "create") {
      if (formDirty && !window.confirm("Discard unsaved changes?")) return;
      setFormDirty(false);
      setEditing(null);
      setTemplateInitial(undefined);
      setOpenWithTemplates(false);
    }
    setMobileTab(value as "list" | "create");
  };

  const openNew = () => openCreateEditor();

  const handleCreateTemplate = (name: string, items: InvoiceLineItem[], currency?: Currency, discountAmount?: number) => {
    createTplMutation.mutate(
      { data: { name, items, ...(currency !== undefined ? { currency } : {}), ...(discountAmount !== undefined ? { discountAmount } : {}) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListQuotationTemplatesQueryKey() });
          toast({ title: "Template saved" });
        },
        onError: (err: Error) => toast({ title: "Failed to save template", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleUpdateTemplate = (id: string, name: string, items: InvoiceLineItem[]) => {
    updateTplMutation.mutate(
      { id, data: { name, items } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListQuotationTemplatesQueryKey() });
          toast({ title: "Template updated" });
        },
        onError: (err: Error) => toast({ title: "Failed to update template", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleRenameTemplate = (id: string, newName: string) => {
    updateTplMutation.mutate(
      { id, data: { name: newName } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListQuotationTemplatesQueryKey() });
          toast({ title: "Template renamed" });
        },
        onError: (err: Error) => toast({ title: "Failed to rename template", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleDeleteTemplate = (id: string) => {
    if (!confirm("Delete this template?")) return;
    deleteTplMutation.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListQuotationTemplatesQueryKey() });
          toast({ title: "Template deleted" });
        },
        onError: (err: Error) => toast({ title: "Failed to delete template", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleReorderTemplates = (ids: string[]) => {
    reorderTplMutation.mutate(
      { data: { ids } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListQuotationTemplatesQueryKey() });
        },
        onError: (err: Error) => toast({ title: "Failed to save order", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleDuplicateTemplate = (tpl: { name: string; currency: Currency; discountAmount: number; items: InvoiceLineItem[] }) => {
    createTplMutation.mutate(
      { data: { name: `Copy of ${tpl.name}`, items: tpl.items.map((i) => ({ ...i })), currency: tpl.currency, discountAmount: tpl.discountAmount } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListQuotationTemplatesQueryKey() });
          toast({ title: "Template duplicated", description: `"Copy of ${tpl.name}" has been created.` });
        },
        onError: (err: Error) => toast({ title: "Failed to duplicate template", description: err.message, variant: "destructive" }),
      },
    );
  };

  const openSaveAsTemplate = async (quotation: Quotation) => {
    const defaultName = quotation.quotationNumber || quotation.clientName || "Template";
    try {
      const full = await getQuotation(quotation.id);
      setSaveAsTemplateQuotation(full);
      setSaveAsTemplateName(defaultName);
      setSaveAsTemplateOpen(true);
    } catch (err) {
      toast({
        title: "Failed to load quotation",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleSaveAsTemplate = () => {
    if (!saveAsTemplateQuotation || !saveAsTemplateName.trim()) return;
    const q = saveAsTemplateQuotation;
    createTplMutation.mutate(
      { data: { name: saveAsTemplateName.trim(), items: q.items, currency: q.currency, discountAmount: q.discountAmount } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListQuotationTemplatesQueryKey() });
          toast({ title: "Template saved", description: `"${saveAsTemplateName.trim()}" has been added to your templates.` });
          setSaveAsTemplateOpen(false);
          setSaveAsTemplateQuotation(null);
          setSaveAsTemplateName("");
        },
        onError: (err: Error) => toast({ title: "Failed to save template", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleApplyTemplate = (tpl: { currency: Currency; discountAmount: number; items: InvoiceLineItem[] }) => {
    setEditing(null);
    setTemplateInitial({
      currency: tpl.currency,
      discountAmount: tpl.discountAmount,
      items: tpl.items,
      // Set default Terms & Conditions and Remark when applying a template
      termsConditions: "Terms and condition details refer to https://gabriel.hk/gtc/",
      remark: "Payment terms: 100% after confirmation of this quotation",
    });
    setQuotationFormKey((k) => k + 1);
    if (isMobile) {
      setMobileTab("create");
    } else {
      setDialogOpen(true);
    }
  };

  const templateProps: DocumentFormTemplateProps = {
    templates,
    onCreateTemplate: handleCreateTemplate,
    onRenameTemplate: handleRenameTemplate,
    onDeleteTemplate: handleDeleteTemplate,
    isCreating: createTplMutation.isPending,
  };

  const handleSubmit = (values: DocumentFormValues) => {
    const payload = {
      clientId: values.clientId,
      quotationDate: values.date,
      validUntil: values.dueOrValid,
      status: values.status as QuotationStatus,
      currency: values.currency,
      discountAmount: values.discountAmount,
      items: values.items,
      serviceCategory: values.serviceCategory,
      termsConditions: values.termsConditions || undefined,
      remark: values.remark || undefined,
      // Send "" when cleared so PATCH can persist null (omitted keys are ignored server-side).
      quotationAttn: values.quotationAttn?.trim() ?? "",
    };
    const onSuccess = (msg: string) => {
      queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
      toast({ title: msg });
      closeDialog();
    };
    const onError = (err: Error) =>
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, data: payload },
        { onSuccess: () => onSuccess("Quotation updated"), onError },
      );
    } else {
      createMutation.mutate(
        { data: payload },
        { onSuccess: () => onSuccess("Quotation created"), onError },
      );
    }
  };

  const handleStatusUpdate = async (quotation: Quotation, newStatus: QuotationStatus, reason?: string) => {
    setStatusUpdatingId(quotation.id);
    const isCancellation = newStatus === "canceled";
    try {
      await apiPatchQuotationStatus(quotation.id, {
        status: newStatus,
        ...(isCancellation ? { cancellationReason: reason ?? "" } : {}),
      });
      queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
      toast({ title: `Quotation ${newStatus.replace("_", " ")}` });
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

  const openEditorForQuotation = async (quotation: Quotation) => {
    try {
      const full = await getQuotation(quotation.id);
      setEditing(full);
      setTemplateInitial(undefined);
      setQuotationFormKey((k) => k + 1);
      if (isMobile) {
        setMobileTab("create");
      } else {
        setDialogOpen(true);
      }
    } catch (err) {
      toast({
        title: "Failed to load quotation",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openConvertForQuotation = async (quotation: Quotation) => {
    try {
      const full = await getQuotation(quotation.id);
      if (!canConvertQuotation(full.status)) {
        toast({
          title: "Quotation is not confirmed",
          description: "Confirm the quotation before creating an invoice.",
          variant: "destructive",
        });
        return;
      }
      setConvertingQuotation(full);
      setConvertFormKey((k) => k + 1);
      setConvertDialogOpen(true);
    } catch (err) {
      toast({
        title: "Failed to load quotation",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openReasonModal = (quotation: Quotation, newStatus: QuotationStatus, action: string) => {
    setReasonText("");
    setReasonModal({ quotation, newStatus, action });
    setTimeout(() => reasonTextareaRef.current?.focus(), 50);
  };

  const confirmReasonModal = async () => {
    if (!reasonModal) return;
    await handleStatusUpdate(reasonModal.quotation, reasonModal.newStatus, reasonText);
    setReasonModal(null);
    setReasonText("");
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this quotation?")) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
            toast({ title: "Quotation deleted" });
          },
          onError: (err: Error) =>
            toast({ title: "Failed to delete quotation", description: err.message, variant: "destructive" }),
        },
      );
    }
  };

  const handleExport = () => {
    const url = apiUrl("/quotations/export");
    const a = document.createElement("a");
    a.href = url;
    a.download = "quotations.csv";
    a.click();
  };

  const handleDownloadPdf = (quotation: Quotation) => {
    const url = apiUrl(`/quotations/${quotation.id}/pdf`);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quotation-${quotation.quotationNumber}.pdf`;
    a.click();
  };

  const openEmailDialog = (quotation: Quotation) => {
    setEmailQuotationId(quotation.id);
    setEmailQuotationNumber(quotation.quotationNumber);
    setEmailDefaultTo("");
    setEmailDialogOpen(true);
    if (quotation.clientId) {
      void getClient(quotation.clientId)
        .then((client) => {
          if (client.email) setEmailDefaultTo(client.email);
        })
        .catch(() => {
          /* recipient stays blank */
        });
    }
  };

  const handleSendEmail = async (params: {
    to: string;
    slot: 1 | 2;
    cc?: string;
    bcc?: string;
    contactPersonOverride?: string;
  }) => {
    if (!emailQuotationId) return;

    try {
      await emailQuotationMutation.mutateAsync({
        id: emailQuotationId,
        data: {
          to: params.to,
          slot: params.slot,
          cc: params.cc,
          bcc: params.bcc,
          contactPersonOverride: params.contactPersonOverride?.trim() || undefined,
        },
      });
      toast({
        title: "Quotation sent",
        description: `Email sent to ${params.to}`,
      });
      // Update status to "sent" after successful email
      const quotation = quotations.find(q => q.id === emailQuotationId);
      if (quotation && quotation.status === "approved") {
        handleStatusUpdate(quotation, "sent");
      }
      setEmailDialogOpen(false);
      setEmailQuotationId(null);
    } catch (err) {
      toast({
        title: "Failed to send email",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleSkipSend = () => {
    if (!emailQuotationId) return;

    const quotation = quotations.find(q => q.id === emailQuotationId);
    if (quotation && quotation.status === "approved") {
      handleStatusUpdate(quotation, "skip");
      toast({
        title: "Quotation skipped",
        description: `Quotation ${quotation.quotationNumber} marked as skip (no email sent).`,
      });
    }
    setEmailDialogOpen(false);
    setEmailQuotationId(null);
  };

  const handleConvertSubmit = async (values: DocumentFormValues) => {
    if (!convertingQuotation) return;
    const today = businessCalendarToday();
    const payload: ConvertQuotationInput = {
      clientId: values.clientId,
      invoiceDate: values.date || today,
      dueDate: values.dueOrValid || today,
      status: (values.status || "draft") as ConvertQuotationInput["status"],
      currency: values.currency,
      discountAmount: values.discountAmount,
      items: values.items,
      serviceCategory: values.serviceCategory,
      consultantIds: values.consultantIds ?? [],
      notes: values.notes || undefined,
      internalNote: values.internalNote?.trim() || undefined,
      termsConditions: values.termsConditions || undefined,
      remark: values.remark || undefined,
    };
    const quotationToMark = convertingQuotation;
    setConvertSubmitting(true);
    try {
      await convertQuotation(quotationToMark.id, payload);
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
      toast({ title: "Invoice created", description: `Invoice created from quotation ${quotationToMark.quotationNumber}.` });
      setConvertDialogOpen(false);
      setConvertingQuotation(null);
      setFormDirty(false);
    } catch (err) {
      toast({
        title: "Failed to create invoice",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setConvertSubmitting(false);
    }
  };

  const getStatusColor = (status: string) => {
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

  const renderWorkflowButtons = (quotation: Quotation) => {
    const status = quotation.status;
    if (quotation.convertedInvoiceId) {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs text-purple-700 border-purple-300 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-800 dark:hover:bg-purple-950"
          onClick={() => setLocation(`/invoices?open=${quotation.convertedInvoiceId}`)}
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1" /> View Invoice
        </Button>
      );
    }
    if (status === "draft") {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => handleStatusUpdate(quotation, "pending_approval")}
          disabled={statusUpdatingId === quotation.id}
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
            onClick={() => handleStatusUpdate(quotation, "approved")}
            disabled={statusUpdatingId === quotation.id}
          >
            <ThumbsUp className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
            onClick={() => openReasonModal(quotation, "canceled", "Reject")}
            disabled={statusUpdatingId === quotation.id}
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
          onClick={() => openEmailDialog(quotation)}
          disabled={emailQuotationMutation.isPending}
        >
          <Send className="h-3.5 w-3.5 mr-1" /> Send Quotation
        </Button>
      );
    }
    if (status === "sent" || status === "skip") {
      return (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950"
            onClick={() => handleStatusUpdate(quotation, "confirmed")}
            disabled={statusUpdatingId === quotation.id}
          >
            <CheckCircle className="h-3.5 w-3.5 mr-1" /> Confirm
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
            onClick={() => openReasonModal(quotation, "canceled", "Cancel")}
            disabled={statusUpdatingId === quotation.id}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
        </div>
      );
    }
    if (status === "confirmed") {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs text-indigo-700 border-indigo-300 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-800 dark:hover:bg-indigo-950"
          onClick={() => {
            void openConvertForQuotation(quotation);
          }}
        >
          <FilePlus className="h-3.5 w-3.5 mr-1" /> Create Invoice
        </Button>
      );
    }
    if (status === "invoiced") {
      return (
        <Badge
          variant="outline"
          className="h-7 px-2 text-xs bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20"
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Invoiced
        </Badge>
      );
    }
    return null;
  };

  const quotationDocumentForm = (
    <DocumentForm
      key={`quotation-${editing?.id ?? "new"}-${quotationFormKey}`}
      kind="quotation"
      statuses={formQuotationStatuses(editing?.status ?? templateInitial?.status ?? "draft")}
      submitting={createMutation.isPending || updateMutation.isPending}
      initialClientName={editing?.clientName}
      initial={
        editing
          ? {
              clientId: editing.clientId,
              date: editing.quotationDate,
              dueOrValid: editing.validUntil ?? editing.quotationDate,
              currency: editing.currency,
              status: editing.status,
              discountAmount: editing.discountAmount,
              items: editing.items,
              serviceCategory: editing.serviceCategory,
              termsConditions: editing.termsConditions ?? "",
              remark: editing.remark ?? "",
              quotationAttn: editing.quotationAttn ?? "",
            }
          : templateInitial
      }
      onSubmit={handleSubmit}
      onCancel={closeDialog}
      onDirtyChange={setFormDirty}
      templateProps={templateProps}
      scrollToTemplates={openWithTemplates}
      clientHistory={{ currentQuotationId: editing?.id }}
    />
  );

  const filterToolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="w-[280px] h-8 text-sm pl-8"
          placeholder="Q number, $ amount, or client…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          aria-label="Search quotations by Q number, dollar amount, or client name/code"
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
          {QUOTATION_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filterValidityStatus || "all"}
        onValueChange={(v) => { setFilterValidityStatus(v === "all" ? "" : v); setPage(1); }}
      >
        <SelectTrigger className="w-[150px] h-8 text-sm">
          <SelectValue placeholder="Validity" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All validity</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="expired">Expired</SelectItem>
        </SelectContent>
      </Select>
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
      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={clearFilters}>
          <X className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
      )}
    </div>
  );

  const bulkToolbar = bulkIds.size > 0 ? (
    <div className="flex items-center gap-2 p-2 bg-muted/60 rounded-md text-sm">
      <span className="font-medium">{bulkIds.size} selected</span>
      <div className="flex items-center gap-1 ml-2 flex-wrap">
        {bulkQuotationActions.map((status) => (
          <Button
            key={status}
            size="sm"
            variant="outline"
            onClick={() => bulkSetQuotationStatus(status)}
          >
            {quotationBulkLabel(status)}
          </Button>
        ))}
        {bulkQuotationActions.length === 0 && (
          <span className="text-muted-foreground text-xs">No shared status change for this selection</span>
        )}
        <Button size="sm" variant="destructive" onClick={bulkDeleteQuotations}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
        </Button>
      </div>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setBulkIds(new Set())}>Clear</Button>
    </div>
  ) : null;

  const quotationListCard = (
    <Card className="bg-card">
        <CardContent className="p-0">
          {listError ? (
            <div className="text-center py-12 px-4 space-y-3">
              <p className="text-destructive text-sm">{describeApiFailure(listFetchError)}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetchQuotations()}>
                Retry
              </Button>
            </div>
          ) : showListSkeleton ? (
            <div className="p-6 space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded"></div>
              ))}
            </div>
          ) : !quotations.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>{hasFilters ? "No quotations match the current filters." : "No quotations found. Create your first one."}</p>
              {!hasFilters && (
                <Button className="mt-4" onClick={openNew}>
                  <Plus className="h-4 w-4 mr-2" /> New Quotation
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
                      <SortableHeader label="Quotation" field="quotationNumber" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Client</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Service</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      <SortableHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                      <SortableHeader label="Amount" field="total" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="ml-auto" />
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      <SortableHeader label="Created" field="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {quotations.map((quotation, idx) => {
                    const isActionable = quotation.status !== "canceled" && quotation.status !== "confirmed" && !quotation.convertedInvoiceId;
                    const validity = isActionable ? getQuotationValidity(quotation.validUntil) : "active";
                    const isExpiredActionable = isActionable && validity === "expired";
                    const prevQuotation = idx > 0 ? quotations[idx - 1] : null;
                    const prevIsActionable = !!prevQuotation && prevQuotation.status !== "canceled" && prevQuotation.status !== "confirmed" && !prevQuotation.convertedInvoiceId;
                    const prevIsExpiredActionable = prevIsActionable && getQuotationValidity(prevQuotation!.validUntil) === "expired";
                    const showDivider = !filterValidityStatus && idx > 0 && !isExpiredActionable && prevIsExpiredActionable;
                    return (
                      <React.Fragment key={quotation.id}>
                        {showDivider && (
                          <tr className="border-b">
                            <td colSpan={8} className="px-4 py-1.5 bg-muted/40 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                              Other quotations
                            </td>
                          </tr>
                        )}
                        {idx === 0 && isExpiredActionable && !filterValidityStatus && (
                          <tr className="border-b">
                            <td colSpan={8} className="px-4 py-1.5 bg-red-50 dark:bg-red-950/30 text-[11px] font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">
                              Expired — needs follow-up
                            </td>
                          </tr>
                        )}
                    <tr className={`border-b transition-colors hover:bg-muted/50 ${bulkIds.has(quotation.id) ? "bg-muted/30" : ""}`}>
                      <td className="w-10 px-2 align-middle">
                        <Checkbox checked={bulkIds.has(quotation.id)} onCheckedChange={() => toggleBulkSelect(quotation.id)} aria-label="Select row" />
                      </td>
                      <td className="p-4 align-middle">
                        <div className="font-medium flex items-center">
                          <FileSignature className="h-4 w-4 mr-2 text-muted-foreground" />
                          {quotation.quotationNumber}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="font-medium">{quotation.clientName}</div>
                      </td>
                      <td className="p-4 align-middle">
                        <Badge variant="outline" className="text-xs">
                          {serviceCategoryLabel(quotation.serviceCategory)}
                        </Badge>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          {(() => {
                            const displayStatus = quotation.convertedInvoiceId ? "invoiced" : quotation.status;
                            const label = displayStatus.replace("_", " ");
                            if (quotation.cancellationReason) {
                              return (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge
                                        variant="outline"
                                        className={`uppercase text-[10px] tracking-wider cursor-help ${getStatusColor(displayStatus)}`}
                                      >
                                        {label}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs text-xs">
                                      <p className="font-medium mb-0.5">Reason:</p>
                                      <p>{quotation.cancellationReason}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            }
                            return (
                              <Badge
                                variant="outline"
                                className={`uppercase text-[10px] tracking-wider ${getStatusColor(displayStatus)}`}
                              >
                                {label}
                              </Badge>
                            );
                          })()}
                          {isActionable && validity === "expired" && (
                            <Badge className="uppercase text-[10px] tracking-wider bg-red-100 text-red-700 border-red-200 border hover:bg-red-100">
                              Expired
                            </Badge>
                          )}
                          {isActionable && validity === "expiring_soon" && (
                            <Badge className="uppercase text-[10px] tracking-wider bg-yellow-100 text-yellow-700 border-yellow-200 border hover:bg-yellow-100">
                              Expiring soon
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-4 align-middle text-right">
                        <div className="font-bold">{formatCurrency(quotation.total, quotation.currency)}</div>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="text-sm text-muted-foreground">{formatDate(quotation.createdAt)}</div>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          {renderWorkflowButtons(quotation)}
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setPreviewPdfQuotation(quotation)}
                                >
                                  <FileDown className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">Preview PDF</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {quotation.status !== "invoiced" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                void openEditorForQuotation(quotation);
                              }}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleDownloadPdf(quotation)}>
                                <FileDown className="h-4 w-4 mr-2" /> Download PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openSaveAsTemplate(quotation)}>
                                <BookmarkPlus className="h-4 w-4 mr-2" /> Save as Template
                              </DropdownMenuItem>
                              {quotation.shareToken && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => {
                                      revokeShareTokenMutation.mutate(
                                        { id: quotation.id },
                                        {
                                          onSuccess: () => {
                                            queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
                                            toast({ title: "Share link revoked", description: "The share link is no longer active." });
                                          },
                                          onError: () => {
                                            toast({ title: "Error", description: "Failed to revoke share link.", variant: "destructive" });
                                          },
                                        },
                                      );
                                    }}
                                  >
                                    <Link2Off className="h-4 w-4 mr-2" /> Revoke share link
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleDelete(quotation.id)} className="text-destructive">
                                <Trash2 className="h-4 w-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Quotations</h2>
          <p className="text-muted-foreground text-sm hidden sm:block">Send quotations and convert confirmed ones to invoices.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport} title="Export CSV" className="hidden sm:inline-flex">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} title="Import CSV" className="hidden sm:inline-flex">
            <Upload className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeletedOpen(true)} title="Deleted quotations">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTemplatesDrawerOpen(true)}>
            <LayoutTemplate className="h-4 w-4 mr-2" /> Templates
          </Button>
          <Button onClick={openNew} className="hidden md:inline-flex">
            <Plus className="h-4 w-4 mr-2" /> New Quotation
          </Button>
        </div>
      </div>

      {isMobile ? (
        <Tabs value={mobileTab} onValueChange={handleMobileTabChange}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">Quotation List</TabsTrigger>
            <TabsTrigger value="create">{editing ? "Edit Quotation" : "Create Quotation"}</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="space-y-6 mt-4">
            {filterToolbar}
            {bulkToolbar}
            {quotationListCard}
          </TabsContent>
          <TabsContent value="create" className="mt-4">
            <div className="space-y-4">
              {editing && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPreviewPdfQuotation(editing)}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" /> Preview PDF
                  </Button>
                </div>
              )}
              {quotationDocumentForm}
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {filterToolbar}
          {bulkToolbar}
          {quotationListCard}
        </>
      )}

      {!isMobile && (
        <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
          <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between gap-2">
                <DialogTitle>{editing ? "Edit Quotation" : "New Quotation"}</DialogTitle>
                {editing && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPreviewPdfQuotation(editing)}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" /> Preview PDF
                  </Button>
                )}
              </div>
            </DialogHeader>
            {quotationDocumentForm}
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={convertDialogOpen} onOpenChange={(open) => {
        if (!open) {
          if (formDirty && !window.confirm("Discard unsaved changes?")) return;
          setConvertDialogOpen(false);
          setConvertingQuotation(null);
          setFormDirty(false);
        }
      }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Convert quotation to invoice</DialogTitle>
            <DialogDescription>
              Review copied details and payment dates. Creating the invoice will mark {convertingQuotation?.quotationNumber} as invoiced.
            </DialogDescription>
          </DialogHeader>
          <DocumentForm
            key={`convert-${convertingQuotation?.id ?? "none"}-${convertFormKey}`}
            kind="invoice"
            statuses={formInvoiceStatuses("draft")}
            submitting={convertSubmitting}
            consultants={consultants}
            initialClientName={convertingQuotation?.clientName}
            conversionSource={convertingQuotation ? {
              quotationNumber: convertingQuotation.quotationNumber,
              clientName: convertingQuotation.clientName ?? "Unnamed client",
              itemCount: convertingQuotation.items.length,
            } : undefined}
            initial={
              convertingQuotation
                ? {
                    clientId: convertingQuotation.clientId,
                    date: businessCalendarToday(),
                    dueOrValid: addCalendarDays(businessCalendarToday(), 14),
                    currency: convertingQuotation.currency,
                    status: "draft",
                    discountAmount: convertingQuotation.discountAmount,
                    items: convertingQuotation.items,
                    serviceCategory: convertingQuotation.serviceCategory,
                    notes: `Created from quotation ${convertingQuotation.quotationNumber}`,
                  }
                : undefined
            }
            onSubmit={handleConvertSubmit}
            onCancel={() => {
              if (formDirty && !window.confirm("Discard unsaved changes?")) return;
              setConvertDialogOpen(false);
              setConvertingQuotation(null);
              setFormDirty(false);
            }}
            onDirtyChange={setFormDirty}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!reasonModal} onOpenChange={(open) => { if (!open) { setReasonModal(null); setReasonText(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{reasonModal?.action} Quotation</DialogTitle>
            <DialogDescription>Optionally provide a reason. This will be visible as a tooltip on the status badge.</DialogDescription>
          </DialogHeader>
          <Textarea
            ref={reasonTextareaRef}
            placeholder="Reason (optional)"
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            className="min-h-[100px]"
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) confirmReasonModal(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReasonModal(null); setReasonText(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={confirmReasonModal} disabled={statusUpdatingId !== null}>
              <XCircle className="h-4 w-4 mr-2" /> {reasonModal?.action} Quotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={saveAsTemplateOpen}
        onOpenChange={(open) => {
          if (!open) { setSaveAsTemplateOpen(false); setSaveAsTemplateQuotation(null); setSaveAsTemplateName(""); }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Give this template a name. It will include all line items, currency, and discount from{" "}
              {saveAsTemplateQuotation?.quotationNumber}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {(saveAsTemplateQuotation?.quotationNumber || saveAsTemplateQuotation?.clientName) && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Quick pick a starting name:</p>
                <div className="flex flex-wrap gap-2">
                  {saveAsTemplateQuotation?.quotationNumber && (
                    <button
                      type="button"
                      onClick={() => setSaveAsTemplateName(saveAsTemplateQuotation.quotationNumber!)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${saveAsTemplateName === saveAsTemplateQuotation.quotationNumber ? "bg-primary text-primary-foreground border-primary" : "border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                    >
                      <FileSignature className="h-3 w-3" />
                      {saveAsTemplateQuotation.quotationNumber}
                    </button>
                  )}
                  {saveAsTemplateQuotation?.clientName && (
                    <button
                      type="button"
                      onClick={() => setSaveAsTemplateName(saveAsTemplateQuotation.clientName!)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${saveAsTemplateName === saveAsTemplateQuotation.clientName ? "bg-primary text-primary-foreground border-primary" : "border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                    >
                      <User className="h-3 w-3" />
                      {saveAsTemplateQuotation.clientName}
                    </button>
                  )}
                  {saveAsTemplateQuotation?.quotationNumber && saveAsTemplateQuotation?.clientName && (
                    <button
                      type="button"
                      onClick={() => setSaveAsTemplateName(`${saveAsTemplateQuotation.clientName} – ${saveAsTemplateQuotation.quotationNumber}`)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${saveAsTemplateName === `${saveAsTemplateQuotation.clientName} – ${saveAsTemplateQuotation.quotationNumber}` ? "bg-primary text-primary-foreground border-primary" : "border-border bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
                    >
                      Combined
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Template Name</label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={saveAsTemplateName}
                autoFocus
                onChange={(e) => setSaveAsTemplateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveAsTemplate();
                  if (e.key === "Escape") { setSaveAsTemplateOpen(false); setSaveAsTemplateQuotation(null); setSaveAsTemplateName(""); }
                }}
                placeholder="e.g. Standard Consulting Package"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSaveAsTemplateOpen(false); setSaveAsTemplateQuotation(null); setSaveAsTemplateName(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveAsTemplate}
              disabled={!saveAsTemplateName.trim() || createTplMutation.isPending}
            >
              <BookmarkPlus className="h-4 w-4 mr-2" />
              {createTplMutation.isPending ? "Saving…" : "Save Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewPdfQuotation} onOpenChange={(open) => { if (!open) setPreviewPdfQuotation(null); }}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle>
                PDF Preview — {previewPdfQuotation?.quotationNumber}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={generateShareTokenMutation.isPending}
                  onClick={() => {
                    if (!previewPdfQuotation) return;
                    generateShareTokenMutation.mutate(
                      { id: previewPdfQuotation.id },
                      {
                        onSuccess: async (data) => {
                          queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
                          const base = import.meta.env.BASE_URL ?? "/";
                          const path = `${base}quotations/${previewPdfQuotation.id}/preview?token=${encodeURIComponent(data.token)}`
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
                  onClick={() => previewPdfQuotation && handleDownloadPdf(previewPdfQuotation)}
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
          {previewPdfQuotation && (
            <PdfPreviewIframe
              pdfUrl={apiUrl(
                `/quotations/${previewPdfQuotation.id}/pdf?inline=true&v=${encodeURIComponent(settings?.updatedAt ?? "0")}`,
              )}
              title={`Quotation ${previewPdfQuotation.quotationNumber} PDF Preview`}
            />
          )}
        </DialogContent>
      </Dialog>

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importUrl={apiUrl("/quotations/import")}
        entityName="Quotations"
        onSuccess={() => queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() })}
        templateUrl={apiUrl("/quotations/import/template")}
      />

      <DeletedItemsDialog
        open={deletedOpen}
        onOpenChange={setDeletedOpen}
        entity="quotations"
        title="Deleted quotations"
        renderLabel={(row) => String(row.quotationNumber ?? "Untitled")}
        renderSubLabel={(row) => (row.clientName ? String(row.clientName) : undefined)}
        onRestored={() => queryClient.invalidateQueries({ queryKey: getListQuotationsQueryKey() })}
      />

      <TemplatesDrawer
        open={templatesDrawerOpen}
        onOpenChange={setTemplatesDrawerOpen}
        templates={templates}
        onCreateTemplate={handleCreateTemplate}
        onUpdateTemplate={handleUpdateTemplate}
        onRenameTemplate={handleRenameTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        onApplyTemplate={handleApplyTemplate}
        onDuplicateTemplate={handleDuplicateTemplate}
        onReorderTemplates={handleReorderTemplates}
        isCreating={createTplMutation.isPending}
        isUpdating={updateTplMutation.isPending}
      />

      <EmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        title={`Send Quotation ${emailQuotationNumber ?? ""}`}
        description="Send the quotation PDF to the client via email."
        showRecipientOverride
        defaultEmail={emailDefaultTo}
        senderEmail1={settings?.gmailAccount1?.senderEmail}
        senderEmail2={settings?.gmailAccount2?.senderEmail}
        onSend={handleSendEmail}
        isSending={emailQuotationMutation.isPending}
        showSkip
        onSkip={handleSkipSend}
      />
    </div>
  );
}
