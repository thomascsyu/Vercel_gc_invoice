import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets/tokens (share tokens, etc).
 * Plain `!==`/`===` leaks timing information proportional to how many
 * leading bytes match; use this instead anywhere a value is compared
 * against a caller-supplied token.
 */
export function timingSafeEqualString(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
