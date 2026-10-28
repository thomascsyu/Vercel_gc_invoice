import type { CorsOptions } from "cors";
import { logger } from "./logger";

function normalizeOriginInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Builds the set of browser origins allowed to call this API with credentials.
 * Sources: PUBLIC_APP_URL, plus comma-separated CORS_ALLOWED_ORIGINS.
 */
export function loadAllowedCorsOrigins(): Set<string> {
  const set = new Set<string>();
  const pub = process.env["PUBLIC_APP_URL"]?.trim();
  if (pub) {
    const o = normalizeOriginInput(pub);
    if (o) set.add(o);
  }
  // On Vercel the SPA and API share an origin, but browsers still send Origin
  // on POSTs. Allow this deployment's own URLs (preview, branch, production)
  // so preview deploys work without editing CORS_ALLOWED_ORIGINS each time.
  if (process.env["VERCEL"]) {
    for (const name of ["VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) {
      const host = process.env[name]?.trim();
      const o = host ? normalizeOriginInput(host) : null;
      if (o) set.add(o);
    }
  }
  const extra = process.env["CORS_ALLOWED_ORIGINS"] ?? "";
  for (const part of extra.split(",")) {
    const o = normalizeOriginInput(part);
    if (o) set.add(o);
  }
  return set;
}

let loggedPermissiveWarning = false;

/**
 * Decide whether to enforce the origin allowlist for this credentialed API.
 *
 * - `CORS_RESTRICT=true`  → always strict (enforce allowlist).
 * - `CORS_RESTRICT=false` → always permissive (reflect any origin).
 * - unset                 → strict whenever an allowlist is configured
 *                            (PUBLIC_APP_URL / CORS_ALLOWED_ORIGINS), else permissive.
 *
 * Reflecting arbitrary origins while sending credentials is unsafe, so the
 * secure default is to enforce the allowlist as soon as one exists.
 */
function shouldRestrictCors(allowlistSize: number): boolean {
  const raw = process.env["CORS_RESTRICT"];
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (process.env["NODE_ENV"] === "production") {
    return true;
  }
  return allowlistSize > 0;
}

/**
 * CORS for a credentialed API. Defaults to enforcing the configured allowlist;
 * set CORS_RESTRICT=false to opt back into the legacy permissive behaviour.
 */
export function createCorsOptions(): CorsOptions {
  const allowed = loadAllowedCorsOrigins();
  const restrictCors = shouldRestrictCors(allowed.size);

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (restrictCors) {
        if (allowed.has(origin)) {
          callback(null, true);
          return;
        }
        logger.warn({ origin, allowed: [...allowed] }, "CORS request blocked");
        callback(null, false);
        return;
      }
      // Permissive mode (explicitly opted in, or no allowlist configured).
      if (process.env["NODE_ENV"] === "production" && !loggedPermissiveWarning) {
        loggedPermissiveWarning = true;
        logger.warn(
          { origin },
          "CORS: accepting all origins. Set PUBLIC_APP_URL/CORS_ALLOWED_ORIGINS (and leave CORS_RESTRICT unset) to enable strict mode."
        );
      }
      callback(null, true);
    },
  };
}
