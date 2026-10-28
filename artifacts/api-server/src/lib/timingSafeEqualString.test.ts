import assert from "node:assert/strict";
import test from "node:test";
import { timingSafeEqualString } from "./timingSafeEqualString";

test("timingSafeEqualString matches identical strings", () => {
  assert.equal(timingSafeEqualString("abc123", "abc123"), true);
});

test("timingSafeEqualString rejects different strings of the same length", () => {
  assert.equal(timingSafeEqualString("abc123", "abc124"), false);
});

test("timingSafeEqualString rejects different-length strings", () => {
  assert.equal(timingSafeEqualString("short", "much-longer-string"), false);
});

test("timingSafeEqualString rejects when either side is missing", () => {
  assert.equal(timingSafeEqualString(undefined, "abc123"), false);
  assert.equal(timingSafeEqualString("abc123", undefined), false);
  assert.equal(timingSafeEqualString(null, null), false);
  assert.equal(timingSafeEqualString("", "abc123"), false);
});
