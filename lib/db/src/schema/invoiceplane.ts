import { isNull } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export type LineItem = {
  /** Short title shown on PDFs (e.g. "Service fee"). */
  name: string;
  /** Longer description or summary for the line (optional). */
  description?: string;
  /** Fine print / bullet-style detail lines (optional; rendered under description on PDFs). */
  details?: string;
  quantity: number;
  price: number;
  taxRate?: number;
};

export type ServiceCategory = "setup" | "main" | "pen" | "vscan" | "others";

/** Live production rows vs company-wide test sandbox (`test_mode_enabled`). */
export type DataMode = "live" | "test";

/** Entities that support soft delete + audit logging. */
export type AuditEntityType = "client" | "invoice" | "quotation" | "payment" | "receipt";

export type AuditEventType = "deleted" | "restored" | "status_changed" | "purged";

export const clientsTable = pgTable("invoiceplane_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  /** Isolates live vs test sandbox datasets. */
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  clientCode: text("client_code").notNull(),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  addressLine3: text("address_line3"),
  addressLine4: text("address_line4"),
  country: text("country"),
  vatId: text("vat_id"),
  isActive: boolean("is_active").notNull().default(true),
  /** Soft delete: set instead of physically removing the row. Excluded from all normal reads. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoiceplane_clients_user_mode_idx").on(t.userId, t.dataMode),
  uniqueIndex("invoiceplane_clients_user_mode_code_uniq").on(t.userId, t.dataMode, t.clientCode).where(isNull(t.deletedAt)),
  index("invoiceplane_clients_active_idx").on(t.userId, t.dataMode).where(isNull(t.deletedAt)),
]);

/** Surveillance visit / renewal labels on a certification audit record. */
export type AuditVisitStatus = "sv" | "rn" | "sv_rn";

export const clientCertificationsTable = pgTable("invoiceplane_client_certifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  certificationBody: text("certification_body").notNull(),
  standard: text("standard").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoiceplane_client_certifications_client_idx").on(t.clientId),
  index("invoiceplane_client_certifications_user_mode_idx").on(t.userId, t.dataMode),
]);

export const clientCertificationAuditsTable = pgTable("invoiceplane_client_certification_audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  certificationId: uuid("certification_id").notNull().references(() => clientCertificationsTable.id, { onDelete: "cascade" }),
  auditDate: date("audit_date", { mode: "string" }).notNull(),
  status: text("status").$type<AuditVisitStatus | null>(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoiceplane_client_certification_audits_cert_date_idx").on(t.certificationId, t.auditDate),
]);

