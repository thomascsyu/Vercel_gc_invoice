import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStandardInvoiceNumber,
  inferMissingSequenceSlot,
  isVoidedInvoice,
  parseInvoiceNumber,
  verifyInvoiceContinuity,
} from "./invoiceContinuity";

test("parseInvoiceNumber reads YYMM sequence and revision suffix", () => {
  assert.deepEqual(parseInvoiceNumber("2609001"), {
    invoiceNumber: "2609001",
    baseNumber: "2609001",
    stamp: "2609",
    yearMonth: "2026-09",
    sequence: 1,
    isRevised: false,
  });
  assert.equal(parseInvoiceNumber("2609001-REVISED")?.isRevised, true);
  assert.equal(parseInvoiceNumber("2609001-REVISED-2")?.sequence, 1);
  assert.equal(parseInvoiceNumber("26101000")?.sequence, 1000);
  assert.equal(parseInvoiceNumber(" 2609002 ")?.sequence, 2);
  assert.equal(parseInvoiceNumber(" 2609002 ")?.invoiceNumber, "2609002");
});

test("parseInvoiceNumber rejects non-standard and invalid months", () => {
  assert.equal(parseInvoiceNumber("INV-0001"), null);
  assert.equal(parseInvoiceNumber("Q2609001"), null);
  assert.equal(parseInvoiceNumber("2613001"), null);
  assert.equal(parseInvoiceNumber("26091"), null);
  assert.equal(parseInvoiceNumber(""), null);
});

test("formatStandardInvoiceNumber pads the sequence to 3 digits", () => {
  assert.equal(formatStandardInvoiceNumber("2609", 1), "2609001");
  assert.equal(formatStandardInvoiceNumber("2610", 1000), "26101000");
});

test("inferMissingSequenceSlot prefers the next stamp across months", () => {
  const previous = parseInvoiceNumber("2609001")!;
  const next = parseInvoiceNumber("2610003")!;
  assert.deepEqual(inferMissingSequenceSlot(2, previous, next), {
    sequence: 2,
    likelyNumber: "2610002",
    alternates: ["2609002"],
  });
});

test("inferMissingSequenceSlot uses a single stamp when previous and next match", () => {
  const previous = parseInvoiceNumber("2609001")!;
  const next = parseInvoiceNumber("2609003")!;
  assert.deepEqual(inferMissingSequenceSlot(2, previous, next), {
    sequence: 2,
    likelyNumber: "2609002",
  });
});

test("isVoidedInvoice treats deleted, explicit void, and voided status", () => {
  assert.equal(isVoidedInvoice({ invoiceNumber: "2609001", deletedAt: "2026-09-01T00:00:00.000Z" }), true);
  assert.equal(isVoidedInvoice({ invoiceNumber: "2609001", voided: true }), true);
  assert.equal(isVoidedInvoice({ invoiceNumber: "2609001", status: "voided" }), true);
  assert.equal(isVoidedInvoice({ invoiceNumber: "2609001", status: "sent" }), false);
  assert.equal(isVoidedInvoice({ invoiceNumber: "2609001", cancellationReason: "rejected" }), false);
});

test("verifyInvoiceContinuity reports the last number for each month when the sequence is intact", () => {
  const report = verifyInvoiceContinuity([
    { invoiceNumber: "2609001", invoiceDate: "2026-09-02", status: "sent" },
    { invoiceNumber: "2609002", invoiceDate: "2026-09-10", status: "paid" },
    { invoiceNumber: "2610003", invoiceDate: "2026-10-01", status: "draft" },
  ]);
  assert.equal(report.intact, true);
  assert.deepEqual(report.missingNumbers, []);
  assert.deepEqual(report.missingSequenceSlots, []);
  assert.deepEqual(report.voidedInvoices, []);
  assert.deepEqual(report.duplicateSequenceSlots, []);
  assert.deepEqual(report.reissuedNumbers, []);
  assert.equal(report.lastInvoiceNumberByMonth["2026-09"], "2609002");
  assert.equal(report.lastInvoiceNumberByMonth["2026-10"], "2610003");
  assert.equal(report.months[0]?.invoiceCount, 2);
  assert.equal(report.months[1]?.invoiceCount, 1);
});

test("verifyInvoiceContinuity flags missing numbers in the global sequence", () => {
  const report = verifyInvoiceContinuity([
    { invoiceNumber: "2609001", invoiceDate: "2026-09-01" },
    { invoiceNumber: "2609003", invoiceDate: "2026-09-15" },
    { invoiceNumber: "2610005", invoiceDate: "2026-10-02" },
  ]);
  assert.equal(report.intact, false);
  assert.deepEqual(report.missingNumbers, ["2609002", "2610004"]);
  assert.deepEqual(report.missingSequenceSlots, [
    { sequence: 2, likelyNumber: "2609002" },
    { sequence: 4, likelyNumber: "2610004", alternates: ["2609004"] },
  ]);
  assert.deepEqual(report.months.find((month) => month.month === "2026-09")?.missingNumbers, [
    "2609002",
  ]);
  assert.deepEqual(report.months.find((month) => month.month === "2026-10")?.missingNumbers, [
    "2610004",
  ]);
});

test("verifyInvoiceContinuity uses next-month stamp for cross-month gaps", () => {
  const report = verifyInvoiceContinuity([
    { invoiceNumber: "2609001", invoiceDate: "2026-09-01" },
    { invoiceNumber: "2610003", invoiceDate: "2026-10-02" },
  ]);
  assert.equal(report.intact, false);
  assert.deepEqual(report.missingNumbers, ["2610002"]);
  assert.deepEqual(report.missingSequenceSlots[0], {
    sequence: 2,
    likelyNumber: "2610002",
    alternates: ["2609002"],
  });
});

