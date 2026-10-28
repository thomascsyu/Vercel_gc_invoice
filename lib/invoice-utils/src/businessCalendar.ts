/** Default business calendar when `TZ` is unset (HK-centric app). */
export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Hong_Kong";

/** IANA zone for cron and “today”. `TZ` overrides the Hong Kong default. */
export function businessTimeZone(): string {
  if (typeof process !== "undefined" && process.env?.TZ?.trim()) {
    return process.env.TZ.trim();
  }
  return DEFAULT_BUSINESS_TIMEZONE;
}

/** Today's date in the business calendar as `YYYY-MM-DD` (matches server cron / overdue filters). */
export function businessCalendarToday(timeZone = businessTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}