export const invoicesTable = pgTable("invoiceplane_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  /** Isolates live vs test sandbox datasets. */
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  status: text("status").notNull().default("draft"),
  /** Status to restore when a fully paid invoice is demoted after payment removal. */
  statusBeforePaid: text("status_before_paid"),
  currency: text("currency").notNull().default("HKD"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  serviceCategory: text("service_category").$type<ServiceCategory>().notNull().default("others"),
  cancellationReason: text("cancellation_reason"),
  notes: text("notes"),
  /** Staff-only; never rendered on invoice PDFs or client-facing documents. */
  internalNote: text("internal_note"),
  termsConditions: text("terms_conditions"),
  remark: text("remark"),
  shareToken: text("share_token"),
  shareTokenExpiresAt: timestamp("share_token_expires_at", { withTimezone: true }),
  /** Soft delete: set instead of physically removing the row. Excluded from all normal reads. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Partial: a soft-deleted invoice's number must not stay reserved forever (see migration 0046).
  uniqueIndex("invoiceplane_invoices_user_mode_number_uniq").on(t.userId, t.dataMode, t.invoiceNumber).where(isNull(t.deletedAt)),
  index("invoiceplane_invoices_user_mode_idx").on(t.userId, t.dataMode),
  // Reconciled from migration 0016 (created directly via raw SQL, not previously mirrored here).
  index("invoiceplane_invoices_user_id_idx").on(t.userId),
  index("invoiceplane_invoices_user_created_idx").on(t.userId, t.createdAt.desc()),
  index("invoiceplane_invoices_user_status_idx").on(t.userId, t.status),
  index("invoiceplane_invoices_user_invoice_date_idx").on(t.userId, t.invoiceDate),
  index("invoiceplane_invoices_active_idx").on(t.userId, t.dataMode).where(isNull(t.deletedAt)),
]);

/**
 * Line items for an invoice (migration 0037 replaced the old jsonb `items`
 * array with this child table). `position` preserves the array order the
 * jsonb column used to encode implicitly -- PDF renderers iterate line items
 * top-to-bottom, so order is load-bearing, not cosmetic. See lib/lineItems.ts
 * for the shared load/replace helpers (mirrors consultantLinks.ts's pattern).
 * quantity/price/taxRate are doublePrecision, not numeric: proposal milestone
 * billing can produce a non-terminating fraction (e.g. totalAmount * 33.33%)
 * that a fixed-scale numeric column would silently round; jsonb already
 * stored these as plain IEEE-754 doubles, so this is a lossless, zero
 * behavior-change column type.
 */
export const invoiceItemsTable = pgTable("invoiceplane_invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull().default(""),
  description: text("description"),
  details: text("details"),
  quantity: doublePrecision("quantity").notNull().default(0),
  price: doublePrecision("price").notNull().default(0),
  taxRate: doublePrecision("tax_rate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_invoice_items_parent_position_uniq").on(t.invoiceId, t.position),
]);

export const quotationsTable = pgTable("invoiceplane_quotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  /** Isolates live vs test sandbox datasets. */
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  quotationNumber: text("quotation_number").notNull(),
  quotationDate: date("quotation_date", { mode: "string" }).notNull(),
  validUntil: date("valid_until", { mode: "string" }),
  status: text("status").notNull().default("draft"),
  currency: text("currency").notNull().default("HKD"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  serviceCategory: text("service_category").$type<ServiceCategory>().notNull().default("others"),
  convertedInvoiceId: uuid("converted_invoice_id"),
  cancellationReason: text("cancellation_reason"),
  termsConditions: text("terms_conditions"),
  remark: text("remark"),
  /** PDF "Attn :" line (user-editable per quotation). */
  quotationAttn: text("quotation_attn"),
  /** Optional Google Drive (or other) link to the signed/confirmed quotation file. */
  driveFileUrl: text("drive_file_url"),
  shareToken: text("share_token"),
  shareTokenExpiresAt: timestamp("share_token_expires_at", { withTimezone: true }),
  /** Soft delete: set instead of physically removing the row. Excluded from all normal reads. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_quotations_user_mode_number_uniq").on(t.userId, t.dataMode, t.quotationNumber),
  index("invoiceplane_quotations_user_mode_idx").on(t.userId, t.dataMode),
  // Reconciled from migration 0016 (created directly via raw SQL, not previously mirrored here).
  index("invoiceplane_quotations_user_id_idx").on(t.userId),
  index("invoiceplane_quotations_user_created_idx").on(t.userId, t.createdAt.desc()),
  index("invoiceplane_quotations_user_status_idx").on(t.userId, t.status),
  index("invoiceplane_quotations_active_idx").on(t.userId, t.dataMode).where(isNull(t.deletedAt)),
]);

/** Line items for a quotation (see invoiceItemsTable above for the shared rationale). */
export const quotationItemsTable = pgTable("invoiceplane_quotation_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  quotationId: uuid("quotation_id").notNull().references(() => quotationsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull().default(""),
  description: text("description"),
  details: text("details"),
  quantity: doublePrecision("quantity").notNull().default(0),
  price: doublePrecision("price").notNull().default(0),
  taxRate: doublePrecision("tax_rate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_quotation_items_parent_position_uniq").on(t.quotationId, t.position),
]);

export const paymentsTable = pgTable("invoiceplane_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  /** Isolates live vs test sandbox datasets. */
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  invoiceId: uuid("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  paymentMethod: text("payment_method").notNull(),
  note: text("note"),
  // Enhanced payment tracking fields
  chequeNumber: text("cheque_number"),
  bankName: text("bank_name"),
  depositDate: date("deposit_date", { mode: "string" }),
  referenceNumber: text("reference_number"),
  transactionId: text("transaction_id"),
  /** Soft delete: set instead of physically removing the row. Excluded from all normal reads. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoiceplane_payments_user_mode_idx").on(t.userId, t.dataMode),
  // Reconciled from migration 0016 (created directly via raw SQL, not previously mirrored here).
  index("invoiceplane_payments_user_id_idx").on(t.userId),
  index("invoiceplane_payments_user_created_idx").on(t.userId, t.createdAt.desc()),
  index("invoiceplane_payments_invoice_id_idx").on(t.invoiceId),
  index("invoiceplane_payments_active_idx").on(t.userId, t.dataMode).where(isNull(t.deletedAt)),
]);

export type BankAccount = {
  bankName: string;
  accountNumber: string;
  swift?: string;
  bankCode?: string;
  branchName?: string;
  bankAddress?: string;
  accountName?: string;
};

export type GmailAccount = {
  senderEmail: string;
  /** OAuth2 refresh token for Gmail API (user authorization flow). */
  refreshToken?: string;
  /**
   * Legacy SMTP app password (deprecated). Ignored when `refreshToken` is set.
   * Kept for older stored rows until reconnected via OAuth.
   */
  serviceAccount?: string;
  /**
   * Service Account credentials for Domain-wide Delegation.
   * When provided, uses JWT authentication instead of OAuth2 refresh token.
   */
  serviceAccountCredentials?: {
    /** Service Account client email (e.g., service-account@project-id.iam.gserviceaccount.com) */
    clientEmail: string;
    /** Private key in PEM format (-----BEGIN PRIVATE KEY-----...) */
    privateKey: string;
  };
  /** Email signature (HTML) to append to outgoing emails */
  signature?: string;
  /** Sender name to display in email From field */
  senderName?: string;
  /** Space-delimited OAuth scopes granted when the account was connected. */
  oauthScopes?: string;
};

export type EmailTemplate = {
  subject: string;
  body: string;
};

export type EmailTemplates = {
  quotation: EmailTemplate;
  invoice: EmailTemplate;
  reminder: EmailTemplate;
  /** Email to consultants when sending a job order PDF */
  jobOrder: EmailTemplate;
  /** Email to clients when sending a proposal link + PDF */
  proposal: EmailTemplate;
};

/** Optional per-document PDF layout profiles (persisted JSON with server-side merges). See api-server pdfLayoutProfile.ts */
export type PdfDocumentLayoutsStored = Record<string, unknown>;

export const usersTable = pgTable("invoiceplane_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * Stable user identifier for scoping data (historically `sub` from Google OAuth).
   * Admins may pre-provision users with `pending:<email>` until a real id is assigned.
   */
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  role: text("role").notNull().default("user"),
  bankInfo: jsonb("bank_info").$type<BankAccount | null>(),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Bumped on every refresh-token use. The refresh token JWT embeds the
   * version it was issued with; a mismatch means the token was already
   * rotated (reuse of a stolen/replayed token) or the user's sessions were
   * force-revoked, and the refresh is rejected.
   */
  refreshTokenVersion: integer("refresh_token_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consultantsTable = pgTable("invoiceplane_consultants", {
  id: uuid("id").primaryKey().defaultRandom(),
  shortCode: text("short_code").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Join tables replacing the old `consultant_ids` jsonb arrays on invoices,
 * job orders, and proposal documents (see migration 0036). Each is an
 * unordered set: no surrogate id, no ordering column, composite PK on
 * (parentId, consultantId) so a consultant can't be linked twice to the same
 * parent. consultantId is ON DELETE RESTRICT to preserve the existing
 * "can't delete a referenced consultant" behavior (see consultants.ts).
 */
export const invoiceConsultantsTable = pgTable("invoiceplane_invoice_consultants", {
  invoiceId: uuid("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  consultantId: uuid("consultant_id").notNull().references(() => consultantsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.invoiceId, t.consultantId] }),
  index("invoiceplane_invoice_consultants_consultant_idx").on(t.consultantId),
]);

export const jobOrderConsultantsTable = pgTable("invoiceplane_job_order_consultants", {
  jobOrderId: uuid("job_order_id").notNull().references(() => jobOrdersTable.id, { onDelete: "cascade" }),
  consultantId: uuid("consultant_id").notNull().references(() => consultantsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.jobOrderId, t.consultantId] }),
  index("invoiceplane_job_order_consultants_consultant_idx").on(t.consultantId),
]);

export const proposalDocumentConsultantsTable = pgTable("invoiceplane_proposal_document_consultants", {
  proposalId: uuid("proposal_id").notNull().references(() => proposalDocumentsTable.id, { onDelete: "cascade" }),
  consultantId: uuid("consultant_id").notNull().references(() => consultantsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.proposalId, t.consultantId] }),
  index("invoiceplane_proposal_document_consultants_consultant_idx").on(t.consultantId),
]);

export const jobOrdersTable = pgTable("invoiceplane_job_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  /** Isolates live vs test sandbox datasets. */
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  jobOrderNumber: text("job_order_number").notNull(),
  jobDate: text("job_date").notNull(),
  status: text("status").notNull().default("draft"),
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_job_orders_user_mode_number_uniq").on(t.userId, t.dataMode, t.jobOrderNumber),
  index("invoiceplane_job_orders_user_mode_idx").on(t.userId, t.dataMode),
]);

/** Line items for a job order (see invoiceItemsTable above for the shared rationale). */
export const jobOrderItemsTable = pgTable("invoiceplane_job_order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobOrderId: uuid("job_order_id").notNull().references(() => jobOrdersTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull().default(""),
  description: text("description"),
  details: text("details"),
  quantity: doublePrecision("quantity").notNull().default(0),
  price: doublePrecision("price").notNull().default(0),
  taxRate: doublePrecision("tax_rate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_job_order_items_parent_position_uniq").on(t.jobOrderId, t.position),
]);

