/** Max characters rendered for bill-to vs bank-detail strings on invoices (ellipsis when longer). */
export const PDF_MAX_BILL_TO_FIELD_CHARS = 220;
export const PDF_MAX_BANK_FIELD_CHARS = 300;

/** Truncate for PDF width; keeps leading text and avoids runaway layouts. */
export function truncatePdfFieldText(value: string, maxChars: number): string {
  const t = value.trim();
  if (t.length <= maxChars) return t;
  if (maxChars < 4) return t.slice(0, maxChars);
  return `${t.slice(0, maxChars - 3)}…`;
}
