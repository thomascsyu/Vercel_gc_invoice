import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  apiCreateJobOrder,
  apiDeleteJobOrder,
  apiEmailJobOrderToConsultant,
  apiExtractJobOrderFromProposal,
  apiJobOrderFromInvoice,
  apiJobOrderFromQuotation,
  apiListJobOrders,
  apiListConsultants,
  apiGetSettings,
  apiGetBrandingStorageStatus,
  apiUpdateJobOrder,
  type JobOrder,
  type Consultant,
  type LineItem,
  type ProposalExtractionResult,
} from "@/lib/modulesApi";
import { apiExtractProposalForJobOrder } from "@/lib/proposals-api";
import {
  useListQuotations,
  useListInvoices,
  useGetInvoice,
  getListQuotationsQueryKey,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
} from "@workspace/api-client-react";
import { ClientCombobox } from "@/components/client-combobox";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Plus,
  Trash2,
  FileText,
  Pencil,
  Download,
  Upload,
  ExternalLink,
  Mail,
  FileDown,
  Search,
  Sparkles,
  Check,
  ChevronsUpDown,
  Eye,
  CircleCheck,
  CalendarDays,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { PaginationControls } from "@/components/pagination-controls";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import { apiUrl } from "@/lib/api-base";
import { useDebounce } from "@/hooks/use-debounce";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ListQueryState } from "@/components/list-query-state";
import { PdfBrandingReadiness } from "@/components/pdf-branding-readiness";

const MAX_JOB_ORDER_CONSULTANTS = 3;

function PdfPreviewIframe({
  pdfUrl,
  title,
}: {
  pdfUrl: string;
  title: string;
}) {
  return (
    <div
      className="w-full overflow-hidden rounded-lg border bg-muted/20"
      style={{ height: "70vh" }}
    >
      <iframe src={pdfUrl} className="h-full w-full border-0" title={title} />
    </div>
  );
}

function ExtractionSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ProposalExtractionReview({
  data,
}: {
  data: ProposalExtractionResult;
}) {
  const f = data.fields;
  const scope = (f.proposedScopeOfCertification || f.scopeOfService).trim();
  const hasContact = Boolean(
    f.contactPerson.trim() || f.contactEmail.trim() || f.contactPhone.trim(),
  );
  const hasApproach = f.approachPhases.length > 0;
  const fallbackService = !hasApproach && f.clientService.trim();
  const fallbackResponsibilities =
    !hasApproach && f.clientResponsibilities.trim();
  const fallbackDeliverables =
    !hasApproach &&
    (f.deliverables.length > 0 || f.timeline.trim() || f.stages.length > 0);

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
      <p className="font-medium text-foreground">
        Extracted (review before applying)
      </p>
      {hasContact ? (
        <ExtractionSection label="Cover contact">
          {f.contactPerson.trim() ? <p>{f.contactPerson}</p> : null}
          {f.contactEmail.trim() ? <p>{f.contactEmail}</p> : null}
          {f.contactPhone.trim() ? <p>{f.contactPhone}</p> : null}
        </ExtractionSection>
      ) : null}
      {f.isoStandards.length > 0 ? (
        <ExtractionSection label="ISO standard">
          <p>{f.isoStandards.join(", ")}</p>
        </ExtractionSection>
      ) : null}
      {scope ? (
        <ExtractionSection label="Proposed scope of certification">
          <p className="whitespace-pre-wrap">{scope}</p>
        </ExtractionSection>
      ) : null}
      {hasApproach ? (
        <ExtractionSection label="The Approach">
          <div className="space-y-3">
            {f.approachPhases.map((phase) => (
              <div
                key={`${phase.phase}-${phase.title}`}
                className="rounded-md border bg-background/60 p-2 space-y-1"
              >
                <p className="font-medium">
                  Phase {phase.phase}
                  {phase.title ? `: ${phase.title}` : ""}
                </p>
                {phase.clientService.trim() ? (
                  <p className="whitespace-pre-wrap">
                    <span className="text-muted-foreground">
                      Client service —{" "}
                    </span>
                    {phase.clientService}
                  </p>
                ) : null}
                {phase.clientResponsibility.trim() ? (
                  <p className="whitespace-pre-wrap">
                    <span className="text-muted-foreground">
                      Client responsibility —{" "}
                    </span>
                    {phase.clientResponsibility}
                  </p>
                ) : null}
                {phase.deliverable.trim() ? (
                  <p className="whitespace-pre-wrap">
                    <span className="text-muted-foreground">
                      Deliverable —{" "}
                    </span>
                    {phase.deliverable}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </ExtractionSection>
      ) : null}
      {fallbackService ? (
        <ExtractionSection label="Client service">
          <p className="whitespace-pre-wrap">{f.clientService}</p>
        </ExtractionSection>
      ) : null}
      {fallbackResponsibilities ? (
        <ExtractionSection label="Client responsibilities">
          <p className="whitespace-pre-wrap">{f.clientResponsibilities}</p>
        </ExtractionSection>
      ) : null}
      {fallbackDeliverables ? (
        <ExtractionSection label="Deliverables and timeline">
          {f.stages.length > 0 ? (
            <ul className="list-disc pl-4 space-y-0.5">
              {f.stages.map((s, i) => (
                <li key={`stage-${i}`}>{s}</li>
              ))}
            </ul>
          ) : null}
          {f.deliverables.length > 0 ? (
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              {f.deliverables.map((d, i) => (
                <li key={`del-${i}`}>{d}</li>
              ))}
            </ul>
          ) : null}
          {f.timeline.trim() ? (
            <p className="mt-2 whitespace-pre-wrap">{f.timeline}</p>
          ) : null}
        </ExtractionSection>
      ) : f.timeline.trim() ? (
        <ExtractionSection label="Timeline">
          <p className="whitespace-pre-wrap">{f.timeline}</p>
        </ExtractionSection>
      ) : null}
    </div>
  );
}

const DOCUMENT_SEARCH_RESULT_LIMIT = 20;
const DOCUMENT_SEARCH_DEBOUNCE_MS = 250;

/** Server-searched quotation/invoice picker for the Convert-to-job-order dialog, so it never needs to preload every document. */
function DocumentCombobox({
  source,
  value,
  onSelect,
}: {
  source: "quotation" | "invoice";
  value: string;
  onSelect: (id: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, DOCUMENT_SEARCH_DEBOUNCE_MS);
  const [selectedLabel, setSelectedLabel] = useState("");

  const quotationParams = {
    q: debouncedQuery || undefined,
    pageSize: DOCUMENT_SEARCH_RESULT_LIMIT,
  };
  const invoiceParams = {
    q: debouncedQuery || undefined,
    pageSize: DOCUMENT_SEARCH_RESULT_LIMIT,
  };
  const quotationsResult = useListQuotations(quotationParams, {
    query: {
      queryKey: getListQuotationsQueryKey(quotationParams),
      enabled: open && source === "quotation",
    },
  });
  const invoicesResult = useListInvoices(invoiceParams, {
    query: {
      queryKey: getListInvoicesQueryKey(invoiceParams),
      enabled: open && source === "invoice",
    },
  });

  const options =
    source === "quotation"
      ? (quotationsResult.data?.data ?? []).map((x) => ({
          id: x.id,
          number: x.quotationNumber,
          clientName: x.clientName,
        }))
      : (invoicesResult.data?.data ?? []).map((x) => ({
          id: x.id,
          number: x.invoiceNumber,
          clientName: x.clientName,
        }));
  const isFetching =
    source === "quotation"
      ? quotationsResult.isFetching
      : invoicesResult.isFetching;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-9 px-3"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? selectedLabel || "Selected" : `Search ${source}s…`}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={source === "quotation" ? "Q number, $ amount, or client…" : "Type to search…"}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {isFetching ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Searching…
              </div>
            ) : (
              <>
                <CommandEmpty>No matching {source}.</CommandEmpty>
                <CommandGroup>
                  {options.map((o) => (
                    <CommandItem
                      key={o.id}
                      value={o.id}
                      onSelect={() => {
                        const label = `${o.number} · ${o.clientName ?? "Unknown client"}`;
                        onSelect(o.id, label);
                        setSelectedLabel(label);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === o.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{o.number}</span>
                      <span className="ml-2 text-xs text-muted-foreground shrink-0 truncate">
                        {o.clientName}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function JobOrdersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);

  const {
    data: jobOrdersPage,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["/job-orders", page, pageSize, debouncedSearch],
    queryFn: () =>
      apiListJobOrders({
        page,
        pageSize,
        search: debouncedSearch.trim() || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);
  const data = jobOrdersPage?.data ?? [];
  const total = jobOrdersPage?.total ?? 0;
  const showListSkeleton = isLoading && !jobOrdersPage;

  const { data: consultantsList } = useQuery({
    queryKey: ["/consultants"],
    queryFn: apiListConsultants,
  });
  const consultants: Consultant[] = consultantsList ?? [];
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

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<JobOrder | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertSource, setConvertSource] = useState<"quotation" | "invoice">(
    "quotation",
  );
  const [convertId, setConvertId] = useState("");
  const [convertConsultantIds, setConvertConsultantIds] = useState<string[]>(
    [],
  );

  // Email consultant dialog
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailJobOrderId, setEmailJobOrderId] = useState<string>("");
  const [emailConsultantId, setEmailConsultantId] = useState<string>("");
  const [previewPdfJobOrder, setPreviewPdfJobOrder] = useState<JobOrder | null>(
    null,
  );

  const emptyJobLine = (): LineItem => ({
    name: "",
    description: "",
    details: "",
    quantity: 1,
    price: 0,
    taxRate: 0,
  });

  const emptyForm: Partial<JobOrder> = {
    clientId: "",
    jobDate: new Date().toISOString().slice(0, 10),
    items: [emptyJobLine()],
    notes: "",
    consultantIds: [],
  };
  const [form, setForm] = useState<Partial<JobOrder>>(emptyForm);
  const resetForm = () => setForm(emptyForm);

  const [proposalDialogOpen, setProposalDialogOpen] = useState(false);
  const [proposalFile, setProposalFile] = useState<File | null>(null);
  const [proposalExtracted, setProposalExtracted] =
    useState<ProposalExtractionResult | null>(null);

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setOpen(true);
  };
  const openEdit = (jo: JobOrder) => {
    setEditing(jo);
    setForm({
      clientId: jo.clientId,
      jobDate: jo.jobDate,
      items: jo.items.length
        ? jo.items.map((it) => ({ ...emptyJobLine(), ...it }))
        : [emptyJobLine()],
      notes: jo.notes,
      consultantIds: jo.consultantIds ?? [],
    });
    setOpen(true);
  };

  const openEmailDialog = (jo: JobOrder) => {
    setEmailJobOrderId(jo.id);
    setEmailConsultantId("");
    setEmailOpen(true);
  };

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["/job-orders"] }),
    [qc],
  );

  const sanitizeJobOrderItems = (items: LineItem[] | undefined): LineItem[] => {
    const list = items ?? [];
    return list
      .filter(
        (it) => it.name?.trim() || it.description?.trim() || it.details?.trim(),
      )
      .map((it) => {
        let name = it.name?.trim() ?? "";
        const desc = it.description?.trim() ? it.description : undefined;
        const details = it.details?.trim() ? it.details : undefined;
        if (!name && desc) {
          const firstLine =
            desc
              .split(/\r?\n/)
              .map((l) => l.trim())
              .find((l) => l.length > 0) ?? desc;
          name = firstLine.slice(0, 500);
        }
        if (!name) name = "—";
        return {
          ...it,
          name,
          description: desc,
          details,
          quantity: it.quantity ?? 1,
          price: it.price ?? 0,
          taxRate: it.taxRate ?? 0,
        };
      });
  };

  const updateJobLineItem = (idx: number, patch: Partial<LineItem>) =>
    setForm((prev) => {
      const items = [...(prev.items ?? [])];
      items[idx] = { ...emptyJobLine(), ...items[idx], ...patch };
      return { ...prev, items };
    });

  const addJobLineItem = () =>
    setForm((prev) => ({
      ...prev,
      items: [...(prev.items ?? []), emptyJobLine()],
    }));

  const removeJobLineItem = (idx: number) =>
    setForm((prev) => {
      const items = (prev.items ?? []).filter((_, i) => i !== idx);
      return { ...prev, items: items.length ? items : [emptyJobLine()] };
    });

  const mergeExtractedText = (existing: string | undefined, block: string) => {
    const trimmed = (existing ?? "").trim();
    return trimmed.length > 0 ? `${trimmed}\n\n---\n\n${block}` : block;
  };

  const applyProposalExtraction = (data: ProposalExtractionResult) => {
    const { notes, lineItem } = data;
    setForm((f) => {
      const items = [...(f.items?.length ? f.items : [emptyJobLine()])];
      const first = { ...emptyJobLine(), ...items[0] };
      items[0] = {
        ...first,
        name: first.name?.trim() ? first.name : lineItem.name,
        description: first.description?.trim()
          ? first.description
          : lineItem.description || undefined,
        details: lineItem.details
          ? mergeExtractedText(first.details, lineItem.details)
          : first.details,
      };
      return {
        ...f,
        items,
        notes: mergeExtractedText(f.notes, notes),
      };
    });
    setProposalDialogOpen(false);
    setProposalFile(null);
    setProposalExtracted(null);
    toast({
      title: "Proposal applied",
      description:
        "Line item details and notes were updated. Review before saving the job order.",
    });
  };

  const extractProposalMut = useMutation({
    mutationFn: (file: File) => apiExtractJobOrderFromProposal(file),
    onSuccess: (data) => {
      setProposalExtracted(data);
      toast({
        title: "Proposal parsed",
        description:
          "Review the extracted sections, then apply to the line item and notes.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Extraction failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const extractLinkedProposalMut = useMutation({
    mutationFn: (proposalId: string) =>
      apiExtractProposalForJobOrder(proposalId),
    onSuccess: (data) => {
      setProposalExtracted(data);
      setProposalDialogOpen(true);
      toast({
        title: "Proposal parsed",
        description:
          "Review the extracted sections, then apply to the line item and notes.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Extraction failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      apiCreateJobOrder({
        ...form,
        items: sanitizeJobOrderItems(form.items),
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Job order created" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to create job order",
        description: e.message,
        variant: "destructive",
      }),
  });
  const updateMut = useMutation({
    mutationFn: () =>
      apiUpdateJobOrder(editing!.id, {
        ...form,
        items: sanitizeJobOrderItems(form.items),
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Job order updated" });
      setOpen(false);
      setEditing(null);
      resetForm();
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to update job order",
        description: e.message,
        variant: "destructive",
      }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDeleteJobOrder(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Job order deleted" });
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to delete job order",
        description: e.message,
        variant: "destructive",
      }),
  });
  const convertMut = useMutation({
    mutationFn: () =>
      convertSource === "quotation"
        ? apiJobOrderFromQuotation(convertId, convertConsultantIds)
        : apiJobOrderFromInvoice(convertId, convertConsultantIds),
    onSuccess: () => {
      invalidate();
      toast({ title: "Job order created from source" });
      setConvertOpen(false);
      setConvertId("");
      setConvertConsultantIds([]);
    },
    onError: (e: Error) =>
      toast({
        title: "Failed",
        description: e.message,
        variant: "destructive",
      }),
  });
  const emailMut = useMutation({
    mutationFn: () =>
      apiEmailJobOrderToConsultant(emailJobOrderId, emailConsultantId),
    onSuccess: (data) => {
      toast({ title: "Email sent", description: data.message });
      setEmailOpen(false);
      setEmailConsultantId("");
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to send email",
        description: e.message,
        variant: "destructive",
      }),
  });

  const consultantCodes = (ids?: string[]) => {
    if (!ids || ids.length === 0) return null;
    return ids
      .map((id) => consultants.find((c) => c.id === id)?.shortCode ?? "?")
      .join(" · ");
  };

  const toggleFormConsultant = (id: string) => {
    setForm((prev) => {
      const cur = [...(prev.consultantIds ?? [])];
      if (cur.includes(id))
        return { ...prev, consultantIds: cur.filter((x) => x !== id) };
      if (cur.length >= MAX_JOB_ORDER_CONSULTANTS) {
        toast({
          title: "Maximum consultants",
          description: `A job order can have at most ${MAX_JOB_ORDER_CONSULTANTS} consultants.`,
          variant: "destructive",
        });
        return prev;
      }
      return { ...prev, consultantIds: [...cur, id] };
    });
  };

  const toggleConvertConsultant = (id: string) => {
    setConvertConsultantIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_JOB_ORDER_CONSULTANTS) {
        toast({
          title: "Maximum consultants",
          description: `A job order can have at most ${MAX_JOB_ORDER_CONSULTANTS} consultants.`,
          variant: "destructive",
        });
        return cur;
      }
      return [...cur, id];
    });
  };

  const convertSourceInvoiceId =
    convertOpen && convertSource === "invoice" ? convertId : "";
  const { data: convertSourceInvoice } = useGetInvoice(convertSourceInvoiceId, {
    query: {
      queryKey: getGetInvoiceQueryKey(convertSourceInvoiceId),
      enabled: !!convertSourceInvoiceId,
    },
  });

  useEffect(() => {
    if (!convertOpen || !convertId) return;
    if (convertSource === "invoice") {
      const ids = convertSourceInvoice?.consultantIds
        ? [...new Set(convertSourceInvoice.consultantIds)].slice(
            0,
            MAX_JOB_ORDER_CONSULTANTS,
          )
        : [];
      setConvertConsultantIds(ids);
    } else {
      setConvertConsultantIds([]);
    }
  }, [convertOpen, convertSource, convertId, convertSourceInvoice]);

  const sourceLabel = (
    jo: JobOrder,
  ): { label: string; href: string | null } | null => {
    if (!jo.sourceType || !jo.sourceId) return null;
    if (jo.sourceType === "quotation") {
      return {
        label: jo.sourceNumber ?? "View quotation",
        href: `/quotations?open=${jo.sourceId}`,
      };
    }
    if (jo.sourceType === "invoice") {
      return {
        label: jo.sourceNumber ?? "View invoice",
        href: `/invoices?open=${jo.sourceId}`,
      };
    }
    if (jo.sourceType === "proposal") {
      return { label: "Proposal (editing turned off)", href: null };
    }
    return null;
  };

  const handleExportCsv = () => {
    const url = apiUrl("/job-orders/export");
    const a = document.createElement("a");
    a.href = url;
    a.download = "job-orders.csv";
    a.click();
  };

  const handleDownloadPdf = (jo: JobOrder) => {
    const url = apiUrl(`/job-orders/${jo.id}/pdf`);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-order-${jo.jobOrderNumber}.pdf`;
    a.click();
  };

  const jobOrderPreparation = [
    Boolean(form.clientId),
    Boolean(form.jobDate),
    sanitizeJobOrderItems(form.items).length > 0,
    Boolean(form.consultantIds?.length),
  ];
  const jobOrderProgress = Math.round(
    (jobOrderPreparation.filter(Boolean).length / jobOrderPreparation.length) *
      100,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Job Orders</h1>
          <p className="text-muted-foreground text-sm hidden sm:block">
            Create job orders manually, convert from quotations and invoices, or
            fill from a proposal PDF (cover contact, ISO standard, certification
            scope, and The Approach).
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Dialog
            open={convertOpen}
            onOpenChange={(v) => {
              setConvertOpen(v);
              if (!v) {
                setConvertId("");
                setConvertConsultantIds([]);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">
                <FileText className="h-4 w-4 mr-2" />
                Convert from…
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Convert to Job Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Source</Label>
                  <Select
                    value={convertSource}
                    onValueChange={(v) => {
                      setConvertSource(v as "quotation" | "invoice");
                      setConvertId("");
                      setConvertConsultantIds([]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quotation">Quotation</SelectItem>
                      <SelectItem value="invoice">Invoice</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>
                    {convertSource === "quotation" ? "Quotation" : "Invoice"}
                  </Label>
                  <DocumentCombobox
                    key={convertSource}
                    source={convertSource}
                    value={convertId}
                    onSelect={(id) => setConvertId(id)}
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <Label className="mb-0">Consultants</Label>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {convertConsultantIds.length}/{MAX_JOB_ORDER_CONSULTANTS}{" "}
                      selected
                      {convertSource === "invoice"
                        ? " · pre-filled from invoice"
                        : ""}
                    </span>
                  </div>
                  {consultants.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No consultants yet. Add them under Consultants.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1">
                      {consultants
                        .filter(
                          (c) =>
                            c.isActive || convertConsultantIds.includes(c.id),
                        )
                        .map((c) => {
                          const checked = convertConsultantIds.includes(c.id);
                          const maxReached =
                            convertConsultantIds.length >=
                            MAX_JOB_ORDER_CONSULTANTS;
                          return (
                            <label
                              key={c.id}
                              className={cn(
                                "flex items-center justify-center gap-2 rounded-md border p-2 cursor-pointer text-center text-xs",
                                checked
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:bg-muted/40",
                                !checked &&
                                  maxReached &&
                                  "opacity-50 cursor-not-allowed",
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={!checked && maxReached}
                                onCheckedChange={() =>
                                  toggleConvertConsultant(c.id)
                                }
                                className="sr-only"
                              />
                              <span className="font-mono">{c.shortCode}</span>
                            </label>
                          );
                        })}
                    </div>
                  )}
                </div>
                <Button
                  className="w-full"
                  disabled={!convertId}
                  onClick={() => convertMut.mutate()}
                >
                  Convert
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) {
                setEditing(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New job order
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[760px]">
              <DialogHeader className="pt-2">
                <DialogTitle>
                  {editing ? "Edit job order" : "New job order"}
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  Prepare the client brief, assign the team, and review the
                  scope before issuing.
                </p>
              </DialogHeader>
              <div className="space-y-5">
                <div className="rounded-xl border border-amber-200/70 bg-gradient-to-r from-amber-50 to-orange-50/50 p-4 shadow-sm dark:border-amber-900/50 dark:from-amber-950/30 dark:to-orange-950/20">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        Job order readiness
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Complete the handoff essentials for your delivery team.
                      </p>
                    </div>
                    <span className="font-mono text-sm font-semibold text-amber-700 dark:text-amber-300">
                      {jobOrderProgress}% ready
                    </span>
                  </div>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-950"
                    role="progressbar"
                    aria-label={`${jobOrderProgress}% of job order preparation complete`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={jobOrderProgress}
                  >
                    <div
                      className="h-full rounded-full bg-amber-500 transition-[width] duration-300"
                      style={{ width: `${jobOrderProgress}%` }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    {["Client", "Schedule", "Scope", "Team"].map(
                      (label, index) => (
                        <span
                          key={label}
                          className={cn(
                            "flex items-center gap-1.5",
                            jobOrderPreparation[index]
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-muted-foreground",
                          )}
                        >
                          <CircleCheck className="h-3.5 w-3.5" /> {label}
                        </span>
                      ),
                    )}
                  </div>
                </div>
                {editing &&
                  (() => {
                    const src = sourceLabel(editing);
                    if (!src) return null;
                    return (
                      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">
                          Linked source:
                        </span>
                        {src.href ? (
                          <Link
                            href={src.href}
                            className="inline-flex items-center gap-1 font-medium hover:underline"
                          >
                            <span className="capitalize">
                              {editing.sourceType}
                            </span>
                            <span className="font-mono">{src.label}</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="font-medium">{src.label}</span>
                        )}
                      </div>
                    );
                  })()}
                <div className="flex items-center gap-2 border-b pb-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    <Users className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      Client &amp; delivery team
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Choose who the work is for and who owns delivery.
                    </p>
                  </div>
                </div>
                <div>
                  <Label>Client</Label>
                  <ClientCombobox
                    key={editing?.id ?? "new"}
                    value={form.clientId ?? ""}
                    onChange={(id) => setForm({ ...form, clientId: id })}
                    initialLabel={editing?.clientName}
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <Label className="mb-0">Consultants</Label>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {(form.consultantIds ?? []).length}/
                      {MAX_JOB_ORDER_CONSULTANTS} selected
                    </span>
                  </div>
                  {consultants.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No consultants yet. Add them under Consultants.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1">
                      {consultants
                        .filter(
                          (c) =>
                            c.isActive ||
                            (form.consultantIds ?? []).includes(c.id),
                        )
                        .map((c) => {
                          const checked = (form.consultantIds ?? []).includes(
                            c.id,
                          );
                          const maxReached =
                            (form.consultantIds ?? []).length >=
                            MAX_JOB_ORDER_CONSULTANTS;
                          return (
                            <label
                              key={c.id}
                              className={cn(
                                "flex items-center justify-center gap-2 rounded-md border p-2 cursor-pointer text-center text-xs",
                                checked
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:bg-muted/40",
                                !checked &&
                                  maxReached &&
                                  "opacity-50 cursor-not-allowed",
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={!checked && maxReached}
                                onCheckedChange={() =>
                                  toggleFormConsultant(c.id)
                                }
                                className="sr-only"
                              />
                              <span className="font-mono">{c.shortCode}</span>
                            </label>
                          );
                        })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 border-b pb-2 pt-1">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      Schedule &amp; scope
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Set the work date and write a clear delivery brief.
                    </p>
                  </div>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={form.jobDate ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, jobDate: e.target.value })
                    }
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Line items</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={addJobLineItem}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add line
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {(form.items ?? []).map((it, idx) => (
                      <div
                        key={idx}
                        className="rounded-md border p-2 space-y-2 bg-muted/30"
                      >
                        <Textarea
                          placeholder="Title (first line on PDF)"
                          rows={2}
                          className="text-sm resize-none font-medium"
                          value={it.name}
                          onChange={(e) =>
                            updateJobLineItem(idx, { name: e.target.value })
                          }
                        />
                        <Textarea
                          placeholder="Description — use Enter for more lines (optional)"
                          rows={2}
                          className="text-sm resize-y"
                          value={it.description ?? ""}
                          onChange={(e) =>
                            updateJobLineItem(idx, {
                              description: e.target.value,
                            })
                          }
                        />
                        <Textarea
                          placeholder="Details / fine print (optional)"
                          rows={3}
                          className="text-sm resize-y"
                          value={it.details ?? ""}
                          onChange={(e) =>
                            updateJobLineItem(idx, { details: e.target.value })
                          }
                        />
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => removeJobLineItem(idx)}
                            disabled={(form.items ?? []).length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={form.notes ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                    rows={6}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 mr-2"
                    onClick={() => {
                      setProposalDialogOpen(true);
                      setProposalFile(null);
                      setProposalExtracted(null);
                    }}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Fill from proposal PDF
                  </Button>
                  {editing?.sourceType === "proposal" && editing.sourceId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={extractLinkedProposalMut.isPending}
                      onClick={() =>
                        extractLinkedProposalMut.mutate(editing.sourceId!)
                      }
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      {extractLinkedProposalMut.isPending
                        ? "Extracting…"
                        : "Extract from linked proposal"}
                    </Button>
                  )}
                </div>
                <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
                  <p className="hidden text-xs text-muted-foreground sm:block">
                    Client, date, and at least one scope item are required.
                  </p>
                  <Button
                    className="ml-auto min-w-36"
                    onClick={() =>
                      editing ? updateMut.mutate() : createMut.mutate()
                    }
                    disabled={
                      !form.clientId ||
                      !form.jobDate ||
                      sanitizeJobOrderItems(form.items).length === 0
                    }
                  >
                    {editing ? "Save changes" : "Create job order"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Dialog
        open={Boolean(previewPdfJobOrder)}
        onOpenChange={(next) => {
          if (!next) setPreviewPdfJobOrder(null);
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              Job Order {previewPdfJobOrder?.jobOrderNumber} · PDF Preview
            </DialogTitle>
          </DialogHeader>
          <PdfBrandingReadiness
            logo={Boolean(settings?.logoUrl)}
            header={Boolean(settings?.headerLogoUrl)}
            chop={Boolean(settings?.chopUrl)}
            includeChop={false}
            nonPersistentStorage={hasBranding && brandingStorageStatus?.persistent === false}
          />
          {previewPdfJobOrder ? (
            <PdfPreviewIframe
              pdfUrl={apiUrl(
                `/job-orders/${previewPdfJobOrder.id}/pdf?inline=true&v=${encodeURIComponent(settings?.updatedAt ?? "0")}`,
              )}
              title={`Job Order ${previewPdfJobOrder.jobOrderNumber} PDF Preview`}
            />
          ) : null}
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() =>
                previewPdfJobOrder && handleDownloadPdf(previewPdfJobOrder)
              }
            >
              <FileDown className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Email consultant dialog */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email Job Order to Consultant</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Select a consultant to email this job order PDF to. Make sure
              Gmail is configured in company settings.
            </p>
            <div>
              <Label>Consultant</Label>
              <Select
                value={emailConsultantId}
                onValueChange={setEmailConsultantId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select consultant…" />
                </SelectTrigger>
                <SelectContent>
                  {consultants
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.email ? ` (${c.email})` : " — no email"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!emailConsultantId || emailMut.isPending}
              onClick={() => emailMut.mutate()}
            >
              <Mail className="h-4 w-4 mr-2" />
              {emailMut.isPending ? "Sending…" : "Send email"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <PaginationControls
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              isLoading={isFetching}
            />
            <div className="relative flex-1 min-w-[12rem] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-9"
                placeholder="Search job orders…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search job orders"
              />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 hidden sm:inline-flex"
                  onClick={handleExportCsv}
                  aria-label="Export job orders as CSV"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export CSV</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 hidden sm:inline-flex"
                  onClick={() => setImportOpen(true)}
                  aria-label="Import job orders from CSV"
                >
                  <Upload className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Import CSV</TooltipContent>
            </Tooltip>
          </div>
          <ListQueryState
            isLoading={showListSkeleton}
            isError={isError}
            error={error}
            isEmpty={data.length === 0}
            emptyMessage="No job orders yet."
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Consultants</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((jo) => (
                  <TableRow key={jo.id}>
                    <TableCell className="font-mono">
                      {jo.jobOrderNumber}
                    </TableCell>
                    <TableCell>{jo.clientName ?? "—"}</TableCell>
                    <TableCell>{jo.jobDate}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {consultantCodes(jo.consultantIds) ?? "—"}
                    </TableCell>
                    <TableCell>
                      {jo.sourceBroken ? (
                        <span className="text-destructive text-xs">
                          Source {jo.sourceType} no longer exists
                        </span>
                      ) : (
                        (() => {
                          const src = sourceLabel(jo);
                          if (!src)
                            return (
                              <span className="text-muted-foreground text-xs">
                                manual
                              </span>
                            );
                          if (!src.href) {
                            return (
                              <span className="inline-flex items-center gap-1">
                                <Badge variant="outline" className="capitalize">
                                  {jo.sourceType}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {src.label}
                                </span>
                              </span>
                            );
                          }
                          return (
                            <Link
                              href={src.href}
                              className="inline-flex items-center gap-1 group"
                            >
                              <Badge variant="outline" className="capitalize">
                                {jo.sourceType}
                              </Badge>
                              <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                                {src.label}
                              </span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                            </Link>
                          );
                        })()
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Preview branded PDF"
                        aria-label={`Preview PDF for ${jo.jobOrderNumber}`}
                        onClick={() => setPreviewPdfJobOrder(jo)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Download PDF"
                        onClick={() => handleDownloadPdf(jo)}
                      >
                        <FileDown className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Email to consultant"
                        onClick={() => openEmailDialog(jo)}
                      >
                        <Mail className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(jo)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteMut.mutate(jo.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListQueryState>
        </CardContent>
      </Card>

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importUrl={apiUrl("/job-orders/import")}
        entityName="Job Orders"
        onSuccess={() => qc.invalidateQueries({ queryKey: ["/job-orders"] })}
        templateUrl={apiUrl("/job-orders/import/template")}
      />

      <Dialog
        open={proposalDialogOpen}
        onOpenChange={(v) => {
          setProposalDialogOpen(v);
          if (!v) {
            setProposalFile(null);
            setProposalExtracted(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Fill from proposal</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Upload a proposal PDF, Word (.docx), or text file. The cover contact
            person, email and telephone (when present), proposed scope of
            certification, ISO standard, and The Approach (client service,
            client responsibility, and deliverable per phase) are copied into
            the first line item and notes. Configure DeepSeek under Admin to
            improve extraction of unusual layouts.
          </p>
          <div className="space-y-2">
            <Label>Proposal file</Label>
            <Input
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setProposalFile(f);
                setProposalExtracted(null);
              }}
            />
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={!proposalFile || extractProposalMut.isPending}
            onClick={() =>
              proposalFile && extractProposalMut.mutate(proposalFile)
            }
          >
            {extractProposalMut.isPending
              ? "Extracting…"
              : "Extract from proposal"}
          </Button>
          {proposalExtracted && (
            <>
              <ProposalExtractionReview data={proposalExtracted} />
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => applyProposalExtraction(proposalExtracted)}
                >
                  Apply to job order
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setProposalExtracted(null);
                  }}
                >
                  Clear result
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
