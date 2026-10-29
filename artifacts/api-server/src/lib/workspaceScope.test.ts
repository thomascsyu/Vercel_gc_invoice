import assert from "node:assert/strict";
import test from "node:test";

test("env WORKSPACE_DATA_USER_ID wins over cached settings", async () => {
  const prev = process.env["WORKSPACE_DATA_USER_ID"];
  process.env["WORKSPACE_DATA_USER_ID"] = "env-sub-123";
  try {
    const { resolveWorkspaceDataUserId, invalidateWorkspaceDataUserCache } = await import(
      "./workspaceScope.js"
    );
    invalidateWorkspaceDataUserCache();
    const id = await resolveWorkspaceDataUserId();
    assert.equal(id, "env-sub-123");
  } finally {
    if (prev === undefined) delete process.env["WORKSPACE_DATA_USER_ID"];
    else process.env["WORKSPACE_DATA_USER_ID"] = prev;
    const { invalidateWorkspaceDataUserCache } = await import("./workspaceScope.js");
    invalidateWorkspaceDataUserCache();
  }
});
