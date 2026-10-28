/**
 * Single-flight access-token refresh for cookie sessions.
 *
 * Access cookies last 15 minutes; refresh cookies last 7 days. When a request
 * returns 401, refresh once (shared across in-flight callers so rotation is
 * not raced) and retry the original call.
 */

const CSRF_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

let refreshInFlight: Promise<boolean> | null = null;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.toString();
  return (input as Request).url;
}

function refreshUrlFromRequest(input: RequestInfo | URL): string {
  const raw = requestUrl(input);
  try {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost";
    const u = new URL(raw, origin);
    return `${u.origin}/api/auth/refresh`;
  } catch {
    return "/api/auth/refresh";
  }
}

export async function refreshAccessSession(refreshUrl = "/api/auth/refresh"): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const res = await fetch(refreshUrl, {
      method: "POST",
      credentials: "include",
      headers: CSRF_HEADERS,
    });
    return res.ok;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Fetch that retries once after a successful session refresh on 401. */
export async function fetchWithSessionRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  if (init?.signal?.aborted) return res;
  const url = requestUrl(input);
  if (url.includes("/auth/refresh")) return res;
  const refreshed = await refreshAccessSession(refreshUrlFromRequest(input));
  if (!refreshed) return res;
  return fetch(input, init);
}
