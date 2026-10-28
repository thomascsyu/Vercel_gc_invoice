import assert from "node:assert/strict";
import test from "node:test";
import { calculateDocumentTotals, isInvoiceFullyPaid } from "./lineItemTotals";

test("calculateDocumentTotals applies quantity and tax", () => {
  const totals = calculateDocumentTotals(
    [{ quantity: 2, price: 500, taxRate: 10 }],
    0,
  );
  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.taxAmount, 100);
  assert.equal(totals.total, 1100);
});

test("isInvoiceFullyPaid allows half-cent tolerance", () => {
  assert.equal(isInvoiceFullyPaid(999.996, 1000), true);
  assert.equal(isInvoiceFullyPaid(999.99, 1000), false);
});
