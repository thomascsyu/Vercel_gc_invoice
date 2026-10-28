import { useEffect, useState, useRef } from "react";
import { customFetch } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { calculateDocumentTotals } from "@workspace/invoice-utils";
import type {
  InvoiceLineItem,
  Currency,
  QuotationTemplate,
  ServiceCategory,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  LayoutTemplate,
  Check,
  X,
  Building2,
  CalendarDays,
  CircleCheck,
  FileText,
  ReceiptText,
  ArrowRight,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";
import { ClientCombobox } from "@/components/client-combobox";
import { ClientHistoryPanel } from "@/components/client-history-panel";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  invoiceDescriptionDisplay,
  invoiceDescriptionToStored,
  lineItemHasContent,
  lineItemPreviewLabel,
  quotationDescriptionDisplay,
  quotationItemToStored,
} from "@/lib/lineItemText";

const CURRENCIES: Currency[] = ["HKD", "USD", "CNY", "MOP"];

export type DocumentFormValues = {
  clientId: string;
  date: string;
  dueOrValid: string;
  currency: Currency;
  status: string;
  discountAmount: number;
  items: InvoiceLineItem[];
  invoiceNumber?: string;
  notes?: string;
  /** Staff-only; never shown on the invoice PDF or client documents. */
  internalNote?: string;
  termsConditions?: string;
  remark?: string;
  /** Shown on quotation PDF as "Attn :" after the static To line. */
  quotationAttn?: string;
  consultantIds?: string[];
  serviceCategory: ServiceCategory;
};

export type DocumentFormTemplateProps = {
  templates: QuotationTemplate[];
  onCreateTemplate: (
    name: string,
    items: InvoiceLineItem[],
    currency?: Currency,
    discountAmount?: number,
  ) => void;
  onRenameTemplate: (id: string, newName: string) => void;
  onDeleteTemplate: (id: string) => void;
  isCreating?: boolean;
};

export type Consultant = {
  id: string;
  shortCode: string;
  name: string;
  isActive: boolean;
};

type Props = {
  kind: "invoice" | "quotation";
  initial?: Partial<DocumentFormValues>;
  statuses: string[];
  submitting?: boolean;
  onSubmit: (values: DocumentFormValues) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  templateProps?: DocumentFormTemplateProps;
  scrollToTemplates?: boolean;
  consultants?: Consultant[];
  /** Display name for `initial.clientId`, shown before the client combobox has been searched. */
  initialClientName?: string;
  /** Adds a right-hand column with the selected client's last four years of invoices and quotations. */
  clientHistory?: { currentQuotationId?: string };
  /** Invoice number shown when editing an existing invoice (enables the revised toggle). */
  invoiceNumber?: string;
  /** Context shown when an invoice is being created from a confirmed quotation. */
  conversionSource?: {
    quotationNumber: string;
    clientName: string;
    itemCount: number;
  };
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};

const INVOICE_REVISED_SUFFIX = /-REVISED(?:-\d+)?$/;

export function previewRevisedInvoiceNumber(invoiceNumber: string): string {
  const base = invoiceNumber.replace(INVOICE_REVISED_SUFFIX, "");
  const match = invoiceNumber.match(/-REVISED(?:-(\d+))?$/);
  if (!match) return `${base}-REVISED`;
  const nextRevision = match[1] ? parseInt(match[1], 10) + 1 : 2;
  return `${base}-REVISED-${nextRevision}`;
}

const DEFAULT_TERMS_CONDITIONS =
  "Terms and condition details refer to https://gabriel.hk/gtc/";
const DEFAULT_REMARK =
  "Payment terms: 100% after confirmation of this quotation";
const MAX_INVOICE_CONSULTANTS = 3;

export const SERVICE_CATEGORY_OPTIONS: Array<{
  value: ServiceCategory;
  label: string;
  description: string;
}> = [
  { value: "setup", label: "Setup", description: "System setup" },
  { value: "main", label: "Main", description: "Maintenance after setup" },
  { value: "pen", label: "Pen", description: "PenTest" },
  { value: "vscan", label: "Vscan", description: "Vulnerability scanning" },
  { value: "others", label: "Others", description: "Unclassified or misc" },
];

