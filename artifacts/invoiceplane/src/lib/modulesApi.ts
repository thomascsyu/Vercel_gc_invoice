import { apiUrl } from "@/lib/api-base";
import { fetchWithSessionRetry } from "@workspace/api-client-react";
import type { InvoiceContinuityReport } from "@workspace/invoice-utils";

// CSRF guard: the API rejects mutating (non-GET/HEAD) requests without this
// header (a cross-site form POST can't set it). See api-server/src/lib/csrf.ts.
// Every fetch() below that isn't a plain GET must include this.
const CSRF_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const res = await fetchWithSessionRetry(apiUrl(path), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" && method !== "HEAD" ? CSRF_HEADERS : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text.trim() || `Request failed: ${res.status}`;
    try {
      const data = JSON.parse(text) as { error?: string; issues?: string[] };
      if (data.issues?.length) {
        message =
          data.issues.length === 1 ? data.issues[0]! : data.issues.join("; ");
      } else if (data.error) {
        message = data.error;
      }
    } catch {
      /* plain-text error body */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Me = {
  userId: string;
  role: "admin" | "user";
  email?: string;
  fullName?: string;
  testModeEnabled?: boolean;
  dataUserId?: string;
  capabilities?: { proposals: boolean };
};
export const apiMe = () => request<Me>("/me");

export type BankAccount = {
  bankName: string;
  accountNumber: string;
  swift?: string;
  bankCode?: string;
  branchName?: string;
  bankAddress?: string;
  accountName?: string;
};
/** Stored server-side; PATCH may omit secrets to keep existing OAuth tokens. */
export type GmailAccount = {
  senderEmail: string;
  refreshToken?: string;
  serviceAccount?: string;
};

export type PublicGmailAccount = {
  senderEmail: string;
  connected: boolean;
  signature?: string;
  senderName?: string;
};
export type EmailTemplate = { subject: string; body: string };
export type EmailTemplates = {
  quotation: EmailTemplate;
  invoice: EmailTemplate;
  reminder: EmailTemplate;
  jobOrder: EmailTemplate;
  proposal: EmailTemplate;
};
export type User = {
  id: string;
  googleSub: string;
  email: string;
  fullName?: string;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
};
export const apiListUsers = () => request<User[]>("/users");
export const apiCreateUser = (body: Partial<User> & { email: string }) =>
  request<User>("/users", { method: "POST", body: JSON.stringify(body) });
export const apiUpdateUser = (id: string, body: Partial<User>) =>
  request<User>(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
export const apiDeleteUser = (id: string) =>
  request<void>(`/users/${id}`, { method: "DELETE" });

export type BackupRestoreCounts = {
  clients: number;
  invoices: number;
  quotations: number;
  payments: number;
  paymentReceipts: number;
  receipts: number;
  jobOrders: number;
  recurringInvoices: number;
  quotationTemplates: number;
  proposalDocuments: number;
  proposalActivity: number;
  proposalQuestions: number;
  clientProposals: number;
  companySettings: number;
  consultants: number;
};

export async function apiDownloadBackup(includeCompany = true): Promise<void> {
  const qs = includeCompany ? "?includeCompany=true" : "";
  const res = await fetch(apiUrl(`/backup/export${qs}`), {
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.trim() || `Backup failed: ${res.status}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename =
    match?.[1] ?? `gc-inv-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function apiRestoreBackup(
  file: File,
  options?: { restoreCompany?: boolean; confirm?: boolean },
): Promise<{ restored: BackupRestoreCounts }> {
  const form = new FormData();
  form.append("file", file);
  form.append("confirm", options?.confirm === false ? "false" : "true");
  if (options?.restoreCompany !== undefined) {
    form.append("restoreCompany", options.restoreCompany ? "true" : "false");
  }
  const res = await fetch(apiUrl("/backup/restore"), {
    method: "POST",
    credentials: "include",
    headers: CSRF_HEADERS,
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text.trim() || `Restore failed: ${res.status}`;
    try {
      const data = JSON.parse(text) as { error?: string; issues?: string[] };
      if (data.issues?.length) {
        message = data.issues.join("; ");
      } else if (data.error) {
        message = data.error;
      }
    } catch {
      /* plain-text error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<{ restored: BackupRestoreCounts }>;
}

export type Consultant = {
  id: string;
  shortCode: string;
  name: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
};
export const apiListConsultants = () => request<Consultant[]>("/consultants");
export const apiCreateConsultant = (body: Partial<Consultant>) =>
  request<Consultant>("/consultants", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const apiUpdateConsultant = (id: string, body: Partial<Consultant>) =>
  request<Consultant>(`/consultants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
export const apiDeleteConsultant = (id: string) =>
  request<void>(`/consultants/${id}`, { method: "DELETE" });

export type ConsultantPerformance = {
  consultantId: string;
  shortCode: string;
  name: string;
  month: string;
  currency: string;
  revenue: number;
  invoiceCount: number;
};
export const apiListConsultantPerformance = () =>
  request<ConsultantPerformance[]>("/consultants/performance");

export type ClientOption = { id: string; name: string; clientCode: string };

export function apiListClientOptions(params?: {
  q?: string;
  limit?: number;
  active?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.active !== undefined) qs.set("active", String(params.active));
  const query = qs.toString();
  return request<ClientOption[]>(`/clients/options${query ? `?${query}` : ""}`);
}

export function apiPatchInvoiceStatus(
  id: string,
  body: { status: string; cancellationReason?: string },
) {
  return request<unknown>(`/invoices/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function apiBulkSetInvoiceStatus(ids: string[], status: string) {
  return request<void>("/invoices/bulk-status", {
    method: "PATCH",
    body: JSON.stringify({ ids, status }),
  });
}

export function apiBulkDeleteInvoices(ids: string[]) {
  return request<void>("/invoices/bulk-delete", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

export type {
  DuplicateBaseNumber,
  DuplicateSequenceSlot,
  InvoiceContinuityReport,
  MissingSequenceSlot,
  MonthContinuity,
  ReissuedInvoiceNumber,
  VoidedInvoice,
} from "@workspace/invoice-utils";

export function apiGetInvoiceContinuity() {
  return request<InvoiceContinuityReport>("/invoices/continuity");
}

export function apiPatchQuotationStatus(
  id: string,
  body: { status: string; cancellationReason?: string },
) {
  return request<unknown>(`/quotations/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function apiBulkDeleteQuotations(ids: string[]) {
  return request<void>("/quotations/bulk-delete", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

export function apiBulkSetQuotationStatus(ids: string[], status: string) {
  return request<void>("/quotations/bulk-status", {
    method: "PATCH",
    body: JSON.stringify({ ids, status }),
  });
}

export function apiBulkDeleteReceipts(ids: string[]) {
  return request<void>("/receipts/bulk-delete", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
}

// Soft delete: "deleted" entities are still recoverable via restore, rather
// than being gone forever. Each list endpoint returns the entity's normal
// DTO shape plus a `deletedAt` timestamp.
export type DeletedRow = { id: string; deletedAt?: string } & Record<
  string,
  unknown
>;
export type DeletedPage = {
  data: DeletedRow[];
  total: number;
  page: number;
  pageSize: number;
};

export function apiListDeleted(
  entity: "clients" | "invoices" | "quotations" | "payments" | "receipts",
) {
  return request<DeletedPage>(`/${entity}/deleted`);
}

export function apiRestore(
  entity: "clients" | "invoices" | "quotations" | "payments" | "receipts",
  id: string,
) {
  return request<unknown>(`/${entity}/${id}/restore`, { method: "POST" });
}

/** Permanently removes an already soft-deleted row. Currently only supported for invoices. */
export function apiPurge(entity: "invoices", id: string) {
  return request<void>(`/${entity}/${id}/permanent`, { method: "DELETE" });
}

export type LineItem = {
  name: string;
  description?: string;
  details?: string;
  quantity: number;
  price: number;
  taxRate?: number;
};

export type JobOrder = {
  id: string;
  clientId: string;
  /** Populated on list responses (joined server-side); absent on create/update responses. */
  clientName?: string;
  jobOrderNumber: string;
  jobDate: string;
  status: string;
  sourceType?: string;
  sourceId?: string;
  /** Quotation/invoice/proposal number for sourceId (joined server-side); absent when there's no source or it's broken. */
  sourceNumber?: string;
  sourceBroken?: boolean;
  items: LineItem[];
  consultantIds?: string[];
  notes?: string;
  createdAt: string;
};
export type PaginatedJobOrders = {
  data: JobOrder[];
  total: number;
  page: number;
  pageSize: number;
};
export const apiListJobOrders = (params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}) => {
  const qs = params
    ? new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  return request<PaginatedJobOrders>(`/job-orders${qs ? `?${qs}` : ""}`);
};
export const apiCreateJobOrder = (body: Partial<JobOrder>) =>
  request<JobOrder>("/job-orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const apiUpdateJobOrder = (id: string, body: Partial<JobOrder>) =>
  request<JobOrder>(`/job-orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
export const apiDeleteJobOrder = (id: string) =>
  request<void>(`/job-orders/${id}`, { method: "DELETE" });
export const apiJobOrderFromQuotation = (
  quotationId: string,
  consultantIds?: string[],
) =>
  request<JobOrder>(`/job-orders/from-quotation/${quotationId}`, {
    method: "POST",
    body: JSON.stringify({
      consultantIds: consultantIds ?? [],
    }),
  });
export const apiJobOrderFromInvoice = (
  invoiceId: string,
  consultantIds?: string[],
) =>
  request<JobOrder>(`/job-orders/from-invoice/${invoiceId}`, {
    method: "POST",
    body: JSON.stringify({
      consultantIds: consultantIds ?? [],
    }),
  });
export const apiEmailJobOrderToConsultant = (
  id: string,
  consultantId: string,
) =>
  request<{ ok: boolean; message: string }>(
    `/job-orders/${id}/email-consultant`,
    { method: "POST", body: JSON.stringify({ consultantId }) },
  );

export type ProposalApproachPhase = {
  phase: number;
  title: string;
  clientService: string;
  clientResponsibility: string;
  deliverable: string;
};

export type ProposalExtractionFields = {
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  isoStandards: string[];
  proposedScopeOfCertification: string;
  stages: string[];
  scopeOfService: string;
  clientService: string;
  clientResponsibilities: string;
  approachPhases: ProposalApproachPhase[];
  deliverables: string[];
  timeline: string;
};

export type ProposalExtractionLineItem = {
  name: string;
  description: string;
  details: string;
};

export type ProposalExtractionResult = {
  fields: ProposalExtractionFields;
  notes: string;
  lineItem: ProposalExtractionLineItem;
  textPreview?: string;
  source?: string;
};

/** Upload a proposal PDF/DOCX/TXT; server extracts cover contact, ISO, scope, and approach into job-order notes. */
export async function apiExtractJobOrderFromProposal(
  file: File,
): Promise<ProposalExtractionResult> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetchWithSessionRetry(
    apiUrl("/job-orders/extract-proposal"),
    {
      method: "POST",
      credentials: "include",
      headers: CSRF_HEADERS,
      body,
    },
  );
  if (!res.ok) {
    let msg = await res.text();
    try {
      const j = JSON.parse(msg) as { error?: string; detail?: string };
      msg = [j.error, j.detail].filter(Boolean).join(": ") || msg;
    } catch {
      /* keep text */
    }
    throw new Error(msg || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<ProposalExtractionResult>;
}

// Email sending (Gmail API)
export interface EmailSendBody {
  to?: string;
  slot?: 1 | 2;
  cc?: string;
  bcc?: string;
  /** Overrides {{contact_person}} in quotation email templates. */
  contactPersonOverride?: string;
}
export type EmailSendResult = { ok: boolean; message: string };


export type Recurring = {
  id: string;
  clientId: string;
  label: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  nextRunDate: string;
  currency: "HKD" | "USD" | "CNY" | "MOP";
  items: LineItem[];
  enabled: boolean;
  lastRunAt?: string;
  createdAt: string;
};
export const apiListRecurring = () =>
  request<Recurring[]>("/recurring-invoices");
export const apiCreateRecurring = (body: Partial<Recurring>) =>
  request<Recurring>("/recurring-invoices", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const apiUpdateRecurring = (id: string, body: Partial<Recurring>) =>
  request<Recurring>(`/recurring-invoices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
export const apiDeleteRecurring = (id: string) =>
  request<void>(`/recurring-invoices/${id}`, { method: "DELETE" });
export const apiRunDueRecurring = () =>
  request<{ generated: number }>("/recurring-invoices/run-due", {
    method: "POST",
  });

/** PDF layout payloads (persisted via company_settings.pdf_document_layouts; also usable from /pdf-document-layouts). */
export type LineTableColumnKind =
  | "item"
  | "description"
  | "quantity"
  | "rate"
  | "tax"
  | "amount";

export type PdfLineColumns = {
  order: LineTableColumnKind[];
  visible?: Partial<Record<LineTableColumnKind, boolean>>;
};

export type PdfLayoutSections = Partial<{
  showHeaderBannerLogo: boolean;
  showLogoRow: boolean;
  /** Document heading: title word (INVOICE / QUOTATION / JOB ORDER), doc number, and date. */
  showTitleBlock: boolean;
  showBillingBlock: boolean;
  showTotals: boolean;
  showBankAccounts: boolean;
  showSignatures: boolean;
  showFooterAddress: boolean;
  /** Job order PDF: consultants in the right column with the client block (when consultants are assigned). */
  showConsultantsLine: boolean;
  /** Job order PDF: company address block in the right column of the bill-to area. */
  showJobOrderIssuerBlock: boolean;
  showPaymentAdvicePage: boolean;
}>;

/** Keys for `sectionOffsets` — vertical nudge in PDF points (±120). */
export type PdfSectionOffsetKey =
  | "showLogoRow"
  | "showHeaderBannerLogo"
  | "showTitleBlock"
  | "showBillingBlock" /** Job order: nudge Consultants block in the right column (paired with sections.showConsultantsLine) */
  | "jobOrderConsultants"
  | "lineItems"
  | "showTotals"
  | "showBankAccounts"
  | "showSignatures" /** Quotation PDFs: shifts remarks, terms & conditions, and signatures together */
  | "quotationExtra"
  | "showFooterAddress"
  | "showPaymentAdvicePage";

/** XY nudge in PDF points (x: left/right, y: up/down). */
export type PdfSectionOffsetPoint = {
  x: number;
  y: number;
};

export type PdfLayoutPresetId = "classic" | "custom";

export type PdfDocumentProfile = {
  /** UI-only hint: last applied preset; `"custom"` after manual edits. */
  presetId?: PdfLayoutPresetId;
  tableMode?: "simple" | "detailed";
  lineColumns?: PdfLineColumns;
  sections?: PdfLayoutSections;
  /** XY nudges in PDF points; x negative=left, y negative=up */
  sectionOffsets?: Partial<Record<PdfSectionOffsetKey, PdfSectionOffsetPoint>>;
  footerText?: string;
  quotation?: Partial<{
    showRemarks: boolean;
    showPaymentTerms: boolean;
    showSignatureBlock: boolean;
  }>;
  receipt?: Partial<{
    showAccentHeader: boolean;
    showChequeDetailRows: boolean;
    showCompanyChop: boolean;
  }>;
};

export type PdfDocumentLayouts = Partial<{
  invoice: PdfDocumentProfile;
  quotation: PdfDocumentProfile;
  jobOrder: PdfDocumentProfile;
  receipt: PdfDocumentProfile;
}>;

export const apiGetPdfDocumentLayouts = () =>
  request<PdfDocumentLayouts>("/pdf-document-layouts");
export const apiPatchPdfDocumentLayouts = (partial: PdfDocumentLayouts) =>
  request<PdfDocumentLayouts>("/pdf-document-layouts", {
    method: "PATCH",
    body: JSON.stringify(partial),
  });

export type PdfLayoutPreviewKind = keyof PdfDocumentLayouts;

/** Renders a sample PDF with the given profile merged over saved layouts (does not persist). */
export async function fetchPdfLayoutPreviewBlob(
  kind: PdfLayoutPreviewKind,
  profile: PdfDocumentProfile,
  options?: { signal?: AbortSignal },
): Promise<Blob> {
  const res = await fetchWithSessionRetry(
    apiUrl("/pdf-document-layouts/preview"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
      body: JSON.stringify({ kind, profile }),
      signal: options?.signal,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    let message = text.trim() || `Preview failed: ${res.status}`;
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* plain-text error body */
    }
    throw new Error(message);
  }
  return res.blob();
}

export type CompanySettings = {
  id: string;
  companyName: string;
  address?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  addressLine4?: string;
  phone?: string;
  email?: string;
  defaultCurrency: "HKD" | "USD" | "CNY" | "MOP";
  bankAccount1: BankAccount | null;
  bankAccount2: BankAccount | null;
  logoUrl?: string | null;
  headerLogoUrl?: string | null;
  /** Company chop / seal (public object storage URL). */
  chopUrl?: string | null;
  /** Multiplier 1–2 (100%–200%) for PDF/document rendering */
  companyLogoScale?: number;
  headerLogoScale?: number;
  /** Header banner width as a fraction of content width (0.25–1); defaults to 1 (full width). */
  headerLogoWidthScale?: number;
  chopScale?: number;
  /** Whether the company chop is drawn on proposal PDFs. Defaults to true. */
  proposalShowChop?: boolean;
  /** When true, the whole company works in an empty test sandbox. */
  testModeEnabled?: boolean;
  /** Write-only; the server no longer returns saved API keys. */
  deepseekApiKey?: string;
  deepseekModel?: string;
  gmailAccount1: PublicGmailAccount | null;
  gmailAccount2: PublicGmailAccount | null;
  gmailAccount3: PublicGmailAccount | null;
  gmailOAuthConfigured: boolean;
  emailTemplates: EmailTemplates | null;
  pdfDocumentLayouts?: PdfDocumentLayouts | null;
  /** ISO timestamp; used to cache-bust PDF preview iframes after branding changes. */
  updatedAt?: string;
};
export const apiGetSettings = () =>
  request<CompanySettings>("/company-settings");
export const apiUpdateSettings = (body: Partial<CompanySettings>) =>
  request<CompanySettings>("/company-settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export type ClearTestDataCounts = {
  paymentReceipts: number;
  payments: number;
  receipts: number;
  jobOrders: number;
  invoices: number;
  quotations: number;
  clients: number;
};
export type ClearTestDataResult = { ok: true; deleted: ClearTestDataCounts };
export const apiClearTestData = () =>
  request<ClearTestDataResult>("/company-settings/clear-test-data", {
    method: "POST",
    body: "{}",
  });

export async function apiTestDeepseekConnection(apiKey?: string): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
  detail?: string;
}> {
  const res = await fetchWithSessionRetry(
    apiUrl("/integrations/deepseek/test"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
      body: JSON.stringify(apiKey ? { apiKey } : {}),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error ?? `HTTP ${res.status}`,
      detail: data.detail,
    };
  }
  return {
    ok: data.ok !== false,
    message: data.message,
    error: data.error,
    detail: data.detail,
  };
}

export type BrandingImageUploadKind =
  | "company_logo"
  | "header_logo"
  | "company_chop";

export const apiUploadBrandingImage = async (
  file: File,
  kind: BrandingImageUploadKind,
): Promise<{ url: string }> => {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const res = await fetchWithSessionRetry(apiUrl("/uploads/branding"), {
    method: "POST",
    credentials: "include",
    headers: CSRF_HEADERS,
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text.trim() || `Upload failed: ${res.status}`;
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* plain-text error body */
    }
    throw new Error(message);
  }
  return (await res.json()) as { url: string };
};

/** Whether branding uploads survive a container recreate (GCS or a host directory vs. ephemeral disk). */
export const apiGetBrandingStorageStatus = () =>
  request<{ persistent: boolean; backend?: "gcs" | "local-volume" | "local-ephemeral" }>(
    "/uploads/branding/storage-status",
  );

/** Remove a file from storage after upload succeeded but settings save failed. */
export async function apiAbandonBrandingUpload(url: string): Promise<void> {
  const res = await fetchWithSessionRetry(apiUrl("/uploads/branding/abandon"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
    body: JSON.stringify({ url }),
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    let message = text.trim() || `Abandon failed: ${res.status}`;
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* plain-text error body */
    }
    throw new Error(message);
  }
}

export type GmailOAuthSlot = 1 | 2 | 3;
export const apiStartGmailOAuth = (slot: GmailOAuthSlot) =>
  request<{ url: string }>(`/gmail/oauth/start?slot=${slot}`);

export type ApiKey = {
  id: string;
  label: string;
  last4: string;
  permission: "read" | "read_write";
  revoked: boolean;
  expiresAt: string;
  lastUsedAt?: string | null;
  createdAt: string;
  token?: string;
};
export const apiListApiKeys = () => request<ApiKey[]>("/api-keys");
export const apiCreateApiKey = (body: {
  label: string;
  permission: "read" | "read_write";
  expiryDays: number;
}) =>
  request<ApiKey>("/api-keys", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const apiRevokeApiKey = (id: string) =>
  request<ApiKey>(`/api-keys/${id}/revoke`, { method: "POST" });


export async function apiProposalPublicInfo(id: string, token: string) {
  const res = await fetch(
    apiUrl(`/proposals/${id}/public?token=${encodeURIComponent(token)}`),
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    id: string;
    proposalNo: string;
    proposalRevision: number;
    status: string;
    clientName?: string;
    validUntil?: string;
    canConfirm: boolean;
    canRevise: boolean;
  }>;
}

export async function apiProposalPublicQuestion(
  id: string,
  body: {
    token: string;
    questionText: string;
    clientName?: string;
    clientEmail?: string;
  },
) {
  const res = await fetch(apiUrl(`/proposals/${id}/public/question`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiProposalPublicConfirm(
  id: string,
  token: string,
  signatureName: string,
) {
  const res = await fetch(apiUrl(`/proposals/${id}/public/confirm`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
    body: JSON.stringify({ token, signatureName }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiProposalPublicRevise(
  id: string,
  token: string,
  comment: string,
) {
  const res = await fetch(apiUrl(`/proposals/${id}/public/revise`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
    body: JSON.stringify({ token, comment }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiProposalPublicDownload(
  id: string,
  token: string,
): Promise<Blob> {
  const res = await fetch(apiUrl(`/proposals/${id}/public/download`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}
