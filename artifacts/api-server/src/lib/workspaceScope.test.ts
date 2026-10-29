import assert from "node:assert/strict";
import test from "node:test";

test("WORKSPACE_DATA_USER_ID takes precedence in env resolution", () => {
  const prev = process.env["WORKSPACE_DATA_USER_ID"];
  process.env["WORKSPACE_DATA_USER_ID"] = "  env-sub-123  ";
  try {
    const raw = process.env["WORKSPACE_DATA_USER_ID"]?.trim();
    assert.equal(raw, "env-sub-123");
  } finally {
    if (prev === undefined) delete process.env["WORKSPACE_DATA_USER_ID"];
    else process.env["WORKSPACE_DATA_USER_ID"] = prev;
  }
});
