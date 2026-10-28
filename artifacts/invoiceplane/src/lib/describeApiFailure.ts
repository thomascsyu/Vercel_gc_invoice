/** User-facing message for failed API / network errors. */
export function describeApiFailure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg === "Failed to fetch" ||
    msg === "Load failed" ||
    msg === "NetworkError when attempting to fetch resource."
  ) {
    return `${msg} — Is the API running and reachable? For local dev, start the API (e.g. PORT=8080) and ensure Vite proxies to it, or set VITE_API_ORIGIN.`;
  }
  return msg;
}
