import {
  clientsTable,
  companySettingsTable,
  db,
  invoicesTable,
  jobOrdersTable,
  paymentReceiptsTable,
  paymentsTable,
  quotationsTable,
  receiptsTable,
  type BankAccount,
  type GmailAccount,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import {
  BRANDING_STORAGE_URL_PREFIX,
  isManagedBrandingStoragePath,
  publicObjectRelPathFromStoredUrl,
} from "../../lib/brandingImageUrl";
import { invalidateCompanySettingsCache } from "../../lib/companySettingsCache";
import { isGmailOAuthConfigured } from "../../lib/gmailApi";
import { headerBannerWidthScaleFactor } from "@workspace/invoice-utils";
import { logoScaleFactor } from "../../lib/logoScale";
import { mergePdfDocumentLayouts, patchPdfDocumentLayouts } from "../../lib/pdfLayoutProfile";
import { DEFAULT_EMAIL_TEMPLATES, ensureCompanySettings, objectStorageService } from "./helpers";

const router: IRouter = Router();

const BankAccountSchema = z.object({
  bankName: z.string(),
  accountNumber: z.string(),
  swift: z.string().optional(),
  bankCode: z.string().optional(),
  branchName: z.string().optional(),
  bankAddress: z.string().optional(),
  accountName: z.string().optional(),
});

const GmailAccountSchema = z.object({
  senderEmail: z.string(),
  refreshToken: z.string().optional(),
  /** @deprecated Legacy SMTP app password — use OAuth refreshToken */
  serviceAccount: z.string().optional(),
  oauthScopes: z.string().optional(),
  /** Email signature (HTML) to append to outgoing emails */
  signature: z.string().optional(),
  /** Sender name to display in email From field */
  senderName: z.string().optional(),
});

const EmailTemplateSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

const EmailTemplatesSchema = z.object({
  quotation: EmailTemplateSchema,
  invoice: EmailTemplateSchema,
  reminder: EmailTemplateSchema,
  jobOrder: EmailTemplateSchema,
  proposal: EmailTemplateSchema,
});

function publicGmailAccountDto(g: GmailAccount | null): {
  senderEmail: string;
  connected: boolean;
  signature?: string;
  senderName?: string;
} | null {
  if (!g?.senderEmail?.trim()) return null;
  const connected =
    Boolean(g.refreshToken?.trim()) || Boolean(g.serviceAccountCredentials);
  return {
    senderEmail: g.senderEmail.trim(),
    connected,
    signature: g.signature,
    senderName: g.senderName,
  };
}

// ---------- Company Settings ----------
const logoScaleField = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const n = typeof v === "string" ? Number(v) : v;
    if (!Number.isFinite(n)) return undefined;
    return logoScaleFactor(n);
  });

const headerLogoWidthScaleField = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const n = typeof v === "string" ? Number(v) : v;
    if (!Number.isFinite(n)) return undefined;
    return headerBannerWidthScaleFactor(n);
  });

/** Only app-uploaded public object URLs (blocks SSRF from arbitrary http(s) in PDF fetches). */
const storedBrandingImageUrlField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((val): string | null | undefined => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    const t = val.trim();
    return t === "" ? null : t;
  })
  .refine(
    (val) =>
      val === undefined ||
      val === null ||
      (typeof val === "string" &&
        val.startsWith(BRANDING_STORAGE_URL_PREFIX) &&
        !val.includes("..")),
    {
      message: `Image URL must be an uploaded path under ${BRANDING_STORAGE_URL_PREFIX}`,
    },
  );

const CompanySettingsSchema = z.object({
  companyName: z.string().optional(),
  address: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  addressLine3: z.string().nullable().optional(),
  addressLine4: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  defaultCurrency: z.enum(["HKD", "USD", "CNY", "MOP"]).optional(),
  bankAccount1: BankAccountSchema.nullable().optional(),
  bankAccount2: BankAccountSchema.nullable().optional(),
  logoUrl: storedBrandingImageUrlField,
  headerLogoUrl: storedBrandingImageUrlField,
  chopUrl: storedBrandingImageUrlField,
  companyLogoScale: logoScaleField,
  headerLogoScale: logoScaleField,
  headerLogoWidthScale: headerLogoWidthScaleField,
  chopScale: logoScaleField,
  proposalShowChop: z.boolean().optional(),
  testModeEnabled: z.boolean().optional(),
  deepseekApiKey: z.string().nullable().optional(),
  deepseekModel: z.string().nullable().optional(),
  gmailAccount1: GmailAccountSchema.nullable().optional(),
  gmailAccount2: GmailAccountSchema.nullable().optional(),
  gmailAccount3: GmailAccountSchema.nullable().optional(),
  emailTemplates: EmailTemplatesSchema.nullable().optional(),
  pdfDocumentLayouts: z.record(z.string(), z.any()).nullable().optional(),
});

