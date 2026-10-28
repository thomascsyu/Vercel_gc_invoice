export type QuotationSearchMode = "quotation" | "amount" | "client";

export type ParsedQuotationSearchQuery = {
  mode: QuotationSearchMode;
  term: string;
  amount?: number;
};

/** Parse a dollar-prefixed amount string; returns null when invalid. */
export function parseSearchAmount(raw: string): number | null {
  const stripped = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!stripped) return null;
  const value = Number.parseFloat(stripped);
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Parse a unified quotation list search query.
 * - Q + digits (e.g. Q260530) → quotation number (partial match)
 * - $… → exact total amount
 * - otherwise → client name or client code
 */
export function parseQuotationSearchQuery(raw: string): ParsedQuotationSearchQuery | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\$/i.test(trimmed)) {
    const amount = parseSearchAmount(trimmed);
    if (amount === null) return { mode: "amount", term: trimmed, amount: undefined };
    return { mode: "amount", term: trimmed, amount };
  }

  if (/^q\d+$/i.test(trimmed)) {
    return { mode: "quotation", term: trimmed };
  }

  return { mode: "client", term: trimmed };
}
