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

type InvoiceDto = {
  id: string;
  clientId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  status: string;
  currency: string;
  items: Array<{ name: string; description?: string; details?: string; quantity: number; price: number; taxRate?: number }>;
  discountAmount: number;
  consultantIds: string[];
  serviceCategory: string;
  notes?: string;
  internalNote?: string;
  termsConditions?: string;
  remark?: string;
};

describe("invoice internal note", () => {
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
      sub: "internal-note-test-user",
      email: "internal-note@test.local",
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

  async function createClient(name: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@test.local` }),
    });
    assert.equal(res.status, 201, `create client failed: ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  async function patchStatus(id: string, status: string) {
    const res = await fetch(`${baseUrl}/api/invoices/${id}/status`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ status }),
    });
    assert.equal(res.status, 200, `status ${status} failed: ${await res.text()}`);
    return (await res.json()) as InvoiceDto;
  }

  it("creates, reloads, and updates an internal note without revising a sent invoice", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }
    const clientId = await createClient("Internal Note Client");
    const items = [{ name: "Consulting", quantity: 1, price: 800, taxRate: 0 }];

    const createRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        clientId,
        invoiceDate: "2026-03-01",
        dueDate: "2026-03-31",
        currency: "HKD",
        items,
        internalNote: "Created with staff context",
      }),
    });
    assert.equal(createRes.status, 201, `create invoice failed: ${await createRes.text()}`);
    const created = (await createRes.json()) as InvoiceDto;
    assert.equal(created.internalNote, "Created with staff context");
    assert.equal(created.status, "draft");
    assert.match(created.invoiceNumber, /^\d{7,}$/);

    const getRes = await fetch(`${baseUrl}/api/invoices/${created.id}`, { headers: authHeaders });
    assert.equal(getRes.status, 200);
    const loaded = (await getRes.json()) as InvoiceDto;
    assert.equal(loaded.internalNote, "Created with staff context");

    await patchStatus(created.id, "pending_approval");
    await patchStatus(created.id, "approved");
    const sent = await patchStatus(created.id, "sent");
    assert.equal(sent.status, "sent");
    const numberBefore = sent.invoiceNumber;

    const patchRes = await fetch(`${baseUrl}/api/invoices/${created.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        clientId,
        invoiceDate: sent.invoiceDate,
        dueDate: sent.dueDate,
        status: "sent",
        currency: sent.currency,
        discountAmount: sent.discountAmount,
        items: sent.items,
        consultantIds: sent.consultantIds,
        serviceCategory: sent.serviceCategory,
        notes: sent.notes ?? "",
        termsConditions: sent.termsConditions ?? "",
        remark: sent.remark ?? "",
        invoiceNumber: sent.invoiceNumber,
        internalNote: "Follow up after the client call",
      }),
    });
    assert.equal(patchRes.status, 200, `patch invoice failed: ${await patchRes.text()}`);
    const patched = (await patchRes.json()) as InvoiceDto;
    assert.equal(patched.internalNote, "Follow up after the client call");
    assert.equal(patched.status, "sent");
    assert.equal(patched.invoiceNumber, numberBefore);
    assert.equal(patched.invoiceNumber.includes("REVISED"), false);

    const noOpRes = await fetch(`${baseUrl}/api/invoices/${created.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        clientId,
        invoiceDate: patched.invoiceDate,
        dueDate: patched.dueDate,
        status: patched.status,
        currency: patched.currency,
        discountAmount: patched.discountAmount,
        items: patched.items,
        consultantIds: patched.consultantIds,
        serviceCategory: patched.serviceCategory,
        notes: patched.notes ?? "",
        termsConditions: patched.termsConditions ?? "",
        remark: patched.remark ?? "",
        invoiceNumber: patched.invoiceNumber,
        internalNote: patched.internalNote,
      }),
    });
    assert.equal(noOpRes.status, 200, `no-op patch failed: ${await noOpRes.text()}`);
    const noOpBody = (await noOpRes.json()) as InvoiceDto;
    assert.equal(noOpBody.internalNote, "Follow up after the client call");
    assert.equal(noOpBody.invoiceNumber, numberBefore);
    assert.equal(noOpBody.status, "sent");
  });
});
