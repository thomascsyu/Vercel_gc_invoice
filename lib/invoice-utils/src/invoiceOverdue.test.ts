import assert from "node:assert/strict";
import test from "node:test";
import { businessCalendarToday, isInvoiceOverdue, OVERDUE_INVOICE_STATUSES } from "@workspace/invoice-utils";

test("OVERDUE_INVOICE_STATUSES includes approved, sent, and revised", () => {
  assert.deepEqual([...OVERDUE_INVOICE_STATUSES], ["approved", "sent", "revised"]);
});

test("isInvoiceOverdue uses business calendar today for comparison", () => {
  assert.equal(
    isInvoiceOverdue(
      {
        status: "sent",
        dueDate: "2020-01-01",
        invoiceDate: "2019-12-01",
        paidAmount: 0,
        total: 100,
      },
      "2026-01-01",
    ),
    true,
  );
  assert.equal(
    isInvoiceOverdue(
      {
        status: "approved",
        dueDate: "2020-01-01",
        invoiceDate: "2019-12-01",
        paidAmount: 0,
        total: 100,
      },
      "2026-01-01",
    ),
    true,
  );
});

test("isInvoiceOverdue is false for paid, draft, or future-due invoices", () => {
  assert.equal(
    isInvoiceOverdue(
      {
        status: "paid",
        dueDate: "2020-01-01",
        invoiceDate: "2019-12-01",
        paidAmount: 100,
        total: 100,
      },
      "2026-01-01",
    ),
    false,
  );
  assert.equal(
    isInvoiceOverdue(
      {
        status: "draft",
        dueDate: "2020-01-01",
        invoiceDate: "2019-12-01",
        paidAmount: 0,
        total: 100,
      },
      "2026-01-01",
    ),
    false,
  );
  assert.equal(
    isInvoiceOverdue(
      {
        status: "sent",
        dueDate: "2099-01-01",
        invoiceDate: "2026-01-01",
        paidAmount: 0,
        total: 100,
      },
      "2026-01-01",
    ),
    false,
  );
});

test("businessCalendarToday returns YYYY-MM-DD", () => {
  assert.match(businessCalendarToday("UTC"), /^\d{4}-\d{2}-\d{2}$/);
});
