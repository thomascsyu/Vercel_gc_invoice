import { isUniqueViolation } from "./pgErrors";

const MAX_ATTEMPTS = 5;

/**
 * Runs `attempt()` up to 5 times, retrying only on a Postgres unique-constraint
 * violation. Used around document-number generation + insert (invoice/quotation/
 * job-order numbers are computed as "count of existing rows + 1", so two
 * near-simultaneous requests can compute the same number — the unique
 * constraint turns that into a caught, retried conflict instead of a silently
 * duplicated document number).
 */
export async function withUniqueRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