function settingsDto(row: typeof companySettingsTable.$inferSelect) {
  const g1 = row.gmailAccount1 as GmailAccount | null;
  const g2 = row.gmailAccount2 as GmailAccount | null;
  const g3 = row.gmailAccount3 as GmailAccount | null;
  const mergedTemplates =
    row.emailTemplates &&
    typeof row.emailTemplates === "object" &&
    row.emailTemplates !== null
      ? {
          ...DEFAULT_EMAIL_TEMPLATES,
          ...row.emailTemplates,
          jobOrder:
            row.emailTemplates.jobOrder?.subject?.trim() && row.emailTemplates.jobOrder?.body?.trim()
              ? row.emailTemplates.jobOrder
              : DEFAULT_EMAIL_TEMPLATES.jobOrder,
          proposal:
            row.emailTemplates.proposal?.subject?.trim() && row.emailTemplates.proposal?.body?.trim()
              ? row.emailTemplates.proposal
              : DEFAULT_EMAIL_TEMPLATES.proposal,
        }
      : null;
  return {
    id: row.id,
    companyName: row.companyName,
    address: row.address ?? undefined,
    addressLine1: row.addressLine1 ?? undefined,
    addressLine2: row.addressLine2 ?? undefined,
    addressLine3: row.addressLine3 ?? undefined,
    addressLine4: row.addressLine4 ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    defaultCurrency: row.defaultCurrency,
    bankAccount1: (row.bankAccount1 as BankAccount | null) ?? null,
    bankAccount2: (row.bankAccount2 as BankAccount | null) ?? null,
    logoUrl: row.logoUrl ?? undefined,
    headerLogoUrl: row.headerLogoUrl ?? undefined,
    chopUrl: row.chopUrl ?? row.signatureImageUrl ?? undefined,
    companyLogoScale: logoScaleFactor(row.companyLogoScale),
    headerLogoScale: logoScaleFactor(row.headerLogoScale),
    headerLogoWidthScale: headerBannerWidthScaleFactor(row.headerLogoWidthScale),
    chopScale: logoScaleFactor(row.chopScale ?? row.signatureImageScale),
    proposalShowChop: row.proposalShowChop,
    testModeEnabled: row.testModeEnabled,
    // deepseekApiKey is intentionally omitted from the DTO; it is write-only
    // and used internally by the DeepSeek test/extraction endpoints.
    deepseekModel: row.deepseekModel ?? undefined,
    gmailAccount1: publicGmailAccountDto(g1),
    gmailAccount2: publicGmailAccountDto(g2),
    gmailAccount3: publicGmailAccountDto(g3),
    gmailOAuthConfigured: isGmailOAuthConfigured(),
    emailTemplates: mergedTemplates,
    pdfDocumentLayouts: mergePdfDocumentLayouts(row.pdfDocumentLayouts ?? {}, row) as Record<string, unknown>,
    /** Used by the SPA to cache-bust PDF preview iframes after branding changes. */
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : undefined,
  };
}

router.get("/company-settings", requireAdmin, async (_req, res) => {
  const row = await ensureCompanySettings();
  res.json(settingsDto(row));
});

