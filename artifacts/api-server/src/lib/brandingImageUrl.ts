/** Stored company branding images always use this URL prefix (served via public object storage). */
export const BRANDING_STORAGE_URL_PREFIX = "/api/storage/public-objects/";

/** Relative path inside the public object bucket (e.g. `branding/company-logo/uuid.png`). */
export function publicObjectRelPathFromStoredUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim().split("?")[0];
  /** Accept relative app paths and absolute URLs that embed our public-objects route. */
  const prefixAt = trimmed.indexOf(BRANDING_STORAGE_URL_PREFIX);
  const rel =
    prefixAt >= 0
      ? trimmed.slice(prefixAt + BRANDING_STORAGE_URL_PREFIX.length)
      : trimmed.startsWith(BRANDING_STORAGE_URL_PREFIX)
        ? trimmed.slice(BRANDING_STORAGE_URL_PREFIX.length)
        : null;
  if (!rel || rel.includes("..")) return null;
  return rel;
}

/** Only delete files we own (uploaded branding / legacy logo folder). */
export function isManagedBrandingStoragePath(rel: string): boolean {
  return rel.startsWith("branding/") || rel.startsWith("logos/");
}
