/** Merge overflow structured address rows so the PDF shows at most `maxLines` labeled rows. */
export function consolidateClientAddressParts(parts: string[], maxLines: number): string[] {
  const cleaned = parts.map((p) => p.trim()).filter(Boolean);
  if (cleaned.length <= maxLines) return cleaned;
  const head = cleaned.slice(0, maxLines - 1);
  const tail = cleaned.slice(maxLines - 1).join(", ");
  return [...head, tail];
}

type ClientStructuredAddressFields = {
  address?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressLine3?: string | null;
  addressLine4?: string | null;
  country?: string | null;
};

/**
 * Exactly four address lines for bill-to blocks, aligned to structured client fields
 * (same rules as job orders: legacy `address` maps to line 1; if line 4 is empty, use `country`).
 */
export function clientStructuredAddressFourLines(client: ClientStructuredAddressFields | null | undefined): string[] {
  const line1 = (client?.addressLine1 ?? client?.address ?? "").trim();
  const line2 = (client?.addressLine2 ?? "").trim();
  const line3 = (client?.addressLine3 ?? "").trim();
  let line4 = (client?.addressLine4 ?? "").trim();
  if (!line4) line4 = (client?.country ?? "").trim();
  return [line1, line2, line3, line4];
}
