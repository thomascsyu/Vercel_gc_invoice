import { companySettingsTable, consultantsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { invalidateCompanySettingsCache } from "../../lib/companySettingsCache";
import { ObjectStorageService } from "../../lib/objectStorage";

export async function seedConsultants() {
  const existing = await db.select({ id: consultantsTable.id }).from(consultantsTable);
  if (existing.length > 0) return;
  await db.insert(consultantsTable).values([
    { shortCode: "TY", name: "T. Yuen" },
    { shortCode: "PL", name: "P. Lam" },
    { shortCode: "PW", name: "P. Wong" },
  ]);
}

export const DEFAULT_EMAIL_TEMPLATES = {
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

export async function ensureCompanySettings() {
  const existing = await db.select().from(companySettingsTable);
  let row = existing[0];
  if (!row) {
    [row] = await db
      .insert(companySettingsTable)
      .values({
        companyName: "My Company",
        defaultCurrency: "HKD",
        emailTemplates: DEFAULT_EMAIL_TEMPLATES,
      })
      .returning();
    invalidateCompanySettingsCache();
    return row;
  }
  // Backfill: migrate legacy gmail fields and seed default email templates
  const patch: Partial<typeof companySettingsTable.$inferInsert> = {};
  if (!row.gmailAccount1 && (row.gmailSenderEmail || row.gmailServiceAccount)) {
    patch.gmailAccount1 = {
      senderEmail: row.gmailSenderEmail ?? "",
      refreshToken: row.gmailServiceAccount ?? "",
    };
  }
  if (!row.emailTemplates) {
    patch.emailTemplates = DEFAULT_EMAIL_TEMPLATES;
  } else {
    const et = row.emailTemplates as typeof DEFAULT_EMAIL_TEMPLATES;
    if (!et.jobOrder?.subject?.trim() || !et.jobOrder?.body?.trim()) {
      patch.emailTemplates = { ...et, jobOrder: DEFAULT_EMAIL_TEMPLATES.jobOrder };
    }
    if (!et.proposal?.subject?.trim() || !et.proposal?.body?.trim()) {
      patch.emailTemplates = {
        ...(patch.emailTemplates as typeof DEFAULT_EMAIL_TEMPLATES | undefined) ?? et,
        proposal: DEFAULT_EMAIL_TEMPLATES.proposal,
      };
    }
  }
  /**
   * One-time legacy migrate: copy signature → chop, then clear signature so a later
   * Branding "Remove" (chop_url=null) cannot be undone by rehydration from signature.
   */
  if (!(row.chopUrl?.trim()) && row.signatureImageUrl?.trim()) {
    patch.chopUrl = row.signatureImageUrl.trim();
    if (row.signatureImageScale != null) {
      patch.chopScale = row.signatureImageScale;
    }
    patch.signatureImageUrl = null;
  }
  if (Object.keys(patch).length > 0) {
    [row] = await db
      .update(companySettingsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(companySettingsTable.id, row.id))
      .returning();
    invalidateCompanySettingsCache();
  }
  return row;
}

/** Shared object-storage client for branding uploads/deletes (uploads + company-settings routes). */
export const objectStorageService = new ObjectStorageService();

/** Shared line-item schema used by both job orders and recurring invoices. */
export const JobOrderItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  details: z.string().optional(),
  quantity: z.number(),
  price: z.number(),
  taxRate: z.number().optional(),
});
