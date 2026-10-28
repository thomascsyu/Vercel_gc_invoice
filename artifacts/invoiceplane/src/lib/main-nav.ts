/** Shared main-nav order and mobile-only visibility rules. */

export const CONSULTANTS_SETTINGS_HREF = "/consultants/settings";
export const CONSULTANTS_PERFORMANCE_HREF = "/consultants/performance";

export const MOBILE_HIDDEN_NAV_HREFS = new Set<string>([
  "/document-layouts",
  "/recurring-invoices",
]);

/** Fixed mobile sidebar sequence. Hidden routes are listed then filtered out. */
export const MOBILE_MAIN_NAV_ORDER = [
  "/dashboard",
  "/quotations",
  "/invoices",
  "/job-orders",
  "/payments",
  "/receipts",
  CONSULTANTS_SETTINGS_HREF,
  "/clients",
] as const;

export function isConsultantNavHref(href: string): boolean {
  return href === CONSULTANTS_SETTINGS_HREF;
}

export function consultantParentHref(variant: "desktop" | "mobile"): string {
  return variant === "mobile"
    ? CONSULTANTS_PERFORMANCE_HREF
    : CONSULTANTS_SETTINGS_HREF;
}

export function orderMainNavForMobile<T extends { href: string }>(
  items: T[],
): T[] {
  const byHref = new Map(items.map((item) => [item.href, item]));
  return MOBILE_MAIN_NAV_ORDER.map((href) => byHref.get(href)).filter(
    (item): item is T => item != null && !MOBILE_HIDDEN_NAV_HREFS.has(item.href),
  );
}
