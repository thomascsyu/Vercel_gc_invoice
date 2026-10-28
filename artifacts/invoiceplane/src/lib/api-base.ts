const RUNTIME_API_ORIGIN_STORAGE_KEY = "invoiceplane.apiOrigin";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = trimTrailingSlashes(base);
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`
    .replace(/\/+/g, "/")
    .replace(":/", "://");
}

function normalizeApiOrigin(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  // Accept either "https://api.example.com" or "https://api.example.com/api".
  try {
    const parsed = new URL(raw);
    if (parsed.pathname === "/api") parsed.pathname = "";
    return trimTrailingSlashes(parsed.toString());
  } catch {
    return trimTrailingSlashes(raw).replace(/\/api$/, "");
  }
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStoredApiOrigin(): string | null {
  if (!canUseStorage()) return null;
  try {
    return normalizeApiOrigin(window.localStorage.getItem(RUNTIME_API_ORIGIN_STORAGE_KEY));
  } catch {
    return null;
  }
}

const configuredApiOrigin = normalizeApiOrigin(import.meta.env.VITE_API_ORIGIN);

let runtimeApiOrigin = readStoredApiOrigin();

/** Optional API origin configured at build time for split frontend/backend deployments. */
const API_ORIGIN = configuredApiOrigin;

export function getApiOrigin(): string | null {
  if (API_ORIGIN) return API_ORIGIN;
  // Default to same-origin whenever we're in a browser. This app is commonly deployed
  // as a single-origin SPA + API (e.g. https://example.com + https://example.com/api).
  //
  // Using a persisted runtime origin from localStorage is fragile: if it points at an
  // old/stale host, every auth-gated route will redirect to /login because /api/me fails.
  if (typeof window !== "undefined") {
    const current = normalizeApiOrigin(window.location.origin);
    if (!current) return null;

    // If we previously stored a runtime API origin and it's not same-origin anymore,
    // clear it so users don't get stuck in an auth redirect loop.
    if (runtimeApiOrigin && runtimeApiOrigin !== current) {
      try {
        window.localStorage.removeItem(RUNTIME_API_ORIGIN_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      runtimeApiOrigin = null;
    }

    // Always prefer same-origin unless explicitly configured at build-time.
    // This keeps auth cookies and CORS simple and prevents stale overrides.
    return current;
  }
  if (runtimeApiOrigin) return runtimeApiOrigin;
  return null;
}

function getApiBase(): string {
  return joinUrl(getApiOrigin() ?? (import.meta.env.BASE_URL || "/"), "api");
}

export function apiUrl(path: string): string {
  return joinUrl(getApiBase(), path);
}

/**
 * Resolves a stored public asset path (e.g. `/api/storage/public-objects/...`) for use in
 * `<img src>` when the SPA origin differs from the API origin (`VITE_API_ORIGIN` / runtime).
 * Absolute `http(s)` URLs are returned unchanged.
 */
export function publicMediaSrcUrl(pathOrUrl: string | undefined | null): string {
  if (!pathOrUrl?.trim()) return "";
  const v = pathOrUrl.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/api/")) {
    return apiUrl(v.slice("/api/".length));
  }
  return v;
}

export { publicMediaSrcUrl as resolvePublicAssetUrl };
