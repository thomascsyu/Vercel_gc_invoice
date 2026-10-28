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

// The CSRF header guard (requireCsrfHeader in app.ts) runs before any
// per-route auth check, so a mutating request without the header should be
// rejected with 403 for every resource — regardless of whether a session
// cookie is present. These endpoints deliberately don't send a cookie: the
// point is that the CSRF check fires first, so we never even get to a 401.
describe("CSRF header guard", () => {
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

  const mutatingEndpoints: Array<{ method: string; path: string }> = [
    { method: "POST", path: "/api/clients" },
    { method: "POST", path: "/api/invoices" },
    { method: "POST", path: "/api/quotations" },
    { method: "POST", path: "/api/payments" },
    { method: "POST", path: "/api/job-orders" },
    { method: "PATCH", path: "/api/clients/00000000-0000-0000-0000-000000000000" },
    { method: "DELETE", path: "/api/invoices/00000000-0000-0000-0000-000000000000" },
  ];

  for (const { method, path } of mutatingEndpoints) {
    it(`${method} ${path} without X-Requested-With is rejected with 403`, async () => {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : "{}",
      });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error?: string };
      assert.match(body.error ?? "", /csrf/i);
    });

    it(`${method} ${path} with X-Requested-With is not rejected by the CSRF guard (falls through to auth)`, async () => {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: method === "DELETE" ? undefined : "{}",
      });
      // No session cookie is sent, so these must fail auth (401) — but
      // specifically NOT the CSRF guard's 403, proving the header satisfied it.
      assert.notEqual(res.status, 403);
    });
  }

  it("GET requests are exempt from the CSRF guard", async () => {
    const res = await fetch(`${baseUrl}/api/clients`);
    assert.notEqual(res.status, 403);
  });
});
