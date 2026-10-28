/**
 * Fetch an image URL and return its bytes as a Buffer.
 *
 * Only app-stored public object paths are allowed (SSRF-safe). External http(s)
 * URLs and arbitrary relative paths are rejected.
 */
import { publicObjectRelPathFromStoredUrl } from "./brandingImageUrl";
import { readBrandingAssetBackup } from "./brandingAssetBackup";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

const CACHE_TTL_MS = 10 * 60 * 1000;
/**
 * After serving last-known-good bytes, keep them in the hot cache briefly so
 * the next PDF does not wait out another timed-out fetch.
 */
const STALE_CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 32;
/** Avoid hanging invoice/quotation PDF generation when object storage is slow. */
const FETCH_TIMEOUT_MS = 8_000;
/** One retry absorbs a single transient network/storage blip before we give up. */
const MAX_ATTEMPTS = 2;
/** Skip the retry when the first attempt already burned most of a timeout window. */
const RETRY_BUDGET_MS = 1_000;
const FETCH_TIMEOUT_MESSAGE = "Branding image fetch timed out";

type CacheEntry = { buf: Buffer; expiresAt: number };

const imageCache = new Map<string, CacheEntry>();
/**
 * Last successfully fetched bytes per path, kept without a TTL. A logo/header
 * banner that rendered fine a moment ago shouldn't vanish from the next PDF
 * just because object storage hiccuped once — fall back to these bytes rather
 * than dropping the image when a (retried) fetch still fails.
 *
 * Intentionally not cleared by `invalidateImageBufferCache`. Branding re-uploads
 * use a new uuid path, so the new URL has no last-known-good entry. Clearing
 * this on every settings save would drop the logo from the next PDF if storage
 * is still flaky after a non-file change (scale, etc.).
 */
const lastGoodCache = new Map<string, Buffer>();

export function invalidateImageBufferCache(): void {
  imageCache.clear();
}

function getCached(rel: string): Buffer | null {
  const entry = imageCache.get(rel);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    imageCache.delete(rel);
    return null;
  }
  return entry.buf;
}

function evictOldestIfNeeded(map: Map<string, unknown>, key: string): void {
  if (map.size >= CACHE_MAX_ENTRIES && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

function setCached(rel: string, buf: Buffer, ttlMs = CACHE_TTL_MS): void {
  evictOldestIfNeeded(imageCache, rel);
  imageCache.set(rel, { buf, expiresAt: Date.now() + ttlMs });

  evictOldestIfNeeded(lastGoodCache, rel);
  lastGoodCache.set(rel, buf);
}

function rememberStale(rel: string, buf: Buffer): void {
  evictOldestIfNeeded(imageCache, rel);
  imageCache.set(rel, { buf, expiresAt: Date.now() + STALE_CACHE_TTL_MS });
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message === FETCH_TIMEOUT_MESSAGE;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(FETCH_TIMEOUT_MESSAGE)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Single fetch attempt. Returns null only when the object is confirmed absent (do not retry that). */
async function attemptFetch(rel: string): Promise<Buffer | null> {
  const source = await withTimeout(objectStorageService.searchPublicObject(rel), FETCH_TIMEOUT_MS);
  if (!source) return null;
  const response = await withTimeout(objectStorageService.downloadPublicObject(source), FETCH_TIMEOUT_MS);
  const arrayBuf = await withTimeout(response.arrayBuffer(), FETCH_TIMEOUT_MS);
  return Buffer.from(arrayBuf);
}

async function fallbackLastGood(rel: string, reason: string): Promise<Buffer | null> {
  const lastGood = lastGoodCache.get(rel);
  if (lastGood) {
    rememberStale(rel, lastGood);
    logger.warn({ rel, reason }, "Branding image fetch failed; using last-known-good bytes");
    return lastGood;
  }
  // In-memory last-good is empty right after a restart — exactly when object
  // storage is most likely to have lost an ephemeral-disk file. Postgres is
  // durable across restarts, so check there before giving up.
  const backup = await readBrandingAssetBackup(rel);
  if (backup) {
    setCached(rel, backup.data);
    logger.warn({ rel, reason }, "Branding image fetch failed; using durable DB backup bytes");
    return backup.data;
  }
  logger.warn({ rel, reason }, "Branding image not available; PDF will render without it");
  return null;
}

export async function fetchImageBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  const rel = publicObjectRelPathFromStoredUrl(url);
  if (!rel) return null;

  const cached = getCached(rel);
  if (cached) return cached;

  const started = Date.now();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const buf = await attemptFetch(rel);
      if (buf) {
        setCached(rel, buf);
        return buf;
      }
      // Object confirmed absent from every configured search path (not a transient error).
      return await fallbackLastGood(rel, "object not found at any configured storage path");
    } catch (err) {
      lastErr = err;
      const elapsed = Date.now() - started;
      const canRetry =
        attempt < MAX_ATTEMPTS &&
        !isTimeoutError(err) &&
        elapsed < RETRY_BUDGET_MS &&
        !lastGoodCache.has(rel);
      if (!canRetry) break;
    }
  }

  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return await fallbackLastGood(rel, reason);
}
