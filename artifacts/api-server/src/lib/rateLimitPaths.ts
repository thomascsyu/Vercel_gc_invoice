import type { RequestHandler } from "express";
import type { RateLimitRequestHandler } from "express-rate-limit";

/** Path of the interactive document-layout preview endpoint. */
export const PREVIEW_PATH = "/pdf-document-layouts/preview";

/** Path of the persisted document-layout get/save endpoint. */
export const LAYOUT_PATH = "/pdf-document-layouts";

/**
 * Client CSV import polls this every 400ms for the life of the job (up to
 * ~30 minutes). It must not spend the shared API budget — a single import
 * would otherwise return 429 on this status check and on the Clients list.
 */
const CLIENT_IMPORT_JOB_STATUS_PATH = /^\/clients\/import\/jobs\/[^/]+$/;

/**
 * Unauthenticated routes that should consume the public rate limiter.
 *
 * The public routers are mounted with `router.use` *before* the authenticated
 * Clients / Invoices / Quotations routers. A bare `router.use(publicRateLimiter)`
 * on those routers therefore counts every later request — including
 * `GET /clients` — against the tight public budget, which is what surfaces as
 * "HTTP 429 : Too many requests" on the Clients page. Match only the routes
 * that are actually public.
 */
const PUBLIC_RATE_LIMITED_PATHS: readonly RegExp[] = [
  /^\/clients\/import\/template$/,
  /^\/invoices\/import\/template$/,
  /^\/quotations\/import\/template$/,
  /^\/payments\/import\/template$/,
  /^\/job-orders\/import\/template$/,
  /^\/invoices\/[^/]+\/pdf\/public$/,
  /^\/quotations\/[^/]+\/pdf\/public$/,
  /^\/proposals\/[^/]+\/public$/,
  /^\/proposals\/[^/]+\/pdf\/public$/,
  /^\/proposals\/[^/]+\/public\/download$/,
  /^\/proposals\/[^/]+\/public\/question$/,
  /^\/proposals\/[^/]+\/public\/confirm$/,
  /^\/proposals\/[^/]+\/public\/revise$/,
];

function pathnameOf(path: string): string {
  return path.split("?")[0] ?? path;
}

/** True when this request is one of the unauthenticated public endpoints. */
export function isPublicRateLimitedPath(path: string): boolean {
  const pathname = pathnameOf(path);
  return PUBLIC_RATE_LIMITED_PATHS.some((pattern) => pattern.test(pathname));
}

/**
 * Paths omitted from the shared API limiter because they have their own budget.
 * `req.path` is relative to the `/api` mount.
 */
export function shouldSkipSharedApiRateLimit(path: string): boolean {
  const pathname = pathnameOf(path);
  return (
    pathname === PREVIEW_PATH ||
    pathname === LAYOUT_PATH ||
    CLIENT_IMPORT_JOB_STATUS_PATH.test(pathname)
  );
}

/**
 * Run the public limiter only for unauthenticated endpoints.
 *
 * Mount the result with `router.use(...)` — do not mount the limiter itself.
 * The public routers sit in front of the staff API, and the limiter middleware
 * counts every request that reaches it.
 */
export function createPublicRateLimitGate(limiter: RateLimitRequestHandler): RequestHandler {
  return (req, res, next) => {
    if (!isPublicRateLimitedPath(req.path)) {
      next();
      return;
    }
    limiter(req, res, next);
  };
}
