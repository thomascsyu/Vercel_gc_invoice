import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERT_QUOTATION_ERROR,
  bulkInvoiceStatusTargets,
  bulkQuotationStatusTargets,
  canConvertQuotation,
  canTransitionInvoice,
  canTransitionQuotation,
  formInvoiceStatuses,
  formQuotationStatuses,
  invoiceTransitionError,
  quotationTransitionError,
} from "./documentStatus";

test("invoice same-status updates are allowed", () => {
  assert.equal(canTransitionInvoice("sent", "sent"), true);
  assert.equal(invoiceTransitionError("sent", "sent"), null);
});

test("invoice workflow follows draft → pending → approved → sent", () => {
  assert.equal(canTransitionInvoice("draft", "pending_approval"), true);
  assert.equal(canTransitionInvoice("pending_approval", "approved"), true);
  assert.equal(canTransitionInvoice("approved", "sent"), true);
  assert.equal(canTransitionInvoice("draft", "sent"), false);
  assert.equal(canTransitionInvoice("draft", "paid"), false);
});

test("invoice reject returns pending approval to draft", () => {
  assert.equal(canTransitionInvoice("pending_approval", "draft"), true);
});

test("quotation cannot jump to invoiced via status PATCH", () => {
  assert.equal(canTransitionQuotation("confirmed", "invoiced"), false);
  assert.match(quotationTransitionError("confirmed", "invoiced") ?? "", /converting/i);
});

test("only confirmed quotations convert", () => {
  assert.equal(canConvertQuotation("confirmed"), true);
  assert.equal(canConvertQuotation("draft"), false);
  assert.equal(canConvertQuotation("sent"), false);
  assert.equal(canConvertQuotation("canceled"), false);
  assert.equal(CONVERT_QUOTATION_ERROR.includes("confirmed"), true);
});

test("form pills include current status and legal next steps, not paid/invoiced", () => {
  assert.deepEqual(formInvoiceStatuses("draft"), ["draft", "pending_approval"]);
  assert.ok(!formInvoiceStatuses("sent").includes("paid"));
  assert.deepEqual(formInvoiceStatuses("paid"), ["paid", "draft"]);
  assert.deepEqual(formQuotationStatuses("confirmed"), ["confirmed", "canceled"]);
  assert.ok(!formQuotationStatuses("confirmed").includes("invoiced"));
});

test("quotation skip is allowed before confirm and invoiced is terminal", () => {
  assert.equal(canTransitionQuotation("draft", "skip"), true);
  assert.equal(canTransitionQuotation("approved", "skip"), true);
  assert.equal(canTransitionQuotation("sent", "skip"), true);
  assert.equal(canTransitionQuotation("skip", "confirmed"), true);
  assert.equal(canTransitionQuotation("draft", "confirmed"), false);
  assert.equal(canTransitionQuotation("invoiced", "draft"), false);
  assert.equal(canTransitionQuotation("canceled", "draft"), false);
});

test("invoice cannot skip approval; paid can return to draft only", () => {
  assert.equal(canTransitionInvoice("draft", "approved"), false);
  assert.equal(canTransitionInvoice("approved", "paid"), false);
  assert.equal(canTransitionInvoice("paid", "sent"), false);
  assert.equal(canTransitionInvoice("paid", "draft"), true);
  assert.equal(invoiceTransitionError("paid", "draft"), null);
});

test("bulk quotation targets require every selected row to allow the transition", () => {
  assert.ok(bulkQuotationStatusTargets(["draft", "draft"]).includes("pending_approval"));
  assert.ok(!bulkQuotationStatusTargets(["draft", "sent"]).includes("approved"));
  assert.deepEqual(bulkQuotationStatusTargets(["invoiced"]), []);
});

test("bulk invoice targets require full payment before paid", () => {
  assert.ok(bulkInvoiceStatusTargets([{ status: "sent", paidAmount: 1000, total: 1000 }]).includes("paid"));
  assert.ok(!bulkInvoiceStatusTargets([{ status: "sent", paidAmount: 500, total: 1000 }]).includes("paid"));
  assert.ok(bulkInvoiceStatusTargets([{ status: "draft", paidAmount: 0, total: 100 }]).includes("pending_approval"));
  assert.ok(bulkInvoiceStatusTargets([{ status: "paid", paidAmount: 100, total: 100 }]).includes("draft"));
});

test("create-from-draft rejects illegal initial quotation statuses", () => {
  assert.notEqual(quotationTransitionError("draft", "confirmed"), null);
  assert.equal(quotationTransitionError("draft", "pending_approval"), null);
});
