import assert from "node:assert/strict";
import test from "node:test";
import { withConnectionRetry } from "./withConnectionRetry";

test("withConnectionRetry succeeds on first attempt", async () => {
  let calls = 0;
  const result = await withConnectionRetry(async () => {
    calls += 1;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withConnectionRetry retries transient connection errors", async () => {
  let calls = 0;
  const transient = Object.assign(new Error("terminating connection due to administrator command"), {
    code: "57P01",
  });

  const result = await withConnectionRetry(async () => {
    calls += 1;
    if (calls === 1) throw transient;
    return 42;
  });

  assert.equal(result, 42);
  assert.equal(calls, 2);
});

test("withConnectionRetry does not retry non-transient errors", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withConnectionRetry(async () => {
        calls += 1;
        throw new Error("validation failed");
      }),
    /validation failed/,
  );
  assert.equal(calls, 1);
});
