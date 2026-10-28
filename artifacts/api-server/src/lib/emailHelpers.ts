import { sendViaGmailApi } from "./gmailApi";
import { resolveGmailForSend } from "./gmailSettings";
import type { GmailAccount, EmailTemplates, EmailTemplate } from "@workspace/db";

export type SenderSlot = 1 | 2;

export interface EmailSender {
  senderEmail: string;
  refreshToken?: string;
  serviceAccountCredentials?: {
    clientEmail: string;
    privateKey: string;
  };
  /** The authentication method that will be used */
  authMethod: "oauth" | "serviceAccount";
  /** Email signature (HTML) to append to outgoing emails */
  signature?: string;
  /** Sender name to display in email From field */
  senderName?: string;
}

/**
 * Resolve which Gmail sender to use based on slot preference and availability.
 * Slot 1 is primary, Slot 2 is secondary/optional.
 * Falls back to primary if secondary is not configured.
 * Supports both OAuth2 and Service Account (Domain-wide Delegation) authentication.
 */
export function resolveSender(
  gmailAccount1: GmailAccount | null | undefined,
  gmailAccount2: GmailAccount | null | undefined,
  preferredSlot: SenderSlot = 1,
): EmailSender | null {
  // Try preferred slot first
  if (preferredSlot === 2) {
    const secondary = resolveGmailForSend(gmailAccount2, gmailAccount1);
    if (secondary && (secondary.refreshToken || secondary.authMethod === "serviceAccount")) {
      return {
        senderEmail: secondary.senderEmail,
        refreshToken: secondary.refreshToken,
        serviceAccountCredentials: secondary.serviceAccountCredentials,
        authMethod: secondary.authMethod,
        signature: gmailAccount2?.signature,
        senderName: gmailAccount2?.senderName,
      };
    }
  }

  // Fall back to primary (or if preferred was already primary)
  const primary = resolveGmailForSend(gmailAccount1, gmailAccount1);
  if (primary && (primary.refreshToken || primary.authMethod === "serviceAccount")) {
    return {
      senderEmail: primary.senderEmail,
      refreshToken: primary.refreshToken,
      serviceAccountCredentials: primary.serviceAccountCredentials,
      authMethod: primary.authMethod,
      signature: gmailAccount1?.signature,
      senderName: gmailAccount1?.senderName,
    };
  }

  // Last resort: try secondary if primary failed and we haven't tried it
  if (preferredSlot === 1) {
    const secondary = resolveGmailForSend(gmailAccount2, gmailAccount1);
    if (secondary && (secondary.refreshToken || secondary.authMethod === "serviceAccount")) {
      return {
        senderEmail: secondary.senderEmail,
        refreshToken: secondary.refreshToken,
        serviceAccountCredentials: secondary.serviceAccountCredentials,
        authMethod: secondary.authMethod,
        signature: gmailAccount2?.signature,
        senderName: gmailAccount2?.senderName,
      };
    }
  }

  return null;
}

export interface TemplateVars {
  contact_person?: string;
  invoice_number?: string;
  quotation_number?: string;
  proposal_number?: string;
  proposal_revision?: string;
  proposal_link?: string;
  valid_until?: string;
  receipt_number?: string;
  job_order_number?: string;
  amount?: string;
  invoice_date?: string;
  due_date?: string;
  quotation_date?: string;
  receipt_date?: string;
  company_name?: string;
  client_name?: string;
  consultant_name?: string;
}

/**
 * Process email template by replacing shortcodes with actual values.
 */
export function processTemplate(template: EmailTemplate, vars: TemplateVars): EmailTemplate {
  const replacements: Record<string, string | undefined> = {
    "{{contact_person}}": vars.contact_person,
    "{{invoice_number}}": vars.invoice_number,
    "{{quotation_number}}": vars.quotation_number,
    "{{proposal_number}}": vars.proposal_number,
    "{{proposal_revision}}": vars.proposal_revision,
    "{{proposal_link}}": vars.proposal_link,
    "{{valid_until}}": vars.valid_until,
    "{{receipt_number}}": vars.receipt_number,
    "{{job_order_number}}": vars.job_order_number,
    "{{amount}}": vars.amount,
    "{{invoice_date}}": vars.invoice_date,
    "{{due_date}}": vars.due_date,
    "{{quotation_date}}": vars.quotation_date,
    "{{receipt_date}}": vars.receipt_date,
    "{{company_name}}": vars.company_name,
    "{{client_name}}": vars.client_name,
    "{{consultant_name}}": vars.consultant_name,
  };

  let subject = template.subject;
  let body = template.body;

  for (const [key, value] of Object.entries(replacements)) {
    const safeValue = value ?? "";
    subject = subject.replaceAll(key, safeValue);
    body = body.replaceAll(key, safeValue);
  }

  // Convert newlines to HTML paragraphs if body doesn't already contain HTML
  if (!body.includes("<") && !body.includes("&")) {
    body = body
      .split("\n\n")
      .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
      .join("");
  }

  return { subject, body };
}

export interface SendEmailParams {
  sender: EmailSender;
  fromName: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  htmlBody: string;
  attachments?: Array<{ filename: string; mimeType: string; content: Buffer }>;
}

/**
 * Send an email via Gmail API.
 * Automatically selects the appropriate authentication method (OAuth or Service Account).
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const senderName = params.sender.senderName?.trim() || params.fromName;
  const from = `"${senderName}" <${params.sender.senderEmail}>`;

  // Append signature to HTML body if provided
  let htmlBody = params.htmlBody;
  if (params.sender.signature?.trim()) {
    htmlBody = `${params.htmlBody}\n${params.sender.signature.trim()}`;
  }

  if (params.sender.authMethod === "serviceAccount") {
    // Use Service Account (Domain-wide Delegation)
    await sendViaGmailApi({
      from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      html: htmlBody,
      attachments: params.attachments,
      serviceAccountCredentials: params.sender.serviceAccountCredentials,
    });
  } else {
    // Use OAuth2 refresh token
    if (!params.sender.refreshToken) {
      throw new Error("No refresh token available for OAuth authentication");
    }
    await sendViaGmailApi({
      refreshToken: params.sender.refreshToken,
      from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      html: htmlBody,
      attachments: params.attachments,
    });
  }
}

/**
 * Format amount with currency.
 */
export function formatAmount(currency: string, amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return `${currency} ${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format date to readable format (DD MMM YYYY).
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${String(d).padStart(2, "0")} ${months[(m ?? 1) - 1]} ${y}`;
}
