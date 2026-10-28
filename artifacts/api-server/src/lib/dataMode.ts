import { getCompanySettings } from "./companySettingsCache";

/** Live production data vs empty company-wide test sandbox. */
export type DataMode = "live" | "test";

/**
 * Resolves the active data mode from company settings.
 * When test mode is enabled, all scoped modules (clients, invoices,
 * quotations, payments, receipts, job orders) read/write only `test` rows.
 */
export async function currentDataMode(): Promise<DataMode> {
  const settings = await getCompanySettings();
  return settings?.testModeEnabled ? "test" : "live";
}

/** Always use live for background jobs that must not touch the sandbox. */
export const LIVE_DATA_MODE: DataMode = "live";
