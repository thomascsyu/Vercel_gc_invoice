import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { type AuthedRequest } from "./auth/requireAuth";
import {
  createPublicRateLimitGate,
  shouldSkipSharedApiRateLimit,
} from "./rateLimitPaths";

export {
  isPublicRateLimitedPath,
  shouldSkipSharedApiRateLimit,
} from "./rateLimitPaths";

/**
 * Baseline abuse guard for the whole authenticated API. Generous on purpose —
 * this isn't meant to throttle normal usage, just stop unbounded scripted
 * abuse. app.ts sets a fixed `trust proxy` hop count (not `true`) so this
 * keys on the real client IP behind a reverse proxy rather than one an
 * attacker can spoof via X-Forwarded-For.
 *
 * The PDF layout preview and get/save endpoints, and the client-import job
 * status poll, are excluded here. Each has its own per-user budget below so
 * a burst of those calls doesn't compete with the rest of that user's (or a
 * shared office IP's) unrelated traffic for this one shared bucket.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  skip: (req) => shouldSkipSharedApiRateLimit(req.path),
});

/**
 * Dedicated limit for the live PDF layout preview, keyed by user rather than
 * IP: it's authenticated (mounted after `requireAuth`), and keying by user
 * keeps one office's shared IP from throttling everyone else editing layouts.
 * The client debounces edits ~600ms apart, so this is sized for a human
 * actively dragging/nudging/clicking Refresh, not scripted abuse.
 */
export const previewRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  keyGenerator: (req) => (req as AuthedRequest).userId ?? req.ip ?? "unknown",
});

/**
 * Dedicated limit for reading/saving the persisted document layout, keyed by
 * user for the same reason as `previewRateLimiter` above. A user iterating on
 * a layout (drag a section, hit Save, drag again) shouldn't have their Save
 * fail because unrelated browsing elsewhere in the app — on this IP, by this
 * user or an office-mate — already spent the shared `apiRateLimiter` budget.
 * These are cheap DB reads/writes, not PDF renders, so the budget is generous.
 */
export const layoutRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  keyGenerator: (req) => (req as AuthedRequest).userId ?? req.ip ?? "unknown",
});

/**
 * Tighter limit for the OAuth login/refresh/logout flow — the classic
 * brute-force/credential-stuffing target, and the one place a failed
 * request is cheap for an attacker to retry at volume.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

/**
 * Tighter limit for unauthenticated public endpoints (share-link PDFs,
 * proposal client-portal question/confirm/revise/download) — these have no
 * session to rate-limit by user, and abusing them burns Gmail send quota or
 * fills the questions table for free.
 */
export const publicRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

/**
 * Run `publicRateLimiter` only for unauthenticated endpoints.
 * See `createPublicRateLimitGate` — do not mount `publicRateLimiter` itself.
 */
export const publicRateLimitGate = createPublicRateLimitGate(publicRateLimiter);

/**
 * Client import status is polled every 400ms while a CSV import runs.
 * Keyed by user so one office IP isn't shared, and sized for that poll
 * (150/min) with a little headroom. The handler is a map lookup, not a PDF
 * render or a write.
 */
export const clientImportJobRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  keyGenerator: (req) => {
    const userId = (req as AuthedRequest).userId;
    if (userId) return userId;
    return ipKeyGenerator(req.ip ?? "unknown");
  },
});
