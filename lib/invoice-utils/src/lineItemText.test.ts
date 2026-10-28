import assert from "node:assert/strict";
import test from "node:test";
import {
  invoiceDescriptionDisplay,
  invoiceDescriptionToStored,
  normalizeInvoiceLineItemForCompare,
} from "./lineItemText";

test("invoice description round-trip matches form submit normalization", () => {
  const raw = {
    name: "Consulting",
    description: "Phase 1\nPhase 2",
    details: "legacy fine print",
    quantity: 2,
    price: 150.5,
    taxRate: 6,
  };
  const normalized = normalizeInvoiceLineItemForCompare(raw);
  assert.deepEqual(normalized, {
    name: "Consulting",
    description: "Phase 1\nPhase 2",
    details: "",
    quantity: 2,
    price: 150.5,
    taxRate: 0,
  });
});

test("normalizeInvoiceLineItemForCompare treats stored and submitted shapes as equal", () => {
  const stored = {
    name: "Service",
    description: "",
    details: "",
    quantity: 1,
    price: 100,
    taxRate: 0,
  };
  const fromForm = normalizeInvoiceLineItemForCompare({
    name: "Service",
    description: "",
    details: "ignored after round-trip",
    quantity: 1,
    price: 100,
    taxRate: 0,
  });
  assert.deepEqual(fromForm, stored);
  assert.deepEqual(normalizeInvoiceLineItemForCompare(stored), stored);
});

test("invoiceDescriptionDisplay collapses duplicate name and description", () => {
  assert.equal(
    invoiceDescriptionDisplay({ name: "Fee", description: "Fee" }),
    "Fee",
  );
  assert.deepEqual(invoiceDescriptionToStored("Fee"), {
    name: "Fee",
    description: "",
    details: "",
  });
});

test("invoice line description preserves spaces while drafting", () => {
  assert.deepEqual(invoiceDescriptionToStored("two words", { trim: false }), {
    name: "two words",
    description: "",
    details: "",
  });
  assert.equal(
    invoiceDescriptionDisplay({ name: "two ", description: "" }, { trim: false }),
    "two ",
  );
  assert.equal(invoiceDescriptionDisplay({ name: "two ", description: "" }), "two");
  assert.deepEqual(invoiceDescriptionToStored("two words "), {
    name: "two words",
    description: "",
    details: "",
  });
});
