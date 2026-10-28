import type { companySettingsTable } from "@workspace/db";

type Row = typeof companySettingsTable.$inferSelect;

function nonEmptyUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t : null;
}

/**
 * Resolved chop image URL (`chop_url`, with read-only fallback to legacy
 * `signature_image_url` when chop was never migrated).
 *
 * Branding "Remove" dual-writes both columns to null so PDFs/UI do not keep a
 * stale seal after clear.
 */
export function companyChopStoredUrl(
  settings: Pick<Row, "chopUrl" | "signatureImageUrl"> | null | undefined,
): string | null {
  return nonEmptyUrl(settings?.chopUrl) ?? nonEmptyUrl(settings?.signatureImageUrl);
}

/** Scale factor raw columns for PDF embedding (`chop_scale` preferred). */
export function companyChopScaleColumns(
  settings: Pick<Row, "chopScale" | "signatureImageScale"> | null | undefined,
): Row["chopScale"] | Row["signatureImageScale"] | null | undefined {
  return settings?.chopScale ?? settings?.signatureImageScale;
}
