import type { LineItem as DbLineItem } from "@workspace/db";

/** Full invoice line description for PDF/CSV (name + extra lines; no details). */
export function invoiceLineDescriptionText(item: DbLineItem): string {
  const name = (item.name ?? "").trim();
  const desc = (item.description ?? "").trim().replace(/\r\n/g, "\n");
  if (!name && !desc) return "—";
  if (!desc || desc === name) return name || "—";
  if (!name) return desc;
  return `${name}\n${desc}`;
}

/** Quotation PDF: description body (legacy rows may only have name). */
export function quotationLineDescriptionText(item: DbLineItem): string {
  const desc = (item.description ?? "").trim().replace(/\r\n/g, "\n");
  if (desc) return desc;
  const name = (item.name ?? "").trim();
  return name || "—";
}

/** Quotation PDF: details / fine print only. */
export function quotationLineDetailsText(item: DbLineItem): string | null {
  const details = (item.details ?? "").trim().replace(/\r\n/g, "\n");
  return details || null;
}
