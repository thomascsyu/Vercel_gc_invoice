/**
 * Drizzle wraps the original `pg` error in `DrizzleQueryError.cause`,
 * so the error chain is walked instead of checking only the top level.
 */
function hasErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Detects a PostgreSQL unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return hasErrorCode(error, "23505");
}

/** Detects a PostgreSQL foreign-key-constraint violation (SQLSTATE 23503). */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasErrorCode(error, "23503");
}

const TRANSIENT_CONNECTION_CODES = new Set([
  "57P01", // admin_shutdown — "terminating connection due to administrator command"
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08006", // connection_failure
  "08003", // connection_does_not_exist
  "08000", // connection_exception
]);

function getNestedErrorMessage(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
    current = (current as { cause?: unknown }).cause;
  }
  return error instanceof Error ? error.message : "";
}

/** Detects Postgres/admin or network errors that are safe to retry once. */
export function isTransientConnectionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_CONNECTION_CODES.has(code)) {
      return true;
    }
    const errno = (current as { errno?: unknown }).errno;
    if (errno === "ECONNRESET" || errno === "ECONNREFUSED" || errno === "EPIPE") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  const message = getNestedErrorMessage(error).toLowerCase();
  return (
    message.includes("terminating connection due to administrator command") ||
    message.includes("connection terminated unexpectedly") ||
    message.includes("server closed the connection unexpectedly")
  );
}
