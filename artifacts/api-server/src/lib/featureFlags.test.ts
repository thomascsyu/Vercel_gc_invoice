import assert from "node:assert/strict";
import test from "node:test";

test("proposalsEnabled defaults true when env unset", async () => {
  const prev = process.env["PROPOSALS_ENABLED"];
  delete process.env["PROPOSALS_ENABLED"];
  const { proposalsEnabled } = await import("./featureFlags.js");
  assert.equal(proposalsEnabled(), true);
  if (prev !== undefined) process.env["PROPOSALS_ENABLED"] = prev;
});

test("proposalsEnabled respects false values", async () => {
  const prev = process.env["PROPOSALS_ENABLED"];
  process.env["PROPOSALS_ENABLED"] = "false";
  const { proposalsEnabled } = await import("./featureFlags.js");
  assert.equal(proposalsEnabled(), false);
  if (prev === undefined) delete process.env["PROPOSALS_ENABLED"];
  else process.env["PROPOSALS_ENABLED"] = prev;
});
