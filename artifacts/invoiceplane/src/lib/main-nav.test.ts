import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSULTANTS_PERFORMANCE_HREF,
  CONSULTANTS_SETTINGS_HREF,
  consultantParentHref,
  isConsultantNavHref,
  MOBILE_HIDDEN_NAV_HREFS,
  orderMainNavForMobile,
} from "./main-nav";

const items = [
  { href: "/dashboard", name: "Dashboard" },
  { href: "/clients", name: "Clients" },
  { href: CONSULTANTS_SETTINGS_HREF, name: "Consultants" },
  { href: "/quotations", name: "Quotations" },
  { href: "/invoices", name: "Invoices" },
  { href: "/job-orders", name: "Job Orders" },
  { href: "/payments", name: "Payments" },
  { href: "/receipts", name: "Receipts" },
  { href: "/document-layouts", name: "Document layouts" },
  { href: "/recurring-invoices", name: "Recurring Invoices" },
];

test("mobile sidebar uses the requested sequence and hides layouts/recurring", () => {
  assert.deepEqual(
    orderMainNavForMobile(items).map((item) => item.name),
    [
      "Dashboard",
      "Quotations",
      "Invoices",
      "Job Orders",
      "Payments",
      "Receipts",
      "Consultants",
      "Clients",
    ],
  );
  assert.equal(MOBILE_HIDDEN_NAV_HREFS.has("/document-layouts"), true);
  assert.equal(MOBILE_HIDDEN_NAV_HREFS.has("/recurring-invoices"), true);
});

test("mobile consultants parent goes to performance, not settings", () => {
  assert.equal(consultantParentHref("mobile"), CONSULTANTS_PERFORMANCE_HREF);
  assert.equal(consultantParentHref("desktop"), CONSULTANTS_SETTINGS_HREF);
  assert.equal(isConsultantNavHref(CONSULTANTS_SETTINGS_HREF), true);
});