export function serviceCategoryLabel(value: ServiceCategory | undefined) {
  return (
    SERVICE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ??
    "Others"
  );
}

const emptyItem = (): InvoiceLineItem => ({
  name: "",
  description: "",
  details: "",
  quantity: 1,
  price: 0,
  taxRate: 0,
});

export default function DocumentForm({
  kind,
  initial,
  statuses,
  submitting,
  onSubmit,
  onCancel,
  onDirtyChange,
  templateProps,
  scrollToTemplates,
  consultants = [],
  initialClientName,
  clientHistory,
  invoiceNumber,
  conversionSource,
}: Props) {
  const { toast } = useToast();
  const statusBeforeRevisionRef = useRef(
    initial?.status === "revised" ? "sent" : (initial?.status ?? "draft"),
  );
  const [values, setValues] = useState<DocumentFormValues>(() => {
    // Determine if this is a fresh new quotation (not editing, not from template)
    // When editing, clientId will be present. When applying template, items will be present.
    const isFreshNewQuotation =
      kind === "quotation" && !initial?.clientId && !initial?.items?.length;

    return {
      clientId: initial?.clientId ?? "",
      date: initial?.date ?? today(),
      dueOrValid: initial?.dueOrValid ?? plusDays(14),
      currency: initial?.currency ?? "HKD",
      status: initial?.status ?? "draft",
      discountAmount: initial?.discountAmount ?? 0,
      items:
        initial?.items && initial.items.length > 0
          ? initial.items.map((it) => ({
              ...emptyItem(),
              ...it,
              quantity: it.quantity ?? 1,
            }))
          : [emptyItem()],
      notes: initial?.notes ?? "",
      internalNote: initial?.internalNote ?? "",
      // For fresh new quotations, set default Terms & Conditions and Remark
      termsConditions:
        initial?.termsConditions ??
        (isFreshNewQuotation ? DEFAULT_TERMS_CONDITIONS : ""),
      remark: initial?.remark ?? (isFreshNewQuotation ? DEFAULT_REMARK : ""),
      quotationAttn: initial?.quotationAttn ?? "",
      consultantIds: initial?.consultantIds ?? [],
      serviceCategory: initial?.serviceCategory ?? "others",
      invoiceNumber: initial?.invoiceNumber ?? invoiceNumber ?? "",
    };
  });

  const isNewInvoice = kind === "invoice" && !invoiceNumber && !initial?.invoiceNumber && !conversionSource;
  const [numberLoading, setNumberLoading] = useState(isNewInvoice);
  const [checkingNumber, setCheckingNumber] = useState(false);
  const numberEditedRef = useRef(false);


  const templatePanelRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<string | null>(null);
  if (baselineRef.current === null) {
    baselineRef.current = JSON.stringify(values);
  }
  const isDirty = JSON.stringify(values) !== baselineRef.current;

  useEffect(() => {
    if (!isNewInvoice) return;
    let cancelled = false;
    customFetch<{ invoiceNumber: string }>("/api/invoices/next-number")
      .then(({ invoiceNumber: assigned }) => {
        if (cancelled || numberEditedRef.current) return;
        if (baselineRef.current) {
          baselineRef.current = JSON.stringify({ ...JSON.parse(baselineRef.current), invoiceNumber: assigned });
        }
        setValues((s) => ({ ...s, invoiceNumber: assigned }));
      })
      .catch(() => {
        if (!cancelled) toast({ title: "Could not assign invoice number", description: "Enter a unique invoice number manually.", variant: "destructive" });
      })
      .finally(() => { if (!cancelled) setNumberLoading(false); });
    return () => { cancelled = true; };
  }, [isNewInvoice, toast]);


  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const requestCancel = () => {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    onCancel();
  };

  useEffect(() => {
    if (scrollToTemplates && templatePanelRef.current) {
      templatePanelRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [scrollToTemplates]);

  const { subtotal, total } = calculateDocumentTotals(
    values.items.map((it) => ({ ...it, taxRate: 0 })),
    values.discountAmount || 0,
  );
  const completedPreparationSteps = [
    Boolean(values.clientId),
    Boolean(values.date && values.dueOrValid),
    values.items.some(lineItemHasContent),
    Boolean(values.termsConditions?.trim()),
  ];
  const preparationProgress = Math.round(
    (completedPreparationSteps.filter(Boolean).length /
      completedPreparationSteps.length) *
      100,
  );
  const isConversion = kind === "invoice" && Boolean(conversionSource);

  const updateItem = (idx: number, patch: Partial<InvoiceLineItem>) =>
    setValues((v) => ({
      ...v,
      items: v.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));

  const addItem = () =>
    setValues((v) => ({ ...v, items: [...v.items, emptyItem()] }));

  const removeItem = (idx: number) =>
    setValues((v) => ({ ...v, items: v.items.filter((_, i) => i !== idx) }));

  const loadTemplate = (tpl: QuotationTemplate) => {
    setValues((v) => ({
      ...v,
      currency: tpl.currency as Currency,
      discountAmount: tpl.discountAmount,
      items: tpl.items.map((it) => ({
        name: it.name,
        description: it.description ?? "",
        details: it.details ?? "",
        quantity: it.quantity ?? 1,
        price: it.price,
        taxRate: 0,
      })),
      // Preserve the default Terms & Conditions and Remark when loading a template
      termsConditions: v.termsConditions || DEFAULT_TERMS_CONDITIONS,
      remark: v.remark || DEFAULT_REMARK,
    }));
  };

  const toggleConsultant = (id: string) => {
    setValues((v) => {
      const current = v.consultantIds ?? [];
      if (current.includes(id)) {
        return { ...v, consultantIds: current.filter((x) => x !== id) };
      }
      if (current.length >= MAX_INVOICE_CONSULTANTS) {
        toast({
          title: "Limit reached",
          description: `An invoice can have at most ${MAX_INVOICE_CONSULTANTS} consultants.`,
          variant: "destructive",
        });
        return v;
      }
      return { ...v, consultantIds: [...current, id] };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || numberLoading || checkingNumber) return;
    if (!values.clientId) {
      toast({
        title: "Client required",
        description: "Choose a client before saving.",
        variant: "destructive",
      });
      return;
    }
    if (
      kind === "invoice" &&
      (isNewInvoice || invoiceNumber || initial?.invoiceNumber) &&
      !values.invoiceNumber?.trim()
    ) {
      toast({
        title: "Invoice number required",
        description: "Enter an invoice number before saving.",
        variant: "destructive",
      });
      return;
    }
    if (values.items.length === 0) return;
    const normalizedItems = values.items.map((it) => {
      if (kind === "invoice") {
        const stored = invoiceDescriptionToStored(
          invoiceDescriptionDisplay(it),
        );
        return { ...it, ...stored, taxRate: 0 };
      }
      return {
        ...it,
        ...quotationItemToStored(
          quotationDescriptionDisplay(it),
          it.details ?? "",
        ),
        taxRate: 0,
      };
    });
    if (!normalizedItems.some(lineItemHasContent)) return;
    if (isNewInvoice) {
      setCheckingNumber(true);
      try {
        const number = values.invoiceNumber!.trim();
        const savedNumber = values.status === "revised" ? previewRevisedInvoiceNumber(number) : number;
        const { available } = await customFetch<{ available: boolean }>(
          `/api/invoices/number-availability?invoiceNumber=${encodeURIComponent(savedNumber)}`,
        );
        if (!available) {
          toast({ title: "Duplicate invoice number", variant: "destructive" });
          return;
        }
      } catch (err) {
        toast({ title: "Could not validate invoice number", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
        return;
      } finally {
        setCheckingNumber(false);
      }
    }
    onSubmit({ ...values, invoiceNumber: values.invoiceNumber?.trim(), items: normalizedItems });
  };

  const formContent = (
    <div className="space-y-5 mt-4">
      {isConversion && conversionSource && (
        <section
          className="overflow-hidden rounded-xl border border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/25"
          aria-labelledby="conversion-heading"
        >
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white shadow-sm">
                <FileCheck2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3
                  id="conversion-heading"
                  className="font-semibold text-slate-950 dark:text-slate-50"
                >
                  Review before creating the invoice
                </h3>
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                  Details from{" "}
                  <strong>{conversionSource.quotationNumber}</strong> are copied
                  below. The quotation stays linked for traceability.
                </p>
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-sky-200 bg-white/80 px-3 py-2 text-sm dark:border-sky-900 dark:bg-slate-950/50">
              <span className="text-xs text-muted-foreground">Client</span>
              <span className="text-xs text-muted-foreground">Line items</span>
              <span
                className="max-w-40 truncate font-medium"
                title={conversionSource.clientName}
              >
                {conversionSource.clientName}
              </span>
              <span className="font-mono font-medium">
                {conversionSource.itemCount}
              </span>
            </div>
          </div>
          <ol className="grid grid-cols-1 border-t border-sky-200 bg-white/45 text-xs dark:border-sky-900 dark:bg-slate-950/20 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <li className="flex items-center gap-2 px-4 py-2.5 text-emerald-700 dark:text-emerald-300">
              <CircleCheck className="h-4 w-4" aria-hidden="true" />
              <span>
                <strong>1.</strong> Quotation confirmed
              </span>
            </li>
            <ArrowRight
              className="hidden h-4 w-4 text-sky-400 sm:block"
              aria-hidden="true"
            />
            <li className="flex items-center gap-2 bg-sky-100/70 px-4 py-2.5 font-semibold text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span>
                <strong>2.</strong> Review invoice
              </span>
            </li>
            <ArrowRight
              className="hidden h-4 w-4 text-sky-400 sm:block"
              aria-hidden="true"
            />
            <li className="flex items-center gap-2 px-4 py-2.5 text-muted-foreground">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>
                <strong>3.</strong> Create &amp; link
              </span>
            </li>
          </ol>
        </section>
      )}
      {kind === "quotation" && (
        <div className="rounded-xl border bg-gradient-to-r from-slate-50 to-sky-50/60 p-4 dark:from-slate-950/60 dark:to-sky-950/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Quotation readiness
              </p>
              <p className="text-xs text-muted-foreground">
                Complete the essentials before saving your draft.
              </p>
            </div>
            <span className="font-mono text-sm font-semibold text-sky-700 dark:text-sky-300">
              {preparationProgress}% ready
            </span>
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            aria-label={`${preparationProgress}% of quotation preparation complete`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={preparationProgress}
          >
            <div
              className="h-full rounded-full bg-sky-600 transition-[width] duration-300"
              style={{ width: `${preparationProgress}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {["Client", "Schedule", "Pricing", "Terms"].map((label, index) => (
              <div
                key={label}
                className={cn(
                  "flex items-center gap-1.5",
                  completedPreparationSteps[index]
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-muted-foreground",
                )}
              >
                <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {kind === "quotation" && (
        <div className="flex items-center gap-2 border-b pb-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <Building2 className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Client &amp; basics</h3>
            <p className="text-xs text-muted-foreground">
              Who this quotation is for and how it will be issued.
            </p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Client *</Label>
          <ClientCombobox
            value={values.clientId}
            onChange={(id) => setValues((s) => ({ ...s, clientId: id }))}
            initialLabel={initialClientName}
            placeholder="Search or select client…"
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="document-currency">Currency</Label>
          <Select
            value={values.currency}
            onValueChange={(v) =>
              setValues((s) => ({ ...s, currency: v as Currency }))
            }
          >
            <SelectTrigger id="document-currency">
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

      {kind === "invoice" && (isNewInvoice || invoiceNumber || initial?.invoiceNumber) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-purple-200 dark:border-purple-900/50 bg-purple-50/50 dark:bg-purple-950/20 px-4 py-3">
          <div className="space-y-0.5 min-w-0 flex-1">
            <Label
              htmlFor="invoice-number"
              className="text-xs text-muted-foreground"
            >
              Invoice Number
            </Label>
            <Input
              id="invoice-number"
              value={values.invoiceNumber ?? ""}
              placeholder={numberLoading ? "Assigning invoice number…" : undefined}
              onChange={(e) => {
                numberEditedRef.current = true;
                setValues((s) => ({ ...s, invoiceNumber: e.target.value }));
              }}
              className="font-mono text-sm"
            />
            {values.status === "revised" && initial?.status !== "revised" && (
              <p className="text-xs text-muted-foreground">
                Will be saved as{" "}
                {previewRevisedInvoiceNumber(
                  values.invoiceNumber ?? invoiceNumber ?? "",
                )}
              </p>
            )}
          </div>
          {!isNewInvoice && (
          <div className="flex items-center gap-2 shrink-0">
            <Label
              htmlFor="invoice-revised-toggle"
              className="text-sm font-medium text-purple-700 dark:text-purple-400"
            >
              REVISED
            </Label>
            <Switch
              id="invoice-revised-toggle"
              checked={values.status === "revised"}
              onCheckedChange={(checked) => {
                setValues((s) => {
                  if (checked && s.status !== "revised") {
                    statusBeforeRevisionRef.current = s.status;
                  }
                  return {
                    ...s,
                    status: checked
                      ? "revised"
                      : statusBeforeRevisionRef.current,
                  };
                });
              }}
            />
          </div>
          )}
        </div>
      )}

      {kind === "quotation" && (
        <div>
          <Label htmlFor="quotation-attn">Attn :</Label>
          <Input
            id="quotation-attn"
            value={values.quotationAttn ?? ""}
            onChange={(e) =>
              setValues((s) => ({ ...s, quotationAttn: e.target.value }))
            }
            placeholder=""
            className="mt-1 border-orange-500 focus-visible:ring-orange-500"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="document-date">
            {kind === "invoice" ? "Invoice Date" : "Quotation Date"}
          </Label>
          <Input
            id="document-date"
            type="date"
            value={values.date}
            onChange={(e) => setValues((s) => ({ ...s, date: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="document-due">
            {kind === "invoice" ? "Due Date" : "Valid Until"}
          </Label>
          <Input
            id="document-due"
            type="date"
            value={values.dueOrValid}
            onChange={(e) =>
              setValues((s) => ({ ...s, dueOrValid: e.target.value }))
            }
          />
          {isConversion && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Confirm the payment deadline before creating the invoice.
            </p>
          )}
        </div>
      </div>

      {kind === "quotation" && (
        <div className="flex items-center gap-2 border-b pb-2 pt-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Workflow details</h3>
            <p className="text-xs text-muted-foreground">
              Set validity, internal status, and reporting category.
            </p>
          </div>
        </div>
      )}

      <div>
        <Label>Status</Label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setValues((st) => ({ ...st, status: s }))}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                values.status === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>Service tag</Label>
        <Select
          value={values.serviceCategory}
          onValueChange={(v) =>
            setValues((s) => ({ ...s, serviceCategory: v as ServiceCategory }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_CATEGORY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex flex-col">
                  <span>{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {kind === "quotation" && (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                <ReceiptText className="h-4 w-4" />
              </span>
            )}
            <div>
              <Label>Line items</Label>
              {kind === "quotation" && (
                <p className="text-xs text-muted-foreground">
                  Describe the scope and build the quoted total.
                </p>
              )}
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add line
          </Button>
        </div>
        <div className="space-y-3">
          {values.items.map((it, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-border p-3 space-y-3 bg-muted/20 shadow-sm"
            >
              {kind === "quotation" && (
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Item {idx + 1}
                </div>
              )}
              {kind === "invoice" ? (
                <Textarea
                  aria-label="Line item description"
                  placeholder="Description — use Enter for additional lines within the same item"
                  rows={3}
                  className="text-sm resize-y"
                  value={invoiceDescriptionDisplay(it, { trim: false })}
                  onChange={(e) =>
                    updateItem(idx, {
                      ...invoiceDescriptionToStored(e.target.value, { trim: false }),
                      price: it.price,
                      quantity: it.quantity,
                      taxRate: 0,
                    })
                  }
                />
              ) : (
                <>
                  <Textarea
                    aria-label="Line item description"
                    placeholder="Description — use Enter for more lines (optional)"
                    rows={2}
                    className="text-sm resize-y"
                    value={quotationDescriptionDisplay(it)}
                    onChange={(e) =>
                      updateItem(idx, {
                        ...quotationItemToStored(
                          e.target.value,
                          it.details ?? "",
                        ),
                        price: it.price,
                        quantity: it.quantity,
                        taxRate: 0,
                      })
                    }
                  />
                  <Textarea
                    aria-label="Line item details"
                    placeholder="Details / fine print (optional)"
                    rows={4}
                    className="text-sm resize-y"
                    value={it.details ?? ""}
                    onChange={(e) =>
                      updateItem(idx, {
                        ...quotationItemToStored(
                          quotationDescriptionDisplay(it),
                          e.target.value,
                        ),
                        price: it.price,
                        quantity: it.quantity,
                        taxRate: 0,
                      })
                    }
                  />
                </>
              )}
              <div className="flex items-center gap-2 justify-between flex-wrap">
                <div className="flex items-end gap-2 flex-1 flex-wrap">
                  <div>
                    <Label
                      htmlFor={`line-qty-${idx}`}
                      className="text-xs text-muted-foreground whitespace-nowrap"
                    >
                      Qty
                    </Label>
                    <Input
                      id={`line-qty-${idx}`}
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="1"
                      className="w-20"
                      value={it.quantity}
                      onChange={(e) =>
                        updateItem(idx, {
                          quantity: Math.max(0, Number(e.target.value)),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor={`line-amount-${idx}`}
                      className="text-xs text-muted-foreground whitespace-nowrap"
                    >
                      Unit price
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`line-amount-${idx}`}
                        type="number"
                        min={0}
                        max={999999999}
                        step="0.01"
                        placeholder="0.00"
                        className="w-36"
                        value={it.price}
                        onChange={(e) => {
                          const val = Math.min(
                            999999999,
                            Math.max(0, Number(e.target.value)),
                          );
                          updateItem(idx, { price: val });
                        }}
                      />
                      <span className="text-sm text-muted-foreground">
                        {values.currency}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground pb-2">
                    ={" "}
                    {((it.quantity || 0) * (it.price || 0)).toFixed(2)}{" "}
                    {values.currency}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => removeItem(idx)}
                  disabled={values.items.length === 1}
                  aria-label={`Remove line item ${idx + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 items-end">
        <div>
          <Label htmlFor="document-discount">Discount</Label>
          <Input
            id="document-discount"
            type="number"
            min={0}
            step="0.01"
            value={values.discountAmount}
            onChange={(e) =>
              setValues((s) => ({
                ...s,
                discountAmount: Number(e.target.value),
              }))
            }
          />
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">
            Subtotal: {subtotal.toFixed(2)} {values.currency}
          </div>
          <div className="text-lg font-bold">
            Total: {total.toFixed(2)} {values.currency}
          </div>
        </div>
      </div>

      {kind === "invoice" && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label>
              Consultants{" "}
              <span className="text-muted-foreground text-xs font-normal">
                (up to {MAX_INVOICE_CONSULTANTS})
              </span>
            </Label>
            <span className="text-xs text-muted-foreground">
              {(values.consultantIds ?? []).length}/{MAX_INVOICE_CONSULTANTS}{" "}
              selected
            </span>
          </div>
          {consultants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No consultants yet. Add some from the Consultants page.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {consultants
                .filter(
                  (c) =>
                    c.isActive || (values.consultantIds ?? []).includes(c.id),
                )
                .map((c) => {
                  const checked = (values.consultantIds ?? []).includes(c.id);
                  const maxReached =
                    (values.consultantIds ?? []).length >=
                    MAX_INVOICE_CONSULTANTS;
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex items-center justify-center gap-2 p-2 rounded-md border cursor-pointer transition-colors text-center",
                        checked
                          ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-border hover:border-orange-300 hover:bg-muted/40",
                        !checked &&
                          maxReached &&
                          "opacity-50 cursor-not-allowed hover:border-border hover:bg-transparent",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!checked && maxReached}
                        onCheckedChange={() => toggleConsultant(c.id)}
                        className="sr-only"
                      />
                      <span className="font-mono text-sm">{c.shortCode}</span>
                    </label>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {kind === "quotation" && (
        <div className="flex items-center gap-2 border-b pb-2 pt-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <FileText className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">
              Terms &amp; finishing notes
            </h3>
            <p className="text-xs text-muted-foreground">
              Clarify what the client should know before confirming.
            </p>
          </div>
        </div>
      )}

      {kind === "invoice" && (
        <div>
          <Label>Notes / Remarks</Label>
          <Textarea
            placeholder="e.g. Created from quotation Q-0001"
            rows={3}
            className="resize-none text-sm"
            value={values.notes ?? ""}
            onChange={(e) =>
              setValues((s) => ({ ...s, notes: e.target.value }))
            }
          />
        </div>
      )}

      {kind === "invoice" && (
        <div>
          <Label htmlFor="invoice-internal-note">Internal Note</Label>
          <Textarea
            id="invoice-internal-note"
            placeholder="Staff-only context — not sent to the client"
            rows={3}
            className="resize-y text-sm"
            value={values.internalNote ?? ""}
            onChange={(e) =>
              setValues((s) => ({ ...s, internalNote: e.target.value }))
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Internal use only. Not shown on the invoice PDF or any customer-facing document. Editing only this field does not revise the invoice.
          </p>
        </div>
      )}

      <div>
        <Label>Terms &amp; Conditions</Label>
        <Textarea
          placeholder="Enter terms and conditions..."
          rows={3}
          className="resize-y text-sm"
          value={values.termsConditions ?? ""}
          onChange={(e) =>
            setValues((s) => ({ ...s, termsConditions: e.target.value }))
          }
        />
      </div>

      <div>
        <Label>Remark</Label>
        <Textarea
          placeholder="Enter any additional remarks..."
          rows={2}
          className="resize-y text-sm"
          value={values.remark ?? ""}
          onChange={(e) => setValues((s) => ({ ...s, remark: e.target.value }))}
        />
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <p className="hidden text-xs text-muted-foreground sm:block">
          {isDirty ? "Unsaved changes" : "All changes saved"}
        </p>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={requestCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || numberLoading || checkingNumber}
            className={cn(isConversion && "min-w-36")}
          >
            {submitting
              ? isConversion
                ? "Creating invoice…"
                : "Saving…"
              : isConversion
                ? "Create invoice"
                : kind === "quotation"
                  ? values.status === "draft"
                    ? "Save draft"
                    : "Save quotation"
                  : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );

  if (!templateProps && !clientHistory) {
    return <form onSubmit={handleSubmit}>{formContent}</form>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col gap-4 mt-4 min-h-0 lg:flex-row">
        <div className="flex-1 min-w-0 space-y-4">{formContent}</div>
        {templateProps && (
          <div
            ref={templatePanelRef}
            className="w-full shrink-0 border-t pt-4 lg:w-64 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"
          >
            <TemplatePanel
              templates={templateProps.templates}
              onLoad={loadTemplate}
              onCreateTemplate={templateProps.onCreateTemplate}
              onRenameTemplate={templateProps.onRenameTemplate}
              onDeleteTemplate={templateProps.onDeleteTemplate}
              isCreating={templateProps.isCreating}
              currentValues={values}
            />
          </div>
        )}
        {clientHistory && (
          <div className="w-full shrink-0 border-t pt-4 lg:w-72 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <ClientHistoryPanel
              clientId={values.clientId}
              currentQuotationId={clientHistory.currentQuotationId}
            />
          </div>
        )}
      </div>
    </form>
  );
}

type TemplatePanelProps = {
  templates: QuotationTemplate[];
  onLoad: (tpl: QuotationTemplate) => void;
  onCreateTemplate: (
    name: string,
    items: InvoiceLineItem[],
    currency?: Currency,
    discountAmount?: number,
  ) => void;
  onRenameTemplate: (id: string, newName: string) => void;
  onDeleteTemplate: (id: string) => void;
  isCreating?: boolean;
  currentValues: DocumentFormValues;
};

function TemplatePanel({
  templates,
  onLoad,
  onCreateTemplate,
  onRenameTemplate,
  onDeleteTemplate,
  isCreating,
  currentValues,
}: TemplatePanelProps) {
  const [savingAs, setSavingAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenameTemplate(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const handleSaveAs = () => {
    if (!saveAsName.trim()) return;
    const validItems = currentValues.items.filter(lineItemHasContent);
    if (!validItems.length) return;
    onCreateTemplate(
      saveAsName.trim(),
      validItems,
      currentValues.currency,
      currentValues.discountAmount,
    );
    setSaveAsName("");
    setSavingAs(false);
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <LayoutTemplate className="h-3.5 w-3.5" />
        Templates
      </div>

      {savingAs ? (
        <div className="space-y-1.5">
          <Input
            placeholder="Template name…"
            value={saveAsName}
            onChange={(e) => setSaveAsName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSaveAs();
              }
              if (e.key === "Escape") {
                setSavingAs(false);
                setSaveAsName("");
              }
            }}
            autoFocus
          />
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleSaveAs}
              disabled={!saveAsName.trim() || isCreating}
            >
              {isCreating ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => {
                setSavingAs(false);
                setSaveAsName("");
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs"
          onClick={() => setSavingAs(true)}
        >
          <Plus className="h-3 w-3 mr-1" /> Save as Template
        </Button>
      )}

      <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
        {!templates.length ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No templates yet
          </p>
        ) : (
          templates.map((tpl) => (
            <div
              key={tpl.id}
              className="border border-orange-500 rounded p-2 space-y-0.5 bg-card text-xs"
            >
              <div className="flex items-start gap-1">
                {renamingId === tpl.id ? (
                  <div className="flex flex-1 gap-1">
                    <Input
                      ref={renameInputRef}
                      className="h-6 text-xs px-1.5"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        }
                        if (e.key === "Escape") {
                          setRenamingId(null);
                          setRenameValue("");
                        }
                      }}
                      onBlur={commitRename}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 p-0 shrink-0"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={commitRename}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex-1 text-left font-medium truncate hover:text-primary transition-colors"
                    title="Click to rename"
                    onClick={() => {
                      setRenamingId(tpl.id);
                      setRenameValue(tpl.name);
                    }}
                  >
                    {tpl.name}
                  </button>
                )}
              </div>
              <div className="text-muted-foreground">
                {tpl.currency} · {tpl.items.length} line
                {tpl.items.length !== 1 ? "s" : ""}
              </div>
              {tpl.items.slice(0, 2).map((it, i) => (
                <div key={i} className="text-muted-foreground truncate pl-1">
                  • {lineItemPreviewLabel(it)}
                </div>
              ))}
              {tpl.items.length > 2 && (
                <div className="text-muted-foreground pl-1">
                  +{tpl.items.length - 2} more
                </div>
              )}
              <div className="flex gap-1 pt-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1 h-6 text-xs border-orange-500 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
                  onClick={() => onLoad(tpl)}
                >
                  Load
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => onDeleteTemplate(tpl.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
