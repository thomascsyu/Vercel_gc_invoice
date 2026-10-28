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
 * Regression coverage for the transaction fixes around money-moving writes
 * (payment create/delete syncing invoice paidAmount/status, and quotation →
 * invoice conversion). Requires a real Postgres with the invoiceplane schema
 * pushed — skips cleanly otherwise, same pattern as branding.integration.test.ts.
 */
describe("payment and quotation-conversion money flow", () => {
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
      sub: "money-flow-test-user",
      email: "money-flow@test.local",
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
      body: JSON.stringify({ name, email: `${name.toLowerCase()}@test.local` }),
    });
    assert.equal(res.status, 201, `create client failed: ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  it("recording a payment for the full invoice total marks the invoice paid", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }
    const clientId = await createClient("MoneyFlow Client A");

    const invoiceRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        clientId,
        invoiceDate: "2026-01-01",
        currency: "HKD",
        items: [{ name: "Service", quantity: 1, price: 1000, taxRate: 0 }],
      }),
    });
    assert.equal(invoiceRes.status, 201, `create invoice failed: ${await invoiceRes.text()}`);
    const invoice = (await invoiceRes.json()) as { id: string; total: number; status: string };
    assert.equal(invoice.status, "draft");
    assert.equal(Number(invoice.total), 1000);

    const paymentRes = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: invoice.id,
        amount: 1000,
        paymentDate: "2026-01-02",
        paymentMethod: "bank_transfer",
      }),
    });
    assert.equal(paymentRes.status, 201, `create payment failed: ${await paymentRes.text()}`);
    const payment = (await paymentRes.json()) as { id: string; invoicePaidAmount?: number };

    const invoiceAfter = await fetch(`${baseUrl}/api/invoices/${invoice.id}`, { headers: authHeaders });
    const updated = (await invoiceAfter.json()) as { status: string; paidAmount: number };
    assert.equal(updated.status, "paid");
    assert.equal(Number(updated.paidAmount), 1000);

    // Deleting the payment must sync the invoice back down (delete + sync run
    // in one transaction — see routes/invoiceplane.ts DELETE /payments/:id).
    const deleteRes = await fetch(`${baseUrl}/api/payments/${payment.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    assert.equal(deleteRes.status, 204);

    const invoiceAfterDelete = await fetch(`${baseUrl}/api/invoices/${invoice.id}`, { headers: authHeaders });
    const reverted = (await invoiceAfterDelete.json()) as { status: string; paidAmount: number };
    assert.equal(Number(reverted.paidAmount), 0);
    assert.notEqual(reverted.status, "paid");
  });

  it("allows changing a paid invoice to draft, including after restore", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }
    const clientId = await createClient("MoneyFlow Paid To Draft");
    const items = [{ name: "Service", quantity: 1, price: 250, taxRate: 0 }];

    async function createPaidInvoice() {
      const invoiceRes = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          clientId,
          invoiceDate: "2026-01-01",
          dueDate: "2026-01-31",
          currency: "HKD",
          items,
        }),
      });
      assert.equal(invoiceRes.status, 201, `create invoice failed: ${await invoiceRes.text()}`);
      const invoice = (await invoiceRes.json()) as {
        id: string;
        clientId: string;
        invoiceDate: string;
        dueDate?: string;
        currency: string;
        items: typeof items;
      };
      const paymentRes = await fetch(`${baseUrl}/api/payments`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          invoiceId: invoice.id,
          amount: 250,
          paymentDate: "2026-01-02",
          paymentMethod: "bank_transfer",
        }),
      });
      assert.equal(paymentRes.status, 201, `create payment failed: ${await paymentRes.text()}`);
      const paidRes = await fetch(`${baseUrl}/api/invoices/${invoice.id}`, { headers: authHeaders });
      const paid = (await paidRes.json()) as { status: string };
      assert.equal(paid.status, "paid");
      return invoice;
    }

    const statusInvoice = await createPaidInvoice();
    const statusToDraft = await fetch(`${baseUrl}/api/invoices/${statusInvoice.id}/status`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ status: "draft" }),
    });
    assert.equal(statusToDraft.status, 200, `paid→draft status PATCH should succeed: ${await statusToDraft.text()}`);
    assert.equal(((await statusToDraft.json()) as { status: string }).status, "draft");

    const fullInvoice = await createPaidInvoice();
    const fullPatchToDraft = await fetch(`${baseUrl}/api/invoices/${fullInvoice.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        clientId: fullInvoice.clientId,
        invoiceDate: fullInvoice.invoiceDate,
        dueDate: fullInvoice.dueDate ?? fullInvoice.invoiceDate,
        currency: fullInvoice.currency,
        status: "draft",
        items,
      }),
    });
    assert.equal(fullPatchToDraft.status, 200, `paid→draft full PATCH should succeed: ${await fullPatchToDraft.text()}`);
    assert.equal(((await fullPatchToDraft.json()) as { status: string }).status, "draft");

    const bulkInvoice = await createPaidInvoice();
    const bulkToDraft = await fetch(`${baseUrl}/api/invoices/bulk-status`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ ids: [bulkInvoice.id], status: "draft" }),
    });
    assert.equal(bulkToDraft.status, 204, `paid→draft bulk-status should succeed: ${await bulkToDraft.text()}`);
    const afterBulk = await fetch(`${baseUrl}/api/invoices/${bulkInvoice.id}`, { headers: authHeaders });
    assert.equal(((await afterBulk.json()) as { status: string }).status, "draft");

    const restoreInvoice = await createPaidInvoice();
    const deleteRes = await fetch(`${baseUrl}/api/invoices/${restoreInvoice.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    assert.equal(deleteRes.status, 204);
    const restoreRes = await fetch(`${baseUrl}/api/invoices/${restoreInvoice.id}/restore`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(restoreRes.status, 200, `restore failed: ${await restoreRes.text()}`);
    const restored = (await restoreRes.json()) as { status: string };
    assert.equal(restored.status, "paid");
    const afterRestoreToDraft = await fetch(`${baseUrl}/api/invoices/${restoreInvoice.id}/status`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ status: "draft" }),
    });
    assert.equal(
      afterRestoreToDraft.status,
      200,
      `restored paid invoice → draft should succeed: ${await afterRestoreToDraft.text()}`,
    );
    assert.equal(((await afterRestoreToDraft.json()) as { status: string }).status, "draft");
  });

  it("converting a quotation creates a linked invoice and marks the quotation invoiced", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }
    const clientId = await createClient("MoneyFlow Client B");

    const quotationRes = await fetch(`${baseUrl}/api/quotations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        clientId,
        quotationDate: "2026-01-01",
        currency: "HKD",
        items: [{ name: "Consulting", quantity: 2, price: 500, taxRate: 10 }],
      }),
    });
    assert.equal(quotationRes.status, 201, `create quotation failed: ${await quotationRes.text()}`);
    const quotation = (await quotationRes.json()) as { id: string; total: number };
    assert.equal(Number(quotation.total), 1100);

    const draftConvert = await fetch(`${baseUrl}/api/quotations/${quotation.id}/convert`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(draftConvert.status, 422, `draft convert should be rejected: ${await draftConvert.text()}`);

    for (const status of ["pending_approval", "approved", "sent", "confirmed"] as const) {
      const statusRes = await fetch(`${baseUrl}/api/quotations/${quotation.id}/status`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ status }),
      });
      assert.equal(statusRes.status, 200, `status ${status} failed: ${await statusRes.text()}`);
    }

    const convertRes = await fetch(`${baseUrl}/api/quotations/${quotation.id}/convert`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        notes: "Converted in test",
        status: "draft",
      }),
    });
    assert.equal(convertRes.status, 201, `convert failed: ${await convertRes.text()}`);
    const invoice = (await convertRes.json()) as {
      id: string;
      total: number;
      taxAmount: number;
      items: Array<{ quantity: number }>;
    };
    assert.equal(Number(invoice.total), 1100);
    assert.equal(Number(invoice.taxAmount), 100);
    assert.equal(invoice.items[0]?.quantity, 2);

    const quotationAfter = await fetch(`${baseUrl}/api/quotations/${quotation.id}`, { headers: authHeaders });
    const updatedQuotation = (await quotationAfter.json()) as { status: string; convertedInvoiceId?: string };
    assert.equal(updatedQuotation.status, "invoiced");
    assert.equal(updatedQuotation.convertedInvoiceId, invoice.id);

    const convertAgain = await fetch(`${baseUrl}/api/quotations/${quotation.id}/convert`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(convertAgain.status, 409);
  });

  it("two invoices created back-to-back never collide on invoice number", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }
    const clientId = await createClient("MoneyFlow Client C");
    const body = JSON.stringify({
      clientId,
      invoiceDate: "2026-01-01",
      currency: "HKD",
      items: [{ name: "Service", quantity: 1, price: 100, taxRate: 0 }],
    });

    const [resA, resB] = await Promise.all([
      fetch(`${baseUrl}/api/invoices`, { method: "POST", headers: authHeaders, body }),
      fetch(`${baseUrl}/api/invoices`, { method: "POST", headers: authHeaders, body }),
    ]);
    assert.equal(resA.status, 201);
    assert.equal(resB.status, 201);
    const invoiceA = (await resA.json()) as { invoiceNumber: string };
    const invoiceB = (await resB.json()) as { invoiceNumber: string };
    assert.notEqual(invoiceA.invoiceNumber, invoiceB.invoiceNumber);
  });

  it("rejects a payment that would exceed the invoice total", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }
    const clientId = await createClient("MoneyFlow Client D");
    const invoiceRes = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        clientId,
        invoiceDate: "2026-01-01",
        currency: "HKD",
        items: [{ name: "Service", quantity: 1, price: 100, taxRate: 0 }],
      }),
    });
    assert.equal(invoiceRes.status, 201, `create invoice failed: ${await invoiceRes.text()}`);
    const invoice = (await invoiceRes.json()) as { id: string };

    const overpay = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: invoice.id,
        amount: 150,
        paymentDate: "2026-01-02",
        paymentMethod: "bank_transfer",
      }),
    });
    assert.equal(overpay.status, 400);
    const body = (await overpay.json()) as { error: string };
    assert.match(body.error, /exceeds the remaining balance/i);
  });
});
