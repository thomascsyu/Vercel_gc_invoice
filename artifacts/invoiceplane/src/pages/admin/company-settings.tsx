import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiAbandonBrandingUpload,
  apiGetBrandingStorageStatus,
  apiGetSettings,
  apiUpdateSettings,
  apiUploadBrandingImage,
  apiStartGmailOAuth,
  type BrandingImageUploadKind,
  type CompanySettings,
  type EmailTemplates,
  type PublicGmailAccount,
} from "@/lib/modulesApi";
import { publicMediaSrcUrl } from "@/lib/api-base";
import { buildBrandingSettingsPatch, headerLogoWidthPercentFromScale } from "@/lib/brandingSettingsPatch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link2, Save, Upload } from "lucide-react";

export type CompanySettingsSection = "info" | "banks" | "branding" | "gmail" | "templates";

const CURRENCIES = ["HKD", "USD", "CNY", "MOP"] as const;

function gmailConnectButtonLabel(
  account: PublicGmailAccount | null | undefined,
  connecting: boolean,
): string {
  if (connecting) return "Redirecting…";
  if (account?.connected) return "Reconnect with Google";
  return "Connect with Google";
}

function GmailConnectionStatus({ account }: { account?: PublicGmailAccount | null }) {
  if (!account?.connected) {
    return <span className="ml-2 text-muted-foreground">○ Not connected</span>;
  }
  return <span className="ml-2 text-green-700 dark:text-green-400">● Connected</span>;
}

type BankForm = {
  bankName: string;
  accountNumber: string;
  swift: string;
  bankCode: string;
  branchName: string;
  bankAddress: string;
  accountName: string;
};
const emptyBank: BankForm = {
  bankName: "",
  accountNumber: "",
  swift: "",
  bankCode: "",
  branchName: "",
  bankAddress: "",
  accountName: "",
};

const defaultTemplates: EmailTemplates = {
  quotation: {
    subject: "Quotation {{quotation_number}} from {{company_name}}",
    body: "Dear {{contact_person}},\n\nPlease find quotation {{quotation_number}} attached. Total: {{amount}}.\n\nThanks,\n{{company_name}}",
  },
  invoice: {
    subject: "Invoice {{invoice_number}} from {{company_name}}",
    body: "Dear {{contact_person}},\n\nPlease find invoice {{invoice_number}} attached.\nInvoice date: {{invoice_date}}\nDue date: {{due_date}}\nAmount due: {{amount}}.\n\nThanks,\n{{company_name}}",
  },
  reminder: {
    subject: "Payment reminder for invoice {{invoice_number}}",
    body: "Dear {{contact_person}},\n\nThis is a friendly reminder that invoice {{invoice_number}} ({{amount}}) was due on {{due_date}}.\n\nThanks,\n{{company_name}}",
  },
  jobOrder: {
    subject: "Job Order {{job_order_number}} — {{client_name}}",
    body: "Dear {{consultant_name}},\n\nPlease find the job order {{job_order_number}} for client {{client_name}} attached.\n\nRegards,\n{{company_name}}",
  },
  proposal: {
    subject: "Proposal {{proposal_number}} from {{company_name}}",
    body: "Dear {{contact_person}},\n\nPlease review our proposal {{proposal_number}} (Revision {{proposal_revision}}) using the link below:\n\n{{proposal_link}}\n\nConsultancy fee: {{amount}}\nValid until: {{valid_until}}\n\nA PDF copy is attached for your records.\n\nThanks,\n{{company_name}}",
  },
};

const SHORTCODES = [
  "{{contact_person}}",
  "{{invoice_number}}",
  "{{quotation_number}}",
  "{{amount}}",
  "{{invoice_date}}",
  "{{due_date}}",
  "{{company_name}}",
  "{{job_order_number}}",
  "{{client_name}}",
  "{{consultant_name}}",
  "{{proposal_number}}",
  "{{proposal_revision}}",
  "{{proposal_link}}",
  "{{valid_until}}",
];

type LogoKind = "logoUrl" | "headerLogoUrl" | "chopUrl";

/** Matches server-supported raster types (Sharp handles TIFF/HEIC/AVIF via coercion). */
const BRANDING_FILE_INPUT_ACCEPT =
  "image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp,image/tiff,.tif,.tiff,image/heic,image/heif,.heic,image/avif,.avif";

