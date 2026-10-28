import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { Express } from "express";

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

describe("auth HTTP routes", () => {
  let server: Server;
  let baseUrl: string;
  let app: Express;

  before(async () => {
    process.env.DATABASE_URL ??= "postgresql://127.0.0.1:5432/postgres";
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "integration-test-jwt-secret-that-is-at-least-32-chars";
    const mod = await import("../app.js");
    app = mod.default;
    ({ server, baseUrl } = await listen(app));
  });

  after(() => {
    server.close();
  });

  it("POST /api/auth/logout returns 204", async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    assert.equal(res.status, 204);
  });

  it("POST /api/auth/logout without the CSRF header is rejected", async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
    assert.equal(res.status, 403);
  });

  it("GET /api/clients without session returns 401 when OAuth is configured", async () => {
    const hadOAuth = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID);
    process.env.GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "test-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "http://localhost/api/auth/google/callback";

    const res = await fetch(`${baseUrl}/api/clients`);
    if (!hadOAuth) {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    }
    assert.equal(res.status, 401);
  });
});
