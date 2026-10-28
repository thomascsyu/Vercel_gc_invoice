import type { InvoiceLineItem } from "@workspace/api-client-react";
export {
  invoiceDescriptionDisplay,
  invoiceDescriptionToStored,
} from "@workspace/invoice-utils";
import { invoiceDescriptionDisplay } from "@workspace/invoice-utils";

/** Quotation description field (legacy rows may only have name). */
export function quotationDescriptionDisplay(
  item: Pick<InvoiceLineItem, "name" | "description">,
): string {
  const desc = (item.description ?? "").trim().replace(/\r\n/g, "\n");
  if (desc) return desc;
  return (item.name ?? "").trim();
}

export function quotationItemToStored(
  description: string,
  details: string,
): Pick<InvoiceLineItem, "name" | "description" | "details"> {
  const descNorm = description.replace(/\r\n/g, "\n").trim();
  const detailsNorm = details.replace(/\r\n/g, "\n").trim();
  const firstLine = descNorm.split("\n")[0]?.trim() ?? "";
  return {
    name: firstLine || descNorm || "—",
    description: descNorm,
    details: detailsNorm,
  };
}

export function lineItemHasContent(item: InvoiceLineItem): boolean {
  return !!(item.name?.trim() || item.description?.trim() || item.details?.trim());
}

export function lineItemPreviewLabel(item: InvoiceLineItem): string {
  const text = invoiceDescriptionDisplay(item) || quotationDescriptionDisplay(item);
  if (text) return text.split("\n")[0];
  return item.details?.trim().split("\n")[0] || "—";
}
