import assert from "node:assert/strict";
import test from "node:test";
import { buildClientCode, formatClientCode, parseClientCode } from "./clientCode";

test("buildClientCode uses the first letter of up to three words", () => {
  assert.equal(buildClientCode("Great Tech Limited"), "GTL001");
  assert.equal(buildClientCode("Acme"), "A001");
  assert.equal(buildClientCode("   "), "CLI001");
});

test("parseClientCode splits a trailing number from the prefix", () => {
  assert.deepEqual(parseClientCode("GTL001"), { prefix: "GTL", number: 1, width: 3 });
  assert.deepEqual(parseClientCode("GTL012"), { prefix: "GTL", number: 12, width: 3 });
  assert.deepEqual(parseClientCode("CLIENT-9"), { prefix: "CLIENT-", number: 9, width: 1 });
  assert.deepEqual(parseClientCode("ABC"), { prefix: "ABC", number: 0, width: 3 });
});

test("formatClientCode pads the numeric suffix", () => {
  assert.equal(formatClientCode("GTL", 2, 3), "GTL002");
  assert.equal(formatClientCode("GTL", 12, 3), "GTL012");
  assert.equal(formatClientCode("C", 1, 1), "C001");
});