const LOGO_KIND_TO_UPLOAD: Record<LogoKind, BrandingImageUploadKind> = {
  logoUrl: "company_logo",
  headerLogoUrl: "header_logo",
  chopUrl: "company_chop",
};

function previewPercentFromScale(raw: number | undefined): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  const factor = Number.isFinite(n) ? Math.min(2, Math.max(1, n)) : 1;
  const pct = Math.round(factor * 100);
  return Math.min(200, Math.max(100, Math.round(pct / 5) * 5));
}

function BankFields({
  value,
  onChange,
  title,
}: {
  value: BankForm;
  onChange: (v: BankForm) => void;
  title: string;
}) {
  return (
    <div className="space-y-2 border rounded-md p-3">
      <Label className="font-semibold">{title}</Label>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">Bank Name</Label>
          <Input placeholder="e.g. HSBC" value={value.bankName} onChange={(e) => onChange({ ...value, bankName: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Bank Code</Label>
          <Input placeholder="e.g. 004" value={value.bankCode} onChange={(e) => onChange({ ...value, bankCode: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Swift Code</Label>
          <Input placeholder="e.g. HSBCHKHH" value={value.swift} onChange={(e) => onChange({ ...value, swift: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Branch Name</Label>
          <Input placeholder="e.g. Central Branch" value={value.branchName} onChange={(e) => onChange({ ...value, branchName: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Bank Address</Label>
          <Input placeholder="e.g. 1 Queen's Road, Central, HK" value={value.bankAddress} onChange={(e) => onChange({ ...value, bankAddress: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Account Name</Label>
          <Input placeholder="e.g. Acme Ltd" value={value.accountName} onChange={(e) => onChange({ ...value, accountName: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Account Number</Label>
          <Input placeholder="e.g. 123-456789-001" value={value.accountNumber} onChange={(e) => onChange({ ...value, accountNumber: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

function TemplateBlock({
  label,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: {
  label: string;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2 border rounded-md p-3">
      <Label className="font-semibold">{label}</Label>
      <div>
        <Label className="text-xs">Subject</Label>
        <Input value={subject} onChange={(e) => onSubjectChange(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">Body</Label>
        <Textarea rows={6} value={body} onChange={(e) => onBodyChange(e.target.value)} />
      </div>
    </div>
  );
}

type CompanySettingsPageProps = { section?: CompanySettingsSection };

export default function CompanySettingsPage({ section = "info" }: CompanySettingsPageProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const { data } = useQuery({ queryKey: ["/company-settings"], queryFn: apiGetSettings });
  const { data: brandingStorageStatus } = useQuery({
    queryKey: ["/uploads/branding/storage-status"],
    queryFn: apiGetBrandingStorageStatus,
    enabled: section === "branding",
    staleTime: 60_000,
  });

  const [form, setForm] = useState<Partial<CompanySettings>>({});
  const [bank1, setBank1] = useState<BankForm>(emptyBank);
  const [bank2, setBank2] = useState<BankForm>(emptyBank);
  const [templates, setTemplates] = useState<EmailTemplates>(defaultTemplates);
  const [connectingSlot, setConnectingSlot] = useState<1 | 2 | 3 | null>(null);
  const [gmail1SenderName, setGmail1SenderName] = useState("");
  const [gmail1Signature, setGmail1Signature] = useState("");
  const [gmail2SenderName, setGmail2SenderName] = useState("");
  const [gmail2Signature, setGmail2Signature] = useState("");
  const [gmail3SenderName, setGmail3SenderName] = useState("");
  const [gmail3Signature, setGmail3Signature] = useState("");
  const [logoZoom, setLogoZoom] = useState<Record<LogoKind, number>>({
    logoUrl: 100,
    headerLogoUrl: 100,
    chopUrl: 100,
  });
  /** Header banner width (25–100% of content width); lets it be narrowed to sit beside the company logo. */
  const [headerLogoWidthPercent, setHeaderLogoWidthPercent] = useState(100);
  const [uploading, setUploading] = useState<LogoKind | null>(null);
  /** Set when a logo/chop URL's preview <img> fails to load (e.g. missing from storage). */
  const [previewLoadError, setPreviewLoadError] = useState<Record<LogoKind, boolean>>({
    logoUrl: false,
    headerLogoUrl: false,
    chopUrl: false,
  });

  const fileInputs = {
    logoUrl: useRef<HTMLInputElement | null>(null),
    headerLogoUrl: useRef<HTMLInputElement | null>(null),
    chopUrl: useRef<HTMLInputElement | null>(null),
  };
  /** Uploaded object URLs not yet written to company settings. Abandoned if Save is skipped. */
  const stagedBrandingUrls = useRef(new Set<string>());
  const brandingHydrated = useRef(false);

  useEffect(() => {
    return () => {
      for (const url of stagedBrandingUrls.current) {
        void apiAbandonBrandingUpload(url);
      }
      stagedBrandingUrls.current.clear();
    };
  }, []);

  useEffect(() => {
    const u = new URL(window.location.href);
    const gmail = u.searchParams.get("gmail");
    if (gmail === "ok") {
      const slot = u.searchParams.get("slot");
      const slotLabel =
        slot === "1" ? "Primary sender" : slot === "2" ? "Second sender" : slot === "3" ? "Third sender" : null;
      toast({
        title: "Gmail connected",
        description: slotLabel ? `${slotLabel} was linked successfully.` : "Google account linked.",
      });
      u.searchParams.delete("gmail");
      u.searchParams.delete("slot");
      u.searchParams.delete("reason");
      window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
      qc.invalidateQueries({ queryKey: ["/company-settings"] });
    } else if (gmail === "error") {
      const reason = u.searchParams.get("reason") ?? "unknown";
      toast({
        title: "Gmail connection failed",
        description: reason.replace(/_/g, " "),
        variant: "destructive",
      });
      u.searchParams.delete("gmail");
      u.searchParams.delete("reason");
      window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
    }
  }, [search, toast, qc]);

  useEffect(() => {
    if (!data) return;
    setForm((prev) => ({
      companyName: data.companyName,
      address: data.address,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      addressLine3: data.addressLine3,
      addressLine4: data.addressLine4,
      phone: data.phone,
      email: data.email,
      defaultCurrency: data.defaultCurrency,
      logoUrl: brandingHydrated.current ? prev.logoUrl : data.logoUrl,
      headerLogoUrl: brandingHydrated.current ? prev.headerLogoUrl : data.headerLogoUrl,
      chopUrl: brandingHydrated.current ? prev.chopUrl : data.chopUrl,
      proposalShowChop: brandingHydrated.current ? prev.proposalShowChop : (data.proposalShowChop ?? true),
    }));
    setBank1(
      data.bankAccount1
        ? {
            bankName: data.bankAccount1.bankName,
            accountNumber: data.bankAccount1.accountNumber,
            swift: data.bankAccount1.swift ?? "",
            bankCode: data.bankAccount1.bankCode ?? "",
            branchName: data.bankAccount1.branchName ?? "",
            bankAddress: data.bankAccount1.bankAddress ?? "",
            accountName: data.bankAccount1.accountName ?? "",
          }
        : emptyBank,
    );
    setBank2(
      data.bankAccount2
        ? {
            bankName: data.bankAccount2.bankName,
            accountNumber: data.bankAccount2.accountNumber,
            swift: data.bankAccount2.swift ?? "",
            bankCode: data.bankAccount2.bankCode ?? "",
            branchName: data.bankAccount2.branchName ?? "",
            bankAddress: data.bankAccount2.bankAddress ?? "",
            accountName: data.bankAccount2.accountName ?? "",
          }
        : emptyBank,
    );
    setTemplates(data.emailTemplates ?? defaultTemplates);
    setGmail1SenderName(data.gmailAccount1?.senderName ?? "");
    setGmail1Signature(data.gmailAccount1?.signature ?? "");
    setGmail2SenderName(data.gmailAccount2?.senderName ?? "");
    setGmail2Signature(data.gmailAccount2?.signature ?? "");
    setGmail3SenderName(data.gmailAccount3?.senderName ?? "");
    setGmail3Signature(data.gmailAccount3?.signature ?? "");
    if (brandingHydrated.current) return;
    setLogoZoom({
      logoUrl: previewPercentFromScale(data.companyLogoScale),
      headerLogoUrl: previewPercentFromScale(data.headerLogoScale),
      chopUrl: previewPercentFromScale(data.chopScale),
    });
    setHeaderLogoWidthPercent(headerLogoWidthPercentFromScale(data.headerLogoWidthScale));
    brandingHydrated.current = true;
  }, [data]);

  const bankPayload = () => ({
    bankAccount1: bank1.bankName
      ? {
          ...bank1,
          swift: bank1.swift || undefined,
          bankCode: bank1.bankCode || undefined,
          branchName: bank1.branchName || undefined,
          bankAddress: bank1.bankAddress || undefined,
          accountName: bank1.accountName || undefined,
        }
      : null,
    bankAccount2: bank2.bankName
      ? {
          ...bank2,
          swift: bank2.swift || undefined,
          bankCode: bank2.bankCode || undefined,
          branchName: bank2.branchName || undefined,
          bankAddress: bank2.bankAddress || undefined,
          accountName: bank2.accountName || undefined,
        }
      : null,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (section === "info") {
        await apiUpdateSettings({
          companyName: form.companyName,
          address: form.address ?? null,
          addressLine1: form.addressLine1 ?? null,
          addressLine2: form.addressLine2 ?? null,
          addressLine3: form.addressLine3 ?? null,
          addressLine4: form.addressLine4 ?? null,
          phone: form.phone ?? null,
          email: form.email ?? null,
          defaultCurrency: form.defaultCurrency,
        } as Partial<CompanySettings>);
        return;
      }
      if (section === "banks") {
        await apiUpdateSettings(bankPayload() as Partial<CompanySettings>);
        return;
      }
      if (section === "templates") {
        await apiUpdateSettings({ emailTemplates: templates });
        return;
      }
      if (section === "gmail") {
        await apiUpdateSettings({
          gmailAccount1: data?.gmailAccount1?.senderEmail
            ? {
                senderEmail: data.gmailAccount1.senderEmail,
                senderName: gmail1SenderName || undefined,
                signature: gmail1Signature || undefined,
              }
            : null,
          gmailAccount2: data?.gmailAccount2?.senderEmail
            ? {
                senderEmail: data.gmailAccount2.senderEmail,
                senderName: gmail2SenderName || undefined,
                signature: gmail2Signature || undefined,
              }
            : null,
          gmailAccount3: data?.gmailAccount3?.senderEmail
            ? {
                senderEmail: data.gmailAccount3.senderEmail,
                senderName: gmail3SenderName || undefined,
                signature: gmail3Signature || undefined,
              }
            : null,
        } as Partial<CompanySettings>);
        return;
      }
      if (section === "branding") {
        await apiUpdateSettings(
          buildBrandingSettingsPatch({
            logoUrl: form.logoUrl,
            headerLogoUrl: form.headerLogoUrl,
            chopUrl: form.chopUrl,
            companyLogoPercent: logoZoom.logoUrl,
            headerLogoPercent: logoZoom.headerLogoUrl,
            headerLogoWidthPercent,
            chopPercent: logoZoom.chopUrl,
            proposalShowChop: form.proposalShowChop !== false,
          }),
        );
        stagedBrandingUrls.current.clear();
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/company-settings"] });
      const titles: Record<CompanySettingsSection, string> = {
        info: "Company info saved",
        banks: "Bank accounts saved",
        branding: "Branding saved",
        gmail: "Saved",
        templates: "Email templates saved",
      };
      toast({ title: titles[section] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handleUpload = async (kind: LogoKind, file: File) => {
    setUploading(kind);
    let uploadedUrl: string | null = null;
    try {
      const { url } = await apiUploadBrandingImage(file, LOGO_KIND_TO_UPLOAD[kind]);
      uploadedUrl = url;
      const previous = (form[kind] as string | undefined)?.trim();
      if (previous && stagedBrandingUrls.current.has(previous)) {
        stagedBrandingUrls.current.delete(previous);
        try {
          await apiAbandonBrandingUpload(previous);
        } catch {
          /* previous staged file may linger until Save replaces it */
        }
      }
      stagedBrandingUrls.current.add(url);
      setForm((f) => ({ ...f, [kind]: url }));
      setPreviewLoadError((e) => ({ ...e, [kind]: false }));
      toast({
        title: "Image ready",
        description: "Click Save branding to apply company logo, header logo, and chop to PDFs.",
      });
    } catch (e) {
      if (uploadedUrl) {
        try {
          await apiAbandonBrandingUpload(uploadedUrl);
        } catch (abandonErr) {
          toast({
            title: "Upload succeeded but could not clean up unused file",
            description: (abandonErr as Error).message,
            variant: "destructive",
          });
        }
      }
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const persistClearLogo = (kind: LogoKind) => {
    const previous = (form[kind] as string | undefined)?.trim();
    if (previous && stagedBrandingUrls.current.has(previous)) {
      stagedBrandingUrls.current.delete(previous);
      void apiAbandonBrandingUpload(previous);
    }
    setForm((f) => {
      const next = { ...f };
      delete next[kind];
      return next;
    });
    setPreviewLoadError((e) => ({ ...e, [kind]: false }));
  };

  const renderLogoBlock = (kind: LogoKind, label: string, hint?: string, footer?: ReactNode) => {
    const url = (form[kind] as string | undefined) ?? "";
    const zoom = logoZoom[kind];
    const loadFailed = previewLoadError[kind];
    return (
      <div className="space-y-2 border rounded-md p-3">
        <Label className="font-semibold">{label}</Label>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        <div className="flex items-start gap-3">
          <div className="relative size-32 shrink-0 overflow-hidden rounded border bg-muted/30">
            {url && !loadFailed ? (
              <div
                className="absolute inset-0 grid place-items-center p-1"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center center" }}
              >
                <img
                  src={publicMediaSrcUrl(url) || url}
                  alt={label}
                  className="max-h-full max-w-full object-contain"
                  onError={() => setPreviewLoadError((e) => ({ ...e, [kind]: true }))}
                  onLoad={() => setPreviewLoadError((e) => ({ ...e, [kind]: false }))}
                />
              </div>
            ) : url && loadFailed ? (
              <span className="absolute inset-0 grid place-items-center p-2 text-center text-xs text-amber-700 dark:text-amber-400">
                Image failed to load — it may be missing from storage. Try re-uploading.
              </span>
            ) : (
              <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                No image
              </span>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <Input
              placeholder="/api/storage/public-objects/branding/… — included when you Save branding"
              value={url}
              onChange={(e) => {
                setForm({ ...form, [kind]: e.target.value });
                setPreviewLoadError((err) => ({ ...err, [kind]: false }));
              }}
            />
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept={BRANDING_FILE_INPUT_ACCEPT}
                ref={fileInputs[kind]}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(kind, f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputs[kind].current?.click()}
                disabled={uploading === kind}
                data-testid={`button-upload-${kind}`}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                {uploading === kind ? "Uploading…" : "Upload"}
              </Button>
              {url && (
                <Button type="button" size="sm" variant="ghost" onClick={() => persistClearLogo(kind)}>
                  Remove
                </Button>
              )}
            </div>
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Size (preview & PDFs)</span>
                <span>{zoom}%</span>
              </div>
              <Slider
                value={[zoom]}
                min={100}
                max={200}
                step={5}
                onValueChange={(v) => setLogoZoom((z) => ({ ...z, [kind]: v[0] ?? 100 }))}
              />
            </div>
            {footer}
          </div>
        </div>
      </div>
    );
  };

  const showSave = section !== "branding";

  return (
    <div className="space-y-6">
      {section === "info" && (
        <Card>
          <CardHeader>
            <CardTitle>Company info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Company name</Label>
              <Input value={form.companyName ?? ""} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Default currency</Label>
              <Select
                value={form.defaultCurrency ?? "HKD"}
                onValueChange={(v) =>
                  setForm({ ...form, defaultCurrency: v as CompanySettings["defaultCurrency"] })
                }
              >
                <SelectTrigger className="max-w-xs">
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
            <div className="space-y-2">
              <Label>Address</Label>
              <Input aria-label="Address line 1" placeholder="Address line 1" value={form.addressLine1 ?? ""} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
              <Input aria-label="Address line 2" placeholder="Address line 2" value={form.addressLine2 ?? ""} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
              <Input aria-label="Address line 3" placeholder="Address line 3" value={form.addressLine3 ?? ""} onChange={(e) => setForm({ ...form, addressLine3: e.target.value })} />
              <Input aria-label="Address line 4" placeholder="Address line 4" value={form.addressLine4 ?? ""} onChange={(e) => setForm({ ...form, addressLine4: e.target.value })} />
            </div>
          </CardContent>
        </Card>
      )}

      {section === "banks" && (
        <Card>
          <CardHeader>
            <CardTitle>Bank accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <BankFields title="Primary bank" value={bank1} onChange={setBank1} />
            <BankFields title="Secondary bank" value={bank2} onChange={setBank2} />
          </CardContent>
        </Card>
      )}

      {section === "branding" && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <CardTitle>Branding & images</CardTitle>
            <Button
              type="button"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || uploading !== null}
              data-testid="button-save-branding-top"
              className="gap-2 shrink-0"
              aria-label="Save company logo, header logo, and company chop"
            >
              <Save className="h-4 w-4" aria-hidden />
              {saveMut.isPending ? "Saving…" : "Save branding"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {brandingStorageStatus?.persistent === false && (
              <p className="text-sm border rounded-md p-2 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Uploads are on disk that is discarded when the app container is recreated. On the
                Ubuntu server, mount a host directory at{" "}
                <code className="text-xs bg-muted px-1 rounded">/data</code> (or set{" "}
                <code className="text-xs bg-muted px-1 rounded">PERSIST_LOCAL_UPLOADS=1</code> and{" "}
                <code className="text-xs bg-muted px-1 rounded">LOCAL_PUBLIC_UPLOAD_DIR</code> on a data
                disk), restart, and re-upload logos once. Alternatively set{" "}
                <code className="text-xs bg-muted px-1 rounded">PUBLIC_OBJECT_SEARCH_PATHS</code> and{" "}
                <code className="text-xs bg-muted px-1 rounded">GOOGLE_APPLICATION_CREDENTIALS</code> for
                Google Cloud Storage.
              </p>
            )}
            <p className="text-sm text-muted-foreground border rounded-md p-2 bg-muted/30">
              Upload or paste paths for the company logo, header logo, and company chop, then click{" "}
              <span className="font-medium text-foreground">Save branding</span> to apply all three to PDFs.
              Images are stored at public URLs — anyone with the link can view them. Pasted paths must start
              with <code className="text-xs bg-muted px-1 rounded">/api/storage/public-objects/</code>.
            </p>
            {renderLogoBlock(
              "logoUrl",
              "Company logo",
              "Small logo in the top-left header row on invoices, quotations, job orders, and receipts when the layout shows the logo row.",
            )}
            {renderLogoBlock(
              "headerLogoUrl",
              "Header logo",
              "Banner across the top of PDFs when the document layout enables Header banner logo (not used on proposals). Full width by default — use Banner width below as a maximum; the layout box also shrinks to your image’s shape at the Size you set. Narrow the max and drag on Document layouts to sit beside the company logo.",
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Max banner width (% of content; box fits image up to this cap)</span>
                  <span>{headerLogoWidthPercent}%</span>
                </div>
                <Slider
                  value={[headerLogoWidthPercent]}
                  min={25}
                  max={100}
                  step={5}
                  onValueChange={(v) => setHeaderLogoWidthPercent(v[0] ?? 100)}
                />
              </div>,
            )}
            {renderLogoBlock(
              "chopUrl",
              "Company chop",
              "Seal or stamp on invoice and quotation PDFs when the signature section is enabled, and on proposal PDFs unless disabled below; receipts use their Company chop layout option.",
              <div className="flex items-center justify-between gap-2 rounded border px-3 py-1.5">
                <Label className="text-xs cursor-pointer" htmlFor="proposal-show-chop">
                  Show on proposal PDFs
                </Label>
                <Switch
                  id="proposal-show-chop"
                  checked={form.proposalShowChop !== false}
                  onCheckedChange={(on) => setForm((f) => ({ ...f, proposalShowChop: on }))}
                />
              </div>,
            )}
            <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Saves company logo, header logo, and company chop (including size) together.
              </p>
              <Button
                type="button"
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || uploading !== null}
                data-testid="button-save-branding"
                className="gap-2"
                aria-label="Save company logo, header logo, and company chop"
              >
                <Save className="h-4 w-4" aria-hidden />
                {saveMut.isPending ? "Saving…" : "Save branding"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {section === "gmail" && (
        <Card>
          <CardHeader>
            <CardTitle>Email sending (Gmail API)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Gmail is used for sending invoices, quotations, proposals, and reminders. Configure a Google Cloud OAuth
              client with the <code className="text-xs bg-muted px-1 rounded">gmail.send</code> scope, then set{" "}
              <code className="text-xs bg-muted px-1 rounded">GMAIL_OAUTH_*</code> on the API server.
            </p>
            {!data?.gmailOAuthConfigured && (
              <p className="text-sm text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900 rounded-md p-2">
                Gmail OAuth is not configured on the API server. Set{" "}
                <code className="text-xs bg-background/60 px-1 rounded">GMAIL_OAUTH_CLIENT_ID</code>,{" "}
                <code className="text-xs bg-background/60 px-1 rounded">GMAIL_OAUTH_CLIENT_SECRET</code>, and{" "}
                <code className="text-xs bg-background/60 px-1 rounded">GMAIL_OAUTH_REDIRECT_URI</code> (or rely on{" "}
                <code className="text-xs bg-background/60 px-1 rounded">GOOGLE_OAUTH_*</code> with the Gmail callback registered in
                Google Cloud), then restart the API.
              </p>
            )}
            <div className="space-y-3 border rounded-md p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label className="font-semibold">Primary sender</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data?.gmailAccount1?.senderEmail || "Not connected"}
                    <GmailConnectionStatus account={data?.gmailAccount1} />
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!data?.gmailOAuthConfigured || connectingSlot !== null}
                  onClick={async () => {
                    setConnectingSlot(1);
                    try {
                      const { url } = await apiStartGmailOAuth(1);
                      window.location.href = url;
                    } catch (e) {
                      toast({ title: "Could not start Gmail connect", description: (e as Error).message, variant: "destructive" });
                      setConnectingSlot(null);
                    }
                  }}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  {gmailConnectButtonLabel(data?.gmailAccount1, connectingSlot === 1)}
                </Button>
              </div>
              {data?.gmailAccount1?.connected && (
                <div className="space-y-2 pt-2 border-t">
                  <div>
                    <Label className="text-xs">Sender Name</Label>
                    <Input
                      placeholder="Display name for emails (defaults to company name)"
                      value={gmail1SenderName}
                      onChange={(e) => setGmail1SenderName(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Email Signature (HTML)</Label>
                    <Textarea
                      placeholder="<p>Best regards,<br/>Your Name</p>"
                      rows={4}
                      value={gmail1Signature}
                      onChange={(e) => setGmail1Signature(e.target.value)}
                      className="text-sm font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3 border rounded-md p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label className="font-semibold">Second sender (optional)</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data?.gmailAccount2?.senderEmail || "Not connected"}
                    <GmailConnectionStatus account={data?.gmailAccount2} />
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!data?.gmailOAuthConfigured || connectingSlot !== null}
                  onClick={async () => {
                    setConnectingSlot(2);
                    try {
                      const { url } = await apiStartGmailOAuth(2);
                      window.location.href = url;
                    } catch (e) {
                      toast({ title: "Could not start Gmail connect", description: (e as Error).message, variant: "destructive" });
                      setConnectingSlot(null);
                    }
                  }}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  {gmailConnectButtonLabel(data?.gmailAccount2, connectingSlot === 2)}
                </Button>
              </div>
              {data?.gmailAccount2?.connected && (
                <div className="space-y-2 pt-2 border-t">
                  <div>
                    <Label className="text-xs">Sender Name</Label>
                    <Input
                      placeholder="Display name for emails (defaults to company name)"
                      value={gmail2SenderName}
                      onChange={(e) => setGmail2SenderName(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Email Signature (HTML)</Label>
                    <Textarea
                      placeholder="<p>Best regards,<br/>Your Name</p>"
                      rows={4}
                      value={gmail2Signature}
                      onChange={(e) => setGmail2Signature(e.target.value)}
                      className="text-sm font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-3 border rounded-md p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label className="font-semibold">Third sender (optional)</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data?.gmailAccount3?.senderEmail || "Not connected"}
                    <GmailConnectionStatus account={data?.gmailAccount3} />
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!data?.gmailOAuthConfigured || connectingSlot !== null}
                  onClick={async () => {
                    setConnectingSlot(3);
                    try {
                      const { url } = await apiStartGmailOAuth(3);
                      window.location.href = url;
                    } catch (e) {
                      toast({ title: "Could not start Gmail connect", description: (e as Error).message, variant: "destructive" });
                      setConnectingSlot(null);
                    }
                  }}
                >
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  {gmailConnectButtonLabel(data?.gmailAccount3, connectingSlot === 3)}
                </Button>
              </div>
              {data?.gmailAccount3?.connected && (
                <div className="space-y-2 pt-2 border-t">
                  <div>
                    <Label className="text-xs">Sender Name</Label>
                    <Input
                      placeholder="Display name for emails (defaults to company name)"
                      value={gmail3SenderName}
                      onChange={(e) => setGmail3SenderName(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Email Signature (HTML)</Label>
                    <Textarea
                      placeholder="<p>Best regards,<br/>Your Name</p>"
                      rows={4}
                      value={gmail3Signature}
                      onChange={(e) => setGmail3Signature(e.target.value)}
                      className="text-sm font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {section === "templates" && (
        <Card>
          <CardHeader>
            <CardTitle>Email templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground border rounded-md p-2 bg-muted/40">
              <span className="font-medium">Available shortcodes: </span>
              <span className="font-mono">{SHORTCODES.join("  ")}</span>
            </div>
            <Tabs defaultValue="quotation" className="w-full">
              <TabsList className="flex flex-wrap h-auto gap-1">
                <TabsTrigger value="quotation" data-testid="tab-template-quotation">
                  Sending Quotation
                </TabsTrigger>
                <TabsTrigger value="invoice" data-testid="tab-template-invoice">
                  Sending Invoice
                </TabsTrigger>
                <TabsTrigger value="reminder" data-testid="tab-template-reminder">
                  Payment Reminder
                </TabsTrigger>
                <TabsTrigger value="jobOrder" data-testid="tab-template-job-order">
                  Job Order (consultant)
                </TabsTrigger>
                <TabsTrigger value="proposal" data-testid="tab-template-proposal">
                  Sending Proposal
                </TabsTrigger>
              </TabsList>
              <TabsContent value="quotation" className="mt-3">
                <TemplateBlock
                  label="Sending Quotation"
                  subject={templates.quotation.subject}
                  body={templates.quotation.body}
                  onSubjectChange={(v) => setTemplates((t) => ({ ...t, quotation: { ...t.quotation, subject: v } }))}
                  onBodyChange={(v) => setTemplates((t) => ({ ...t, quotation: { ...t.quotation, body: v } }))}
                />
              </TabsContent>
              <TabsContent value="invoice" className="mt-3">
                <TemplateBlock
                  label="Sending Invoice"
                  subject={templates.invoice.subject}
                  body={templates.invoice.body}
                  onSubjectChange={(v) => setTemplates((t) => ({ ...t, invoice: { ...t.invoice, subject: v } }))}
                  onBodyChange={(v) => setTemplates((t) => ({ ...t, invoice: { ...t.invoice, body: v } }))}
                />
              </TabsContent>
              <TabsContent value="reminder" className="mt-3">
                <TemplateBlock
                  label="Payment Reminder"
                  subject={templates.reminder.subject}
                  body={templates.reminder.body}
                  onSubjectChange={(v) => setTemplates((t) => ({ ...t, reminder: { ...t.reminder, subject: v } }))}
                  onBodyChange={(v) => setTemplates((t) => ({ ...t, reminder: { ...t.reminder, body: v } }))}
                />
              </TabsContent>
              <TabsContent value="jobOrder" className="mt-3">
                <TemplateBlock
                  label="Job Order to consultant"
                  subject={templates.jobOrder.subject}
                  body={templates.jobOrder.body}
                  onSubjectChange={(v) => setTemplates((t) => ({ ...t, jobOrder: { ...t.jobOrder, subject: v } }))}
                  onBodyChange={(v) => setTemplates((t) => ({ ...t, jobOrder: { ...t.jobOrder, body: v } }))}
                />
              </TabsContent>
              <TabsContent value="proposal" className="mt-3">
                <TemplateBlock
                  label="Sending Proposal"
                  subject={templates.proposal.subject}
                  body={templates.proposal.body}
                  onSubjectChange={(v) => setTemplates((t) => ({ ...t, proposal: { ...t.proposal, subject: v } }))}
                  onBodyChange={(v) => setTemplates((t) => ({ ...t, proposal: { ...t.proposal, body: v } }))}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {showSave && (
        <div className="flex justify-end">
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            data-testid="button-save-settings"
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
