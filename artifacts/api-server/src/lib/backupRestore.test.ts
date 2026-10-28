import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ??= "postgresql://localhost:5432/gc_inv_test";

const { BACKUP_VERSION, BackupPayloadSchema } = await import("./backupRestore");

describe("BackupPayloadSchema", () => {
  it("accepts a minimal valid backup payload", () => {
    const payload = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      exportedByUserId: "google-sub-123",
      includeCompany: false,
      clients: [],
      invoices: [],
      quotations: [],
      payments: [],
      paymentReceipts: [],
      receipts: [],
      jobOrders: [],
      recurringInvoices: [],
      quotationTemplates: [],
      proposalDocuments: [],
      proposalActivity: [],
      proposalQuestions: [],
      clientProposals: [],
    };
    const parsed = BackupPayloadSchema.parse(payload);
    assert.equal(parsed.version, BACKUP_VERSION);
    assert.equal(parsed.clients.length, 0);
  });

  it("rejects unsupported backup versions", () => {
    const payload = {
      version: 99,
      exportedAt: new Date().toISOString(),
      exportedByUserId: "google-sub-123",
      includeCompany: false,
      clients: [],
      invoices: [],
      quotations: [],
      payments: [],
      paymentReceipts: [],
      receipts: [],
      jobOrders: [],
      recurringInvoices: [],
      quotationTemplates: [],
      proposalDocuments: [],
      proposalActivity: [],
      proposalQuestions: [],
      clientProposals: [],
    };
    assert.throws(() => BackupPayloadSchema.parse(payload));
  });
});
