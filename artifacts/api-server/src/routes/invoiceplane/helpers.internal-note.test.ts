import assert from "node:assert/strict";
import test from "node:test";
import {
  isInternalNoteOnlyInvoicePatch,
  isNoOpInvoicePatch,
  type InvoiceRevisionCompareExisting,
  type InternalNoteLineItem,
} from "./internalNotePatch";

const items: InternalNoteLineItem[] = [{ name: "Service", description: "", quantity: 1, price: 100, taxRate: 0 }];
const consultantIds = ["11111111-1111-1111-1111-111111111111"];

const existing: InvoiceRevisionCompareExisting = {
  clientId: "client-1",
  invoiceNumber: "260101001",
  invoiceDate: "2026-01-01",
  dueDate: "2026-01-31",
  status: "sent",
  currency: "HKD",
  discountAmount: "0.00",
  serviceCategory: "others",
  cancellationReason: null,
  notes: "Created from quotation",
  internalNote: "Original internal note",
  termsConditions: null,
  remark: null,
};

const matchingBody = {
  clientId: existing.clientId,
  invoiceNumber: existing.invoiceNumber,
  invoiceDate: existing.invoiceDate,
  dueDate: existing.dueDate,
  status: existing.status,
  currency: existing.currency,
  discountAmount: 0,
  items,
  consultantIds,
  serviceCategory: "others" as const,
  notes: existing.notes ?? undefined,
  internalNote: "Updated internal note",
  termsConditions: existing.termsConditions ?? undefined,
  remark: existing.remark ?? undefined,
};

test("isInternalNoteOnlyInvoicePatch is true when only the internal note changes", () => {
  assert.equal(
    isInternalNoteOnlyInvoicePatch(existing, items, consultantIds, matchingBody, consultantIds),
    true,
  );
});

test("isInternalNoteOnlyInvoicePatch is false when the internal note is unchanged", () => {
  assert.equal(
    isInternalNoteOnlyInvoicePatch(
      existing,
      items,
      consultantIds,
      { ...matchingBody, internalNote: existing.internalNote! },
      consultantIds,
    ),
    false,
  );
});

test("isInternalNoteOnlyInvoicePatch is false when internal note is omitted", () => {
  assert.equal(
    isInternalNoteOnlyInvoicePatch(
      existing,
      items,
      consultantIds,
      { ...matchingBody, internalNote: undefined },
      consultantIds,
    ),
    false,
  );
});

test("isNoOpInvoicePatch is true when nothing changed including internal note", () => {
  assert.equal(
    isNoOpInvoicePatch(
      existing,
      items,
      consultantIds,
      { ...matchingBody, internalNote: existing.internalNote! },
      consultantIds,
    ),
    true,
  );
});

test("isInternalNoteOnlyInvoicePatch treats null and empty customer notes as equal", () => {
  assert.equal(
    isInternalNoteOnlyInvoicePatch(
      { ...existing, notes: null, internalNote: null },
      items,
      consultantIds,
      { ...matchingBody, notes: "", internalNote: "Staff note" },
      consultantIds,
    ),
    true,
  );
});

test("isInternalNoteOnlyInvoicePatch is false when status would change to revised", () => {
  assert.equal(
    isInternalNoteOnlyInvoicePatch(
      existing,
      items,
      consultantIds,
      { ...matchingBody, status: "revised" },
      consultantIds,
    ),
    false,
  );
});

test("isInternalNoteOnlyInvoicePatch is false when line items change", () => {
  assert.equal(
    isInternalNoteOnlyInvoicePatch(
      existing,
      items,
      consultantIds,
      { ...matchingBody, items: [{ ...items[0]!, price: 250 }] },
      consultantIds,
    ),
    false,
  );
});

test("line item normalization ignores legacy details after form round-trip", () => {
  const storedItems: InternalNoteLineItem[] = [
    { name: "Consulting", description: "Phase 1", details: "", quantity: 1, price: 100, taxRate: 0 },
  ];
  const submittedItems: InternalNoteLineItem[] = [
    {
      name: "Consulting",
      description: "Phase 1",
      details: "legacy fine print",
      quantity: 1,
      price: 100,
      taxRate: 0,
    },
  ];
  assert.equal(
    isInternalNoteOnlyInvoicePatch(
      { ...existing, internalNote: "before" },
      storedItems,
      consultantIds,
      { ...matchingBody, items: submittedItems, internalNote: "after" },
      consultantIds,
    ),
    true,
  );
});

test("isInternalNoteOnlyInvoicePatch is false when the invoice number changes", () => {
  assert.equal(
    isInternalNoteOnlyInvoicePatch(
      existing,
      items,
      consultantIds,
      { ...matchingBody, invoiceNumber: "260101001-REVISED" },
      consultantIds,
    ),
    false,
  );
});
