import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare for share-link tokens. Length mismatches (including
 * missing stored/provided values) return false without throwing.
 */
export function shareTokenMatches(stored: string | null | undefined, provided: string | null | undefined): boolean {
  if (!stored || !provided) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** SHARE_TOKEN_EXPIRY_DAYS with a sane default when the env value is missing or NaN. */
export function parseShareTokenExpiryDays(raw: string | undefined, fallback = 30): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), 3650);
}
