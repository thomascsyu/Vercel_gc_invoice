/** Stored as 1–2 (100%–200%); invalid values default to 1. */
export function logoScaleFactor(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(1, n));
}
