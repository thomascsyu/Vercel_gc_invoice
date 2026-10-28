import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request forgery guard for the cookie-authenticated API.
 *
 * The session cookie is `SameSite=None` in production (needed for the SPA's
 * cross-origin API calls), which means browsers will still attach it to a
 * plain cross-site form POST. A hostile page can't be stopped from sending
 * that request, but it *can't* attach a custom header to a simple form
 * submission — only script running same-origin (or an explicitly CORS-allowed
 * origin) can do that. Requiring this header on every mutating request means
 * a forged form POST arrives with no header, is rejected here, and never
 * reaches business logic. Legitimate calls (the SPA's fetch wrapper) always
 * set it — see custom-fetch.ts and modulesApi.ts.
 */
export const CSRF_HEADER = "x-requested-with";
const CSRF_HEADER_VALUE = "XMLHttpRequest";

export function requireCsrfHeader(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  // API keys are not browser cookies and therefore are not vulnerable to CSRF.
  // Authentication middleware still validates the key before any route executes.
  if (req.get("x-api-key")?.trim()) {
    next();
    return;
  }
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    res.status(403).json({ error: "Missing or invalid CSRF header" });
    return;
  }
  next();
}