router.patch("/company-settings", requireAdmin, async (req, res) => {
  const rawBody =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? ({ ...(req.body as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  if ("signatureImageUrl" in rawBody && !("chopUrl" in rawBody)) {
    rawBody.chopUrl = rawBody.signatureImageUrl;
  }
  if ("signatureImageScale" in rawBody && !("chopScale" in rawBody)) {
    rawBody.chopScale = rawBody.signatureImageScale;
  }
  const keySent = (key: string) => Object.prototype.hasOwnProperty.call(rawBody, key);

  const parsed = CompanySettingsSchema.parse(rawBody);
  const current = await ensureCompanySettings();

  const mergeGmail = (incoming: GmailAccount | null | undefined, existing: GmailAccount | null): GmailAccount | null => {
    if (incoming === undefined) return existing;
    if (incoming === null) return null;
    const senderEmail = (incoming.senderEmail ?? existing?.senderEmail ?? "").trim();
    if (!senderEmail) return null;
    const refreshToken =
      incoming.refreshToken?.trim() || existing?.refreshToken?.trim() || undefined;
    const serviceAccount =
      incoming.serviceAccount?.trim() || existing?.serviceAccount?.trim() || undefined;
    const signature =
      incoming.signature !== undefined ? incoming.signature : existing?.signature;
    const senderName =
      incoming.senderName?.trim() || existing?.senderName?.trim() || undefined;
    const oauthScopes =
      incoming.oauthScopes?.trim() || existing?.oauthScopes?.trim() || undefined;
    const acc: GmailAccount = { senderEmail };
    if (refreshToken) acc.refreshToken = refreshToken;
    if (serviceAccount) acc.serviceAccount = serviceAccount;
    if (oauthScopes) acc.oauthScopes = oauthScopes;
    if (signature !== undefined) acc.signature = signature;
    if (senderName) acc.senderName = senderName;
    return acc;
  };

  const relsToDelete: string[] = [];
  const queueDeleteIfReplaced = (
    key: "logoUrl" | "headerLogoUrl" | "chopUrl",
    newStored: string | null | undefined,
  ) => {
    if (!keySent(key)) return;
    const prev =
      key === "logoUrl"
        ? current.logoUrl
        : key === "headerLogoUrl"
          ? current.headerLogoUrl
          : current.chopUrl ?? current.signatureImageUrl;
    const oldRel = publicObjectRelPathFromStoredUrl(prev);
    const newRel = publicObjectRelPathFromStoredUrl(newStored ?? null);
    if (oldRel && isManagedBrandingStoragePath(oldRel) && oldRel !== newRel) {
      relsToDelete.push(oldRel);
    }
  };

  queueDeleteIfReplaced("logoUrl", parsed.logoUrl);
  queueDeleteIfReplaced("headerLogoUrl", parsed.headerLogoUrl);
  queueDeleteIfReplaced("chopUrl", parsed.chopUrl);

  const gmailAccount1 = keySent("gmailAccount1")
    ? mergeGmail(parsed.gmailAccount1 as GmailAccount | null | undefined, current.gmailAccount1 as GmailAccount | null)
    : (current.gmailAccount1 as GmailAccount | null);
  const gmailAccount2 = keySent("gmailAccount2")
    ? mergeGmail(parsed.gmailAccount2 as GmailAccount | null | undefined, current.gmailAccount2 as GmailAccount | null)
    : (current.gmailAccount2 as GmailAccount | null);
  const gmailAccount3 = keySent("gmailAccount3")
    ? mergeGmail(parsed.gmailAccount3 as GmailAccount | null | undefined, current.gmailAccount3 as GmailAccount | null)
    : (current.gmailAccount3 as GmailAccount | null);

  const {
    companyLogoScale: patchCompanyLogoScale,
    headerLogoScale: patchHeaderLogoScale,
    headerLogoWidthScale: patchHeaderLogoWidthScale,
    chopScale: patchChopScale,
    pdfDocumentLayouts: patchLayoutsRaw,
  } = parsed;

  const layoutsPatch =
    !keySent("pdfDocumentLayouts")
      ? undefined
      : patchLayoutsRaw === undefined
        ? undefined
        : patchLayoutsRaw === null
          ? null
          : patchPdfDocumentLayouts(
              mergePdfDocumentLayouts(current.pdfDocumentLayouts ?? {}, current),
              patchLayoutsRaw as Record<string, unknown>,
              { ...current, ...parsed },
            ) as Record<string, unknown>;

  const updatePayload: Partial<typeof companySettingsTable.$inferInsert> = {};

  if (keySent("companyName") && parsed.companyName !== undefined) {
    updatePayload.companyName = parsed.companyName;
  }
  if (keySent("address")) updatePayload.address = parsed.address ?? null;
  if (keySent("addressLine1")) updatePayload.addressLine1 = parsed.addressLine1 ?? null;
  if (keySent("addressLine2")) updatePayload.addressLine2 = parsed.addressLine2 ?? null;
  if (keySent("addressLine3")) updatePayload.addressLine3 = parsed.addressLine3 ?? null;
  if (keySent("addressLine4")) updatePayload.addressLine4 = parsed.addressLine4 ?? null;
  if (keySent("phone")) updatePayload.phone = parsed.phone ?? null;
  if (keySent("email")) updatePayload.email = parsed.email ?? null;
  if (keySent("defaultCurrency") && parsed.defaultCurrency !== undefined) {
    updatePayload.defaultCurrency = parsed.defaultCurrency;
  }
  if (keySent("bankAccount1")) updatePayload.bankAccount1 = parsed.bankAccount1 ?? null;
  if (keySent("bankAccount2")) updatePayload.bankAccount2 = parsed.bankAccount2 ?? null;
  if (keySent("logoUrl")) updatePayload.logoUrl = parsed.logoUrl ?? null;
  if (keySent("headerLogoUrl")) updatePayload.headerLogoUrl = parsed.headerLogoUrl ?? null;
  if (keySent("chopUrl")) {
    updatePayload.chopUrl = parsed.chopUrl ?? null;
    // Always clear legacy signature_image_url so it cannot resurrect a removed chop
    // via companyChopStoredUrl / settingsDto fallback after Branding "Remove".
    updatePayload.signatureImageUrl = null;
  }
  if (keySent("deepseekApiKey")) updatePayload.deepseekApiKey = parsed.deepseekApiKey ?? null;
  if (keySent("deepseekModel")) updatePayload.deepseekModel = parsed.deepseekModel ?? null;
  if (keySent("gmailAccount1")) updatePayload.gmailAccount1 = gmailAccount1;
  if (keySent("gmailAccount2")) updatePayload.gmailAccount2 = gmailAccount2;
  if (keySent("gmailAccount3")) updatePayload.gmailAccount3 = gmailAccount3;
  if (keySent("emailTemplates")) updatePayload.emailTemplates = parsed.emailTemplates ?? null;
  if (layoutsPatch !== undefined) {
    updatePayload.pdfDocumentLayouts = layoutsPatch as typeof current.pdfDocumentLayouts;
  }
  if (keySent("companyLogoScale") && patchCompanyLogoScale !== undefined) {
    updatePayload.companyLogoScale = String(patchCompanyLogoScale);
  }
  if (keySent("headerLogoScale") && patchHeaderLogoScale !== undefined) {
    updatePayload.headerLogoScale = String(patchHeaderLogoScale);
  }
  if (keySent("headerLogoWidthScale") && patchHeaderLogoWidthScale !== undefined) {
    updatePayload.headerLogoWidthScale = String(patchHeaderLogoWidthScale);
  }
  if (keySent("chopScale") && patchChopScale !== undefined) {
    updatePayload.chopScale = String(patchChopScale);
    updatePayload.signatureImageScale = String(patchChopScale);
  }
  if (keySent("proposalShowChop") && parsed.proposalShowChop !== undefined) {
    updatePayload.proposalShowChop = parsed.proposalShowChop;
  }
  if (keySent("testModeEnabled") && parsed.testModeEnabled !== undefined) {
    updatePayload.testModeEnabled = parsed.testModeEnabled;
  }

  if (Object.keys(updatePayload).length === 0) {
    res.json(settingsDto(current));
    return;
  }

  const [row] = await db
    .update(companySettingsTable)
    .set({ ...updatePayload, updatedAt: new Date() })
    .where(eq(companySettingsTable.id, current.id))
    .returning();

  for (const rel of relsToDelete) {
    try {
      await objectStorageService.deletePublicAsset(rel);
    } catch (err) {
      req.log?.warn?.({ err, rel }, "Could not delete replaced branding image");
    }
  }

  invalidateCompanySettingsCache();
  res.json(settingsDto(row));
});

/**
 * Wipes every `dataMode = "test"` row across the sandbox tables (admin-only).
 * Delete order respects FK restrictions: payment receipts -> payments ->
 * receipts -> job orders (children cascade) -> invoices (children cascade)
 * -> quotations -> clients (invoices/quotations/job orders reference clients
 * with `onDelete: "restrict"`, so clients must be last). Live rows
 * (`dataMode = "live"`) are never touched.
 */
router.post("/company-settings/clear-test-data", requireAdmin, async (_req, res) => {
  const counts = await db.transaction(async (tx) => {
    const deletedPaymentReceipts = await tx
      .delete(paymentReceiptsTable)
      .where(eq(paymentReceiptsTable.dataMode, "test"))
      .returning({ id: paymentReceiptsTable.id });
    const deletedPayments = await tx
      .delete(paymentsTable)
      .where(eq(paymentsTable.dataMode, "test"))
      .returning({ id: paymentsTable.id });
    const deletedReceipts = await tx
      .delete(receiptsTable)
      .where(eq(receiptsTable.dataMode, "test"))
      .returning({ id: receiptsTable.id });
    const deletedJobOrders = await tx
      .delete(jobOrdersTable)
      .where(eq(jobOrdersTable.dataMode, "test"))
      .returning({ id: jobOrdersTable.id });
    const deletedInvoices = await tx
      .delete(invoicesTable)
      .where(eq(invoicesTable.dataMode, "test"))
      .returning({ id: invoicesTable.id });
    const deletedQuotations = await tx
      .delete(quotationsTable)
      .where(eq(quotationsTable.dataMode, "test"))
      .returning({ id: quotationsTable.id });
    const deletedClients = await tx
      .delete(clientsTable)
      .where(eq(clientsTable.dataMode, "test"))
      .returning({ id: clientsTable.id });

    return {
      paymentReceipts: deletedPaymentReceipts.length,
      payments: deletedPayments.length,
      receipts: deletedReceipts.length,
      jobOrders: deletedJobOrders.length,
      invoices: deletedInvoices.length,
      quotations: deletedQuotations.length,
      clients: deletedClients.length,
    };
  });

  res.json({ ok: true, deleted: counts });
});

export default router;
