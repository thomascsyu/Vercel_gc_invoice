import { ZodError } from "zod";

/**
 * Detect Zod validation errors from either the root `zod` package or `zod/v4`
 * subpath (some routes import one or the other).
 */
export function isZodError(err: unknown): err is ZodError {
  if (err instanceof ZodError) return true;
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError";
}
