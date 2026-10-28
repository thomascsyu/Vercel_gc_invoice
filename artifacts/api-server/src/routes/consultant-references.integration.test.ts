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
 * Regression coverage for the dangling-reference fix on DELETE /consultants/:id:
 * consultantIds is a plain JSONB array on invoices/job orders/proposals with no
 * foreign key, so a hard delete used to silently leave invoices pointing at a
 * consultant that no longer exists. Requires a real Postgres with the
 * invoiceplane schema pushed — skips cleanly otherwise.
 */
describe("consultant deletion is blocked while referenced", () => {
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
      sub: "consultant-ref-test-user",
      email: "consultant-ref@test.local",
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

  it("cannot delete a consultant still assigned to an invoice; deleting after unassigning succeeds", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }

    const consultantRes = await fetch(`${baseUrl}/api/consultants`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ shortCode: "REF1", name: "Reference Test Consultant" }),
    });
    assert.equal(consultantRes.status, 201, `create consultant failed: ${await consultantRes.text()}`);
    const consultant = (await consultantRes.json()) as { id: string };

    const clientRes = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Consultant Ref Client", email: "consultant-ref-client@test.local" }),
    });
    assert.equal(clientRes.status, 201);
    const client = (await clientRes.json()) as { id: string };

    const invoiceItems = [{ name: "Service", quantity: 1, price: 100, taxRate: 0 }];
    const invoiceRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        clientId: client.id,
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        currency: "HKD",
        items: invoiceItems,
        consultantIds: [consultant.id],
      }),
    });
    assert.equal(invoiceRes.status, 201, `create invoice failed: ${await invoiceRes.text()}`);
    const invoice = (await invoiceRes.json()) as { id: string };

    // Blocked while referenced.
    const blockedDelete = await fetch(`${baseUrl}/api/consultants/${consultant.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    assert.equal(blockedDelete.status, 409);
    const blockedBody = (await blockedDelete.json()) as { error?: string };
    assert.match(blockedBody.error ?? "", /invoices/i);

    // Unassign, then deletion succeeds. PATCH /invoices/:id is a full-body
    // update, so resend the required fields alongside the cleared assignment.
    const unassignRes = await fetch(`${baseUrl}/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        clientId: client.id,
        invoiceDate: "2026-01-01",
        dueDate: "2026-01-31",
        currency: "HKD",
        items: invoiceItems,
        consultantIds: [],
      }),
    });
    assert.equal(unassignRes.status, 200, `unassign failed: ${await unassignRes.text()}`);

    const successfulDelete = await fetch(`${baseUrl}/api/consultants/${consultant.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    assert.equal(successfulDelete.status, 204);
  });
});
