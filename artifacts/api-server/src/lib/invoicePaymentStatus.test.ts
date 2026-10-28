import assert from "node:assert/strict";
import test from "node:test";
import {
  invoiceStatusAfterPaymentSync,
  isInvoiceFullyPaid,
  remainingInvoiceBalance,
  wouldOverpay,
} from "./invoicePaymentStatus";

test("promotes to paid when payments cover the total and remembers prior status", () => {
  assert.deepEqual(invoiceStatusAfterPaymentSync("sent", 1000, 1000), {
    status: "paid",
    statusBeforePaid: "sent",
  });
  assert.deepEqual(invoiceStatusAfterPaymentSync("approved", 1000.001, 1000), {
    status: "paid",
    statusBeforePaid: "approved",
  });
});

test("demotes paid back to remembered status when the last payment is removed", () => {
  assert.deepEqual(invoiceStatusAfterPaymentSync("paid", 0, 1000, "approved"), {
    status: "approved",
    statusBeforePaid: null,
  });
  assert.deepEqual(invoiceStatusAfterPaymentSync("paid", 200, 1000, "sent"), {
    status: "sent",
    statusBeforePaid: null,
  });
  assert.deepEqual(invoiceStatusAfterPaymentSync("paid", 0, 1000, null), {
    status: "sent",
    statusBeforePaid: null,
  });
});

test("leaves non-paid statuses alone when still outstanding", () => {
  assert.deepEqual(invoiceStatusAfterPaymentSync("sent", 200, 1000), {
    status: "sent",
    statusBeforePaid: null,
  });
  assert.deepEqual(invoiceStatusAfterPaymentSync("draft", 0, 1000), {
    status: "draft",
    statusBeforePaid: null,
  });
  assert.deepEqual(invoiceStatusAfterPaymentSync("revised", 500, 1000), {
    status: "revised",
    statusBeforePaid: null,
  });
});

test("remaining balance and overpay detection", () => {
  assert.equal(remainingInvoiceBalance(1000, 250), 750);
  assert.equal(wouldOverpay(1000, 250, 750), false);
  assert.equal(wouldOverpay(1000, 250, 750.01), true);
  assert.equal(wouldOverpay(1000, 1000, 0.01), true);
  assert.equal(isInvoiceFullyPaid(1000, 1000), true);
  assert.equal(isInvoiceFullyPaid(999.99, 1000), false);
});
