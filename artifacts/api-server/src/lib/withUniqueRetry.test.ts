import assert from "node:assert/strict";
import test from "node:test";
import { withUniqueRetry } from "./withUniqueRetry";

function uniqueViolation(): Error {
  return Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
}

test("withUniqueRetry returns the result on first success", async () => {
  let calls = 0;
  const result = await withUniqueRetry(async () => {
    calls++;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withUniqueRetry retries after a unique violation and returns the eventual success", async () => {
  let calls = 0;
  const result = await withUniqueRetry(async () => {
    calls++;
    if (calls < 3) throw uniqueViolation();
    return `attempt-${calls}`;
  });
  assert.equal(result, "attempt-3");
  assert.equal(calls, 3);
});

test("withUniqueRetry gives up after 5 attempts and throws the last unique-violation error", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withUniqueRetry(async () => {
        calls++;
        throw uniqueViolation();
      }),
    (err: unknown) => err instanceof Error && (err as { code?: string }).code === "23505",
  );
  assert.equal(calls, 5);
});

test("withUniqueRetry rethrows a non-unique-violation error immediately without retrying", async () => {
  let calls = 0;
  const otherError = new Error("connection refused");
  await assert.rejects(
    () =>
      withUniqueRetry(async () => {
        calls++;
        throw otherError;
      }),
    otherError,
  );
  assert.equal(calls, 1);
});
