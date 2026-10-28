import assert from "node:assert/strict";
import test from "node:test";
import { parseQuotationSearchQuery, parseSearchAmount } from "./quotationSearch";

test("parseSearchAmount normalizes comma and decimal formats", () => {
  assert.equal(parseSearchAmount("$1000"), 1000);
  assert.equal(parseSearchAmount("$1,000"), 1000);
  assert.equal(parseSearchAmount("$1,000.00"), 1000);
  assert.equal(parseSearchAmount("1000"), 1000);
});

test("parseSearchAmount rejects invalid values", () => {
  assert.equal(parseSearchAmount("$abc"), null);
  assert.equal(parseSearchAmount("$"), null);
  assert.equal(parseSearchAmount(""), null);
});

test("parseQuotationSearchQuery detects Q + number as quotation", () => {
  assert.deepEqual(parseQuotationSearchQuery("Q260530"), {
    mode: "quotation",
    term: "Q260530",
  });
  assert.deepEqual(parseQuotationSearchQuery("q26"), {
    mode: "quotation",
    term: "q26",
  });
});

test("parseQuotationSearchQuery treats Q without digits as client search", () => {
  assert.deepEqual(parseQuotationSearchQuery("Quality"), {
    mode: "client",
    term: "Quality",
  });
  assert.deepEqual(parseQuotationSearchQuery("Q"), {
    mode: "client",
    term: "Q",
  });
  assert.deepEqual(parseQuotationSearchQuery("Q-260530"), {
    mode: "client",
    term: "Q-260530",
  });
});

test("parseQuotationSearchQuery detects amount prefix", () => {
  assert.deepEqual(parseQuotationSearchQuery("$1000"), {
    mode: "amount",
    term: "$1000",
    amount: 1000,
  });
  assert.deepEqual(parseQuotationSearchQuery("$1,000.00"), {
    mode: "amount",
    term: "$1,000.00",
    amount: 1000,
  });
});

test("parseQuotationSearchQuery treats invalid amount as amount mode without value", () => {
  assert.deepEqual(parseQuotationSearchQuery("$abc"), {
    mode: "amount",
    term: "$abc",
    amount: undefined,
  });
});

test("parseQuotationSearchQuery defaults to client mode", () => {
  assert.deepEqual(parseQuotationSearchQuery("Acme"), {
    mode: "client",
    term: "Acme",
  });
  assert.deepEqual(parseQuotationSearchQuery("CLI-001"), {
    mode: "client",
    term: "CLI-001",
  });
});

test("parseQuotationSearchQuery returns null for empty input", () => {
  assert.equal(parseQuotationSearchQuery(""), null);
  assert.equal(parseQuotationSearchQuery("   "), null);
});
