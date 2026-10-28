import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { Express } from "express";
import { createAccessToken } from "../lib/auth/jwt.js";
import { ACCESS_COOKIE } from "../lib/auth/cookies.js";

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
 * Two clients with the same auto code (GTL001) used to violate
 * invoiceplane_clients_user_mode_code_uniq and crash startup migrations.
 * Create must mint the next free code instead of returning 500 / 23505.
 */
describe("client code uniqueness", () => {
  let server: Server;
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let dbAvailable = false;

  before(async () => {
    process.env.DATABASE_URL ??= "postgresql://127.0.0.1:5432/postgres";
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "integration-test-jwt-secret-that-is-at-least-32-chars";
    process.env.GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "test-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "http://127.0.0.1/api/auth/google/callback";

    const token = await createAccessToken({
      sub: "client-code-unique-test-user",
      email: "client-code-unique@test.local",
      role: "admin",
    });
    authHeaders = {
      Cookie: `${ACCESS_COOKIE}=${token}`,
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };

    const mod = await import("../app.js");
    ({ server, baseUrl } = await listen(mod.default));

    const probe = await fetch(`${baseUrl}/api/company-settings`, { headers: authHeaders });
    dbAvailable = probe.status === 200;
  });

  after(() => {
    server.close();
  });

  it("assigns GTL002 when GTL001 is already taken", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }

    const first = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Great Tech Limited", clientCode: "GTL001", email: "gtl-a@test.local" }),
    });
    assert.equal(first.status, 201, await first.text());
    const firstBody = (await first.json()) as { id: string; clientCode: string };
    assert.equal(firstBody.clientCode, "GTL001");

    const second = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Green Timber Logistics", clientCode: "GTL001", email: "gtl-b@test.local" }),
    });
    assert.equal(second.status, 201, await second.text());
    const secondBody = (await second.json()) as { id: string; clientCode: string };
    assert.equal(secondBody.clientCode, "GTL002");
    assert.notEqual(secondBody.id, firstBody.id);
  });

  it("rejects updating a client to another active client's code", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }

    const a = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Alpha Code Co", clientCode: "ACC100", email: "acc-a@test.local" }),
    });
    assert.equal(a.status, 201, await a.text());
    const aBody = (await a.json()) as { id: string };

    const b = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Beta Code Co", clientCode: "BCC100", email: "acc-b@test.local" }),
    });
    assert.equal(b.status, 201, await b.text());
    const bBody = (await b.json()) as { id: string };

    const patch = await fetch(`${baseUrl}/api/clients/${bBody.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Beta Code Co",
        clientCode: "ACC100",
        email: "acc-b@test.local",
        isActive: true,
      }),
    });
    assert.equal(patch.status, 409, await patch.text());
    assert.ok(aBody.id);
  });
});
