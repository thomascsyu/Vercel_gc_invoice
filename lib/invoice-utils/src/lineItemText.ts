/** Shared invoice line-item text helpers (form submit and API patch comparison). */

export type InvoiceLineItemLike = {
  name: string;
  description?: string;
  details?: string;
  quantity: number;
  price: number;
  taxRate?: number;
};

export type LineItemTextOptions = {
  /** When false, preserve leading/trailing spaces while the user is typing (invoice draft form). */
  trim?: boolean;
};

/** Merge stored name + description for invoice UI (matches CSV import/export). */
export function invoiceDescriptionDisplay(
  item: Pick<InvoiceLineItemLike, "name" | "description">,
  options?: LineItemTextOptions,
): string {
  const trim = options?.trim !== false;
  const trimEdge = (s: string) => (trim ? s.trim() : s);
  const name = trimEdge(item.name ?? "");
  const desc = trimEdge(item.description ?? "").replace(/\r\n/g, "\n");
  if (!name && !desc) return "";
  if (!desc || desc === name) return name;
  if (!name) return desc;
  return `${name}\n${desc}`;
}

/** Split invoice description input into name + description; clears details. */
export function invoiceDescriptionToStored(
  text: string,
  options?: LineItemTextOptions,
): Pick<InvoiceLineItemLike, "name" | "description" | "details"> {
  const trim = options?.trim !== false;
  let normalized = text.replace(/\r\n/g, "\n");
  if (trim) normalized = normalized.trim();
  if (!normalized.trim()) return { name: "", description: "", details: "" };
  const lines = normalized.split("\n");
  const first = trim ? lines[0]!.trim() : lines[0]!;
  if (lines.length === 1) return { name: first, description: "", details: "" };
  return { name: first, description: lines.slice(1).join("\n"), details: "" };
}

/** Same normalization the invoice form applies on submit (description round-trip, taxRate 0). */
export function normalizeInvoiceLineItemForCompare(item: InvoiceLineItemLike): InvoiceLineItemLike {
  const stored = invoiceDescriptionToStored(invoiceDescriptionDisplay(item));
  return {
    name: stored.name ?? "",
    description: stored.description ?? "",
    details: stored.details ?? "",
    quantity: Number(item.quantity ?? 0),
    price: Number(item.price ?? 0),
    taxRate: 0,
  };
}
