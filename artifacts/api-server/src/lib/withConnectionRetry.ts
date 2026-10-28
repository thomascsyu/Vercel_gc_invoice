import { isTransientConnectionError } from "./pgErrors";

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Runs `attempt()` up to 3 times, retrying only on transient Postgres/network
 * connection errors (e.g. SQLSTATE 57P01 after a DB restart or idle kill).
 */
export async function withConnectionRetry<T>(
  attempt: () => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (!isTransientConnectionError(err) || i === maxAttempts - 1) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
