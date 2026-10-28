import { companySettingsTable, db } from "@workspace/db";
import { invalidateImageBufferCache } from "./fetchImageBuffer";

const CACHE_TTL_MS = 60_000;

let cachedSettings: typeof companySettingsTable.$inferSelect | undefined;
let cachedAt = 0;
let cacheLoaded = false;

export type GetCompanySettingsOptions = {
  /** Bypass in-process TTL so PDF branding matches the latest Branding & images save. */
  fresh?: boolean;
};

export async function getCompanySettings(
  opts?: GetCompanySettingsOptions,
): Promise<typeof companySettingsTable.$inferSelect | undefined> {
  const now = Date.now();
  if (!opts?.fresh && cacheLoaded && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  const [row] = await db.select().from(companySettingsTable);
  cachedSettings = row;
  cacheLoaded = true;
  cachedAt = now;
  return cachedSettings;
}

export function invalidateCompanySettingsCache(): void {
  cachedSettings = undefined;
  cacheLoaded = false;
  cachedAt = 0;
  invalidateImageBufferCache();
}
