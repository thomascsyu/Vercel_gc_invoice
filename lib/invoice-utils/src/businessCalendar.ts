/** Default business calendar when `TZ` is unset (HK-centric app). */
export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Hong_Kong";

/**
 * IANA zone for cron and “today”. `BUSINESS_TIME_ZONE`, then `TZ`, override the
 * Hong Kong default. Vercel/AWS Lambda reserve `TZ` and set it to the POSIX form
 * `:UTC`, which Intl rejects, so a `TZ` starting with ":" is ignored.
 */
export function businessTimeZone(): string {
  if (typeof process === "undefined") return DEFAULT_BUSINESS_TIMEZONE;
  const explicit = process.env?.BUSINESS_TIME_ZONE?.trim();
  if (explicit) return explicit;
  const tz = process.env?.TZ?.trim();
  if (tz && !tz.startsWith(":")) return tz;
  return DEFAULT_BUSINESS_TIMEZONE;
}

/** Today's date in the business calendar as `YYYY-MM-DD` (matches server cron / overdue filters). */
export function businessCalendarToday(timeZone = businessTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}
