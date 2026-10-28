import assert from "node:assert/strict";
import test from "node:test";
import { parseShareTokenExpiryDays, shareTokenMatches } from "./shareToken";

test("shareTokenMatches accepts identical tokens", () => {
  assert.equal(shareTokenMatches("abc-token", "abc-token"), true);
});

test("shareTokenMatches rejects missing, mismatched, or different-length tokens", () => {
  assert.equal(shareTokenMatches(null, "abc"), false);
  assert.equal(shareTokenMatches("abc", undefined), false);
  assert.equal(shareTokenMatches("abc", "abd"), false);
  assert.equal(shareTokenMatches("short", "longer-token"), false);
});

test("parseShareTokenExpiryDays falls back for invalid env values", () => {
  assert.equal(parseShareTokenExpiryDays(undefined), 30);
  assert.equal(parseShareTokenExpiryDays("foo"), 30);
  assert.equal(parseShareTokenExpiryDays("0"), 30);
  assert.equal(parseShareTokenExpiryDays("-3"), 30);
  assert.equal(parseShareTokenExpiryDays("14"), 14);
});
