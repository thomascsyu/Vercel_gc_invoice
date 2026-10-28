import assert from "node:assert/strict";
import test from "node:test";
import { isInvoiceOverdue } from "./utils";

const pastToday = "2026-01-01";

test("isInvoiceOverdue is true for sent invoices past due with a remaining balance", () => {
  assert.equal(
    isInvoiceOverdue(
      {
        status: "sent",
        dueDate: "2020-01-01",
        invoiceDate: "2019-12-01",
        paidAmount: 0,
        total: 100,
      },
      pastToday,
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
      pastToday,
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
      pastToday,
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
      pastToday,
    ),
    false,
  );
});