test("verifyInvoiceContinuity treats voided invoices as present and lists them", () => {
  const report = verifyInvoiceContinuity([
    { id: "a", invoiceNumber: "2609001", invoiceDate: "2026-09-01", status: "sent" },
    {
      id: "b",
      invoiceNumber: "2609002",
      invoiceDate: "2026-09-03",
      status: "draft",
      deletedAt: "2026-09-04T08:00:00.000Z",
      cancellationReason: "issued in error",
    },
    { id: "c", invoiceNumber: "2609003", invoiceDate: "2026-09-05", status: "sent" },
  ]);
  assert.equal(report.intact, true);
  assert.deepEqual(report.missingNumbers, []);
  assert.equal(report.lastInvoiceNumberByMonth["2026-09"], "2609003");
  assert.equal(report.voidedInvoices.length, 1);
  assert.equal(report.voidedInvoices[0]?.invoiceNumber, "2609002");
  assert.equal(report.voidedInvoices[0]?.id, "b");
  assert.equal(report.voidedInvoices[0]?.cancellationReason, "issued in error");
  assert.equal(report.months[0]?.voidedInvoices[0]?.invoiceNumber, "2609002");
});

test("verifyInvoiceContinuity detects reissued numbers after soft delete", () => {
  const report = verifyInvoiceContinuity([
    {
      id: "voided",
      invoiceNumber: "2609002",
      invoiceDate: "2026-09-01",
      deletedAt: "2026-09-02T00:00:00.000Z",
    },
    {
      id: "active",
      invoiceNumber: "2609002",
      invoiceDate: "2026-09-03",
      status: "sent",
    },
  ]);
  assert.equal(report.intact, true);
  assert.equal(report.reissuedNumbers.length, 1);
  assert.deepEqual(report.reissuedNumbers[0], {
    invoiceNumber: "2609002",
    voidedInvoiceId: "voided",
    activeInvoiceId: "active",
  });
});

test("verifyInvoiceContinuity flags duplicate sequence indices with different stamps", () => {
  const report = verifyInvoiceContinuity([
    { invoiceNumber: "2609001", invoiceDate: "2026-09-01" },
    { invoiceNumber: "2610001", invoiceDate: "2026-10-01" },
    { invoiceNumber: "2609002", invoiceDate: "2026-09-02" },
  ]);
  assert.equal(report.duplicateSequenceSlots.length, 1);
  assert.equal(report.duplicateSequenceSlots[0]?.sequence, 1);
  assert.deepEqual(report.duplicateSequenceSlots[0]?.baseNumbers, ["2609001", "2610001"]);
});

test("verifyInvoiceContinuity keeps a revised number in its sequence slot", () => {
  const report = verifyInvoiceContinuity([
    { invoiceNumber: "2609001-REVISED", invoiceDate: "2026-09-01" },
    { invoiceNumber: "2609002", invoiceDate: "2026-09-02" },
  ]);
  assert.equal(report.intact, true);
  assert.equal(report.lastInvoiceNumberByMonth["2026-09"], "2609002");
  assert.deepEqual(report.missingNumbers, []);
});

test("verifyInvoiceContinuity uses the revised number when it is the month's last invoice", () => {
  const report = verifyInvoiceContinuity([
    { invoiceNumber: "2609001", invoiceDate: "2026-09-01" },
    { invoiceNumber: "2609002-REVISED-2", invoiceDate: "2026-09-02" },
  ]);
  assert.equal(report.lastInvoiceNumberByMonth["2026-09"], "2609002-REVISED-2");
});

test("verifyInvoiceContinuity lists custom numbers as unparsed without inventing gaps", () => {
  const report = verifyInvoiceContinuity([
    { invoiceNumber: "INV-0001", invoiceDate: "2026-04-17" },
    { invoiceNumber: "2609001", invoiceDate: "2026-09-01" },
    { invoiceNumber: "2609002", invoiceDate: "2026-09-02" },
  ]);
  assert.equal(report.intact, true);
  assert.deepEqual(report.unparsedInvoiceNumbers, ["INV-0001"]);
  assert.equal(report.lastInvoiceNumberByMonth["2026-04"], "INV-0001");
  assert.equal(report.lastInvoiceNumberByMonth["2026-09"], "2609002");
});

test("verifyInvoiceContinuity returns an empty intact report", () => {
  const report = verifyInvoiceContinuity([]);
  assert.deepEqual(report, {
    months: [],
    lastInvoiceNumberByMonth: {},
    missingNumbers: [],
    missingSequenceSlots: [],
    voidedInvoices: [],
    duplicateSequenceSlots: [],
    duplicateBaseNumbers: [],
    reissuedNumbers: [],
    unparsedInvoiceNumbers: [],
    intact: true,
  });
});

test("verifyInvoiceContinuity sorts months and ignores cancellation without a void", () => {
  const report = verifyInvoiceContinuity([
    { invoiceNumber: "2610002", invoiceDate: "2026-10-01", status: "sent" },
    { invoiceNumber: "2609001", invoiceDate: "2026-09-01", status: "draft", cancellationReason: "rejected" },
  ]);
  assert.deepEqual(report.months.map((month) => month.month), ["2026-09", "2026-10"]);
  assert.equal(report.voidedInvoices.length, 0);
  assert.equal(report.intact, true);
});
