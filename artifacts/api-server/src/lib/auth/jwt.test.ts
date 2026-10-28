import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "./jwt.js";

const TEST_SECRET = "unit-test-jwt-secret-that-is-at-least-32-chars-long";

describe("JWT access vs refresh", () => {
  it("verifyAccessToken accepts access tokens only", async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const access = await createAccessToken({
      sub: "google-sub-1",
      email: "user@example.com",
      role: "user",
    });
    const payload = await verifyAccessToken(access);
    assert.equal(payload?.sub, "google-sub-1");
    assert.equal(payload?.typ, "access");
  });

  it("verifyAccessToken rejects refresh tokens", async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const refresh = await createRefreshToken(
      {
        sub: "google-sub-1",
        email: "user@example.com",
        role: "user",
      },
      0,
    );
    assert.equal(await verifyAccessToken(refresh), null);
    assert.equal((await verifyRefreshToken(refresh))?.typ, "refresh");
  });

  it("createRefreshToken embeds the version claim", async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const refresh = await createRefreshToken(
      { sub: "google-sub-2", email: "user2@example.com", role: "admin" },
      3,
    );
    const payload = await verifyRefreshToken(refresh);
    assert.equal(payload?.ver, 3);
  });
});
