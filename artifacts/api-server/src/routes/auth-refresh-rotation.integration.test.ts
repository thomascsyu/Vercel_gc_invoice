import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { Express } from "express";
import { createAccessToken, createRefreshToken } from "../lib/auth/jwt.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../lib/auth/cookies.js";

async function listen(appInstance: Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = appInstance.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not bind test server"));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
    server.on("error", reject);
  });
}

/**
 * Regression coverage for refresh-token rotation + reuse detection on
 * POST /auth/refresh: each successful refresh must issue a brand new
 * refresh token and bump the user's stored version, so replaying the old
 * (already-rotated) refresh token is rejected. Requires a real Postgres
 * with the invoiceplane schema pushed — skips cleanly otherwise.
 *
 * @workspace/db is imported dynamically inside before() — not at module
 * scope — because it eagerly resolves DATABASE_URL on import, which must
 * happen after this hook sets it, the same way `../app.js` is loaded here.
 */
describe("refresh token rotation", () => {
  let server: Server;
  let baseUrl: string;
  let dbAvailable = false;
  let db: (typeof import("@workspace/db"))["db"];
  let usersTable: (typeof import("@workspace/db"))["usersTable"];
  let eq: (typeof import("drizzle-orm"))["eq"];
  const googleSub = "refresh-rotation-test-user";

  before(async () => {
    process.env.DATABASE_URL ??= "postgresql://127.0.0.1:5432/postgres";
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? "integration-test-jwt-secret-that-is-at-least-32-chars";
    process.env.GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "test-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "http://127.0.0.1/api/auth/google/callback";

    const dbMod = await import("@workspace/db");
    db = dbMod.db;
    usersTable = dbMod.usersTable;
    eq = (await import("drizzle-orm")).eq;

    const mod = await import("../app.js");
    ({ server, baseUrl } = await listen(mod.default));

    try {
      await db
        .insert(usersTable)
        .values({ googleSub, email: "refresh-rotation@test.local", role: "user" })
        .onConflictDoNothing();
      const [row] = await db.select().from(usersTable).where(eq(usersTable.googleSub, googleSub)).limit(1);
      dbAvailable = Boolean(row);
    } catch {
      dbAvailable = false;
    }
  });

  after(async () => {
    if (dbAvailable) {
      await db.delete(usersTable).where(eq(usersTable.googleSub, googleSub));
    }
    server.close();
  });

  it("rotates the refresh token on use and rejects replay of the old one", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.googleSub, googleSub)).limit(1);
    const payload = { sub: user.googleSub, email: user.email, role: user.role as "admin" | "user" };
    const access = await createAccessToken(payload);
    const originalRefresh = await createRefreshToken(payload, user.refreshTokenVersion);

    const firstRefresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        Cookie: `${ACCESS_COOKIE}=${access}; ${REFRESH_COOKIE}=${originalRefresh}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    assert.equal(firstRefresh.status, 200, `first refresh failed: ${await firstRefresh.text()}`);

    const setCookies = firstRefresh.headers.getSetCookie?.() ?? [];
    const newRefreshCookie = setCookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
    assert.ok(newRefreshCookie, "expected a new refresh token cookie to be set");
    const newRefresh = newRefreshCookie!.split(";")[0]!.split("=")[1]!;
    assert.notEqual(newRefresh, originalRefresh, "refresh token must change on rotation");

    // Replaying the OLD refresh token must now be rejected (version mismatch).
    const replay = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        Cookie: `${ACCESS_COOKIE}=${access}; ${REFRESH_COOKIE}=${originalRefresh}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    assert.equal(replay.status, 401);

    // The NEW refresh token must still work.
    const secondRefresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        Cookie: `${ACCESS_COOKIE}=${access}; ${REFRESH_COOKIE}=${newRefresh}`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    assert.equal(secondRefresh.status, 200, `second refresh failed: ${await secondRefresh.text()}`);
  });
});
