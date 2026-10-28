import assert from "node:assert/strict";
import test from "node:test";
import {
  generateApiKey,
  getApiKeyFromRequestHeader,
  hashApiKey,
} from "./apiKey";

test("generated API keys have the public prefix and sufficient entropy", () => {
  const first = generateApiKey();
  const second = generateApiKey();
  assert.match(first, /^gci_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("API key hashes are deterministic without retaining the token", () => {
  const token = "gci_example";
  assert.equal(hashApiKey(token), hashApiKey(token));
  assert.equal(hashApiKey(token).length, 64);
  assert.ok(!hashApiKey(token).includes(token));
});

test("API key request headers are trimmed and empty values are rejected", () => {
  assert.equal(getApiKeyFromRequestHeader("  gci_example  "), "gci_example");
  assert.equal(getApiKeyFromRequestHeader("  "), null);
  assert.equal(getApiKeyFromRequestHeader(undefined), null);
});