export const recurringInvoicesTable = pgTable("invoiceplane_recurring_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  label: text("label").notNull(),
  frequency: text("frequency").notNull(),
  nextRunDate: text("next_run_date").notNull(),
  currency: text("currency").notNull().default("HKD"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Line items for a recurring invoice schedule (see invoiceItemsTable above for the shared rationale). */
export const recurringInvoiceItemsTable = pgTable("invoiceplane_recurring_invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  recurringInvoiceId: uuid("recurring_invoice_id").notNull().references(() => recurringInvoicesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull().default(""),
  description: text("description"),
  details: text("details"),
  quantity: doublePrecision("quantity").notNull().default(0),
  price: doublePrecision("price").notNull().default(0),
  taxRate: doublePrecision("tax_rate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_recurring_invoice_items_parent_position_uniq").on(t.recurringInvoiceId, t.position),
]);

export type ProposalSetupTemplateId = "iso9001" | "iso14001-45001" | "iso27001";

export type ProposalSetupTemplate = {
  label: string;
  description?: string;
  isoStandards: string[];
  proposalScope?: string;
  scopePhases: ProposalPhase[];
  paymentSchedule: ProposalPaymentScheduleItem[];
  termsConditions?: string;
  /** IDs from the built-in job reference template library. */
  jobReferenceTemplateIds?: string[];
  /** IDs from the built-in testimonial template library. */
  testimonialTemplateIds?: string[];
};

export type ProposalSetupTemplates = Record<ProposalSetupTemplateId, ProposalSetupTemplate>;

export const companySettingsTable = pgTable("invoiceplane_company_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyName: text("company_name").notNull().default(""),
  address: text("address"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  addressLine3: text("address_line3"),
  addressLine4: text("address_line4"),
  phone: text("phone"),
  email: text("email"),
  vatId: text("vat_id"),
  defaultCurrency: text("default_currency").notNull().default("HKD"),
  bankAccount1: jsonb("bank_account_1").$type<BankAccount | null>(),
  bankAccount2: jsonb("bank_account_2").$type<BankAccount | null>(),
  logoUrl: text("logo_url"),
  headerLogoUrl: text("header_logo_url"),
  /** @deprecated Prefer chopUrl for PDF chop/stamp; kept for backward compatibility. */
  signatureImageUrl: text("signature_image_url"),
  /** Company chop / seal image (public object storage URL). */
  chopUrl: text("chop_url"),
  companyLogoScale: numeric("company_logo_scale", { precision: 5, scale: 2 }).default("1"),
  headerLogoScale: numeric("header_logo_scale", { precision: 5, scale: 2 }).default("1"),
  /** Header banner width as a fraction of content width (0.25–1); lets it be narrowed to sit beside the company logo. */
  headerLogoWidthScale: numeric("header_logo_width_scale", { precision: 5, scale: 2 }).default("1"),
  /** @deprecated Prefer chopScale; synced when chop fields update. */
  signatureImageScale: numeric("signature_image_scale", { precision: 5, scale: 2 }).default("1"),
  chopScale: numeric("chop_scale", { precision: 5, scale: 2 }).default("1"),
  /** Whether the company chop is drawn on proposal PDFs. On by default (matches prior unconditional behavior). */
  proposalShowChop: boolean("proposal_show_chop").notNull().default(true),
  /**
   * When true, the whole company works in an empty test sandbox.
   * Scoped modules (clients, invoices, quotations, payments, receipts, job orders)
   * only see/write rows with data_mode = 'test'; live rows are untouched.
   */
  testModeEnabled: boolean("test_mode_enabled").notNull().default(false),
  deepseekApiKey: text("deepseek_api_key"),
  deepseekModel: text("deepseek_model"),
  gmailServiceAccount: text("gmail_service_account"),
  gmailSenderEmail: text("gmail_sender_email"),
  gmailAccount1: jsonb("gmail_account_1").$type<GmailAccount | null>(),
  gmailAccount2: jsonb("gmail_account_2").$type<GmailAccount | null>(),
  gmailAccount3: jsonb("gmail_account_3").$type<GmailAccount | null>(),
  emailTemplates: jsonb("email_templates").$type<EmailTemplates | null>(),
  /** Per-document PDF layout configuration (invoice, quotation, jobOrder, receipt). */
  pdfDocumentLayouts: jsonb("pdf_document_layouts").$type<PdfDocumentLayoutsStored>(),
  /** ISO proposal wizard defaults (ISO 9001, ISO 14001/45001, ISO 27001). */
  proposalSetupTemplates: jsonb("proposal_setup_templates").$type<Partial<ProposalSetupTemplates> | null>(),
  /** Default branding and profile wording for generated ISO proposals. */
  proposalProfile: jsonb("proposal_profile").$type<CompanyProposalProfile | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Durable backup of uploaded branding images (company logo, header banner,
 * company chop), keyed by the same relative path used in object storage
 * (e.g. `branding/company-logo/<uuid>.png`). Uploaded files on local disk are
 * wiped on every redeploy/restart unless a persistent volume or GCS bucket is
 * configured; Postgres is virtually always durable, so this table gives PDF
 * generation and the branding preview a fallback that survives regardless of
 * the storage backend.
 */
export const brandingAssetsTable = pgTable("invoiceplane_branding_assets", {
  relPath: text("rel_path").primaryKey(),
  contentType: text("content_type").notNull(),
  dataBase64: text("data_base64").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeysTable = pgTable("invoiceplane_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull(),
  last4: text("last4").notNull(),
  permission: text("permission").notNull().default("read_write"),
  createdByUserId: text("created_by_user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  revoked: boolean("revoked").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quotationTemplatesTable = pgTable("invoiceplane_quotation_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("HKD"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoiceplane_quotation_templates_user_idx").on(t.userId),
]);

/** Line items for a quotation template (see invoiceItemsTable above for the shared rationale). */
export const quotationTemplateItemsTable = pgTable("invoiceplane_quotation_template_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  quotationTemplateId: uuid("quotation_template_id").notNull().references(() => quotationTemplatesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  name: text("name").notNull().default(""),
  description: text("description"),
  details: text("details"),
  quantity: doublePrecision("quantity").notNull().default(0),
  price: doublePrecision("price").notNull().default(0),
  taxRate: doublePrecision("tax_rate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_quotation_template_items_parent_position_uniq").on(t.quotationTemplateId, t.position),
]);

export const receiptsTable = pgTable("invoiceplane_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  /** Isolates live vs test sandbox datasets. */
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  receiptNumber: text("receipt_number").notNull(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  /** The specific payment this receipt documents, when generated from one. Nullable: manually-created receipts (or older rows) have no linked payment. */
  paymentId: uuid("payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("HKD"),
  chequeNumber: text("cheque_number"),
  chequeDetails: text("cheque_details"),
  receiptDate: date("receipt_date", { mode: "string" }).notNull(),
  notes: text("notes"),
  /** Soft delete: set instead of physically removing the row. Excluded from all normal reads. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_receipts_user_mode_receipt_uniq").on(t.userId, t.dataMode, t.receiptNumber),
  index("invoiceplane_receipts_user_mode_idx").on(t.userId, t.dataMode),
  // A payment should be documented by at most one generated receipt; nulls (manually-created receipts) don't conflict under a unique index.
  // Partial (not a plain unique()): a payment should be documented by at most
  // one *active* receipt, but a soft-deleted receipt must free up its
  // paymentId slot so a fresh receipt can be generated for that payment.
  uniqueIndex("invoiceplane_receipts_payment_uniq").on(t.paymentId).where(isNull(t.deletedAt)),
  index("invoiceplane_receipts_active_idx").on(t.userId, t.dataMode).where(isNull(t.deletedAt)),
]);

/**
 * A single milestone in a manual proposal's payment schedule, expressed as a
 * percentage of the proposal total. Labels are free-form so the schedule is
 * flexible (e.g. "Confirmation of proposal", "Completion of Internal Audit").
 */
export type ProposalPaymentScheduleItem = {
  label: string;
  /** Percentage of the total amount (0–100). */
  percentage: number;
};

/**
 * Manually-entered proposal details for a client that has no system-generated
 * (confirmed) quotation — e.g. brand-new clients or clients who signed an
 * externally-produced proposal. One row per (userId, clientId).
 */
export type ProposalPhase = {
  phase: number;
  title: string;
  description: string;
  deliverable?: string;
  weeks: number;
  startMonth: number;
  spanMonths: number;
};

/** A certification site covered by a multi-location ISO proposal. */
export type ProposalCertificationLocation = {
  address: string;
  staffCount: number;
};

/** Reusable consultant branding / profile text for ISO proposal PDFs. */
export type CompanyProposalProfile = {
  shortName?: string;
  slogan?: string;
  website?: string;
  establishedYear?: string;
  headquarterLocation?: string;
  certificationsDisplay?: string;
  industryExperienceList?: string;
  serviceList?: string[];
};

/** Presentation-style proposal template options (Codex variable groups). */
export type ProposalTemplateData = {
  proposalTitle?: string;
  salesContact?: { name?: string; title?: string; phone?: string; email?: string };
  certificationBody?: {
    enabled?: boolean;
    name?: string;
    shortName?: string;
    logoUrl?: string;
    description?: string;
    accreditationName?: string;
    accreditationDescription?: string;
  };
  optionalMaintenance?: { enabled?: boolean; supportHours?: string };
  feeRows?: Array<{ year: string; consultancyFee?: number; certificationFee?: number }>;
  terms?: {
    commencementDays?: number;
    invoiceDueDays?: number;
    claimsCap?: string;
    certificationGuaranteeEnabled?: boolean;
  };
  auditType?: string;
};

export type ProposalConsultantPortfolioItem = {
  consultantId: string;
  photoUrl?: string;
  bio?: string;
};

export type ProposalJobReference = {
  clientName: string;
  projectTitle: string;
  description?: string;
  /** Certification ceremony or project reference photo. */
  photoUrl?: string;
};

export type ProposalTestimonial = {
  quote: string;
  authorName: string;
  authorTitle?: string;
  companyName?: string;
  /** Headshot or company logo shown beside the quote. */
  photoUrl?: string;
};

export type ProposalMilestoneInvoice = {
  scheduleIndex: number;
  label: string;
  invoiceId: string;
  invoiceNumber?: string;
  invoicedAt: string;
};

export type ProposalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "confirmed"
  | "revision_requested"
  | "no_response"
  | "rejected"
  | "expired"
  | "superseded"
  | "cancelled";

export type ProposalActivityEventType =
  | "link_opened"
  | "pdf_viewed"
  | "pdf_downloaded"
  | "question_raised"
  | "confirmed"
  | "revision_requested"
  | "sent"
  | "approved"
  | "submitted"
  | "rejected"
  | "cancelled"
  | "no_response"
  | "milestone_invoiced";

/** Full generated proposal document (distinct from lightweight client_proposals metadata). */
export const proposalDocumentsTable = pgTable("invoiceplane_proposal_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  proposalNo: text("proposal_no").notNull(),
  proposalRevision: integer("proposal_revision").notNull().default(0),
  status: text("status").$type<ProposalStatus>().notNull().default("draft"),
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
  coverPhotoUrl: text("cover_photo_url"),
  firmIntro: text("firm_intro"),
  certificationBodyIntro: text("certification_body_intro"),
  clientStaffCount: integer("client_staff_count"),
  isoStandards: jsonb("iso_standards").$type<string[]>().notNull().default([]),
  proposalScope: text("proposal_scope"),
  certificationLocations: jsonb("certification_locations").$type<ProposalCertificationLocation[]>().notNull().default([]),
  templateData: jsonb("template_data").$type<ProposalTemplateData>().notNull().default({}),
  scopePhases: jsonb("scope_phases").$type<ProposalPhase[]>().notNull().default([]),
  pmToolsIntro: text("pm_tools_intro"),
  trainingPlatformIntro: text("training_platform_intro"),
  termsConditions: text("terms_conditions"),
  consultantPortfolio: jsonb("consultant_portfolio").$type<ProposalConsultantPortfolioItem[]>().notNull().default([]),
  jobReferences: jsonb("job_references").$type<ProposalJobReference[]>().notNull().default([]),
  testimonials: jsonb("testimonials").$type<ProposalTestimonial[]>().notNull().default([]),
  currency: text("currency").notNull().default("HKD"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentSchedule: jsonb("payment_schedule").$type<ProposalPaymentScheduleItem[]>().notNull().default([]),
  milestoneInvoices: jsonb("milestone_invoices").$type<ProposalMilestoneInvoice[]>().notNull().default([]),
  shareToken: text("share_token"),
  shareTokenExpiresAt: timestamp("share_token_expires_at", { withTimezone: true }),
  jobOrderId: uuid("job_order_id"),
  revisionRequestComment: text("revision_request_comment"),
  clientConfirmedAt: timestamp("client_confirmed_at", { withTimezone: true }),
  clientSignatureName: text("client_signature_name"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  supersededById: uuid("superseded_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_proposal_documents_user_no_rev_uniq").on(t.userId, t.proposalNo, t.proposalRevision),
]);

export const proposalActivityLogTable = pgTable("invoiceplane_proposal_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposalDocumentsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  eventType: text("event_type").$type<ProposalActivityEventType>().notNull(),
  eventData: jsonb("event_data").$type<Record<string, unknown>>(),
  actorType: text("actor_type").notNull().default("client"),
  clientIp: text("client_ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const proposalQuestionsTable = pgTable("invoiceplane_proposal_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposalDocumentsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  questionText: text("question_text").notNull(),
  clientName: text("client_name"),
  clientEmail: text("client_email"),
  status: text("status").notNull().default("open"),
  staffReply: text("staff_reply"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  repliedByUserId: text("replied_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientProposalsTable = pgTable("invoiceplane_client_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  proposalNo: text("proposal_no"),
  /** Revision number: 0, 1, 2, 3, … */
  proposalRevision: integer("proposal_revision").notNull().default(0),
  currency: text("currency").notNull().default("HKD"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  /** Google Drive (or other) link to the proposal file; clickable to preview. */
  driveFileUrl: text("drive_file_url"),
  paymentSchedule: jsonb("payment_schedule").$type<ProposalPaymentScheduleItem[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_client_proposals_user_client_uniq").on(t.userId, t.clientId),
]);

export type PaymentReceiptType = "receipt" | "screenshot" | "cheque_deposit" | "other";

export const paymentReceiptsTable = pgTable("invoiceplane_payment_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  /** Isolates live vs test sandbox datasets. */
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  paymentId: uuid("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  receiptType: text("receipt_type").$type<PaymentReceiptType>().notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  description: text("description"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("invoiceplane_payment_receipts_path_uniq").on(t.filePath),
  index("invoiceplane_payment_receipts_user_mode_idx").on(t.userId, t.dataMode),
  index("invoiceplane_payment_receipts_payment_idx").on(t.paymentId),
  index("invoiceplane_payment_receipts_invoice_idx").on(t.invoiceId),
]);

/**
 * Records deletions, restores, and status changes on the core quote-to-cash
 * entities (clients, invoices, quotations, payments, receipts), which
 * otherwise have no history beyond `updated_at`. Mirrors the shape of
 * `proposalActivityLogTable` but is generic across entity types rather than
 * scoped to one parent table.
 */
export const auditLogTable = pgTable("invoiceplane_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => usersTable.googleSub, { onDelete: "restrict", onUpdate: "cascade" }),
  /** Isolates live vs test sandbox datasets. */
  dataMode: text("data_mode").$type<DataMode>().notNull().default("live"),
  entityType: text("entity_type").$type<AuditEntityType>().notNull(),
  entityId: uuid("entity_id").notNull(),
  eventType: text("event_type").$type<AuditEventType>().notNull(),
  /** e.g. { from: "sent", to: "paid" } for status_changed; empty for deleted/restored. */
  eventData: jsonb("event_data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoiceplane_audit_log_entity_idx").on(t.entityType, t.entityId),
  index("invoiceplane_audit_log_user_mode_idx").on(t.userId, t.dataMode),
]);
