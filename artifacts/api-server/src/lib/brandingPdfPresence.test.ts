import assert from "node:assert/strict";
import { test } from "node:test";
import { streamInvoicePdfToBuffer } from "./invoicePdfDraw.js";
import { streamJobOrderPdfToBuffer } from "./jobOrderPdfDraw.js";
import { streamQuotationPdfToBuffer } from "./quotationReceiptPdfDraw.js";

function countPdfPages(buf: Buffer): number {
  const text = buf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches?.length ?? 0;
}

const client = {
  id: "c1",
  userId: "u1",
  name: "Acme Ltd",
  addressLine1: "1 Test Road",
  addressLine2: null,
  addressLine3: null,
  addressLine4: null,
  address: null,
  email: null,
  phone: null,
  country: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

const settingsNoBranding = {
  id: "1",
  companyName: "Gabriel Consultant Limited",
  addressLine1: "Suite E, 11/F",
  addressLine2: null,
  addressLine3: null,
  addressLine4: null,
  address: null,
  phone: "2366 4622",
  email: "info@gabriel.hk",
  logoUrl: null,
  headerLogoUrl: null,
  chopUrl: null,
  signatureImageUrl: null,
  companyLogoScale: 1,
  headerLogoScale: 1,
  chopScale: 1,
  bankAccount1: null,
  bankAccount2: null,
  pdfDocumentLayouts: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

test("invoice PDF without company/header/chop branding completes and is not stuck", async () => {
  const invoice = {
    id: "i1",
    userId: "u1",
    clientId: "c1",
    invoiceNumber: "INV-NOBRAND",
    invoiceDate: "2026-08-01",
    dueDate: "2026-08-31",
    status: "draft",
    currency: "HKD",
    items: [{ name: "Service", description: "", quantity: 1, price: 100, taxRate: 0 }],
    subtotal: "100",
    discountAmount: "0",
    total: "100",
    paidAmount: "0",
    serviceCategory: "others",
    termsConditions: null,
    remark: null,
    shareToken: null,
    shareTokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buf = await streamInvoicePdfToBuffer(
    invoice as unknown as Parameters<typeof streamInvoicePdfToBuffer>[0],
    client as unknown as Parameters<typeof streamInvoicePdfToBuffer>[1],
    settingsNoBranding as unknown as Parameters<typeof streamInvoicePdfToBuffer>[2],
  );
  assert.ok(buf.length > 500);
  const latin = buf.toString("latin1");
  assert.equal(latin.includes("/Subtype /Image"), false);
  assert.equal(latin.includes("Company Chop"), false);
  assert.ok(countPdfPages(buf) >= 1);
});

test("invoice PDF never includes the staff-only internal note", async () => {
  const secret = "INTERNAL-NOTE-SECRET-STRING-9f3c1a";
  const invoice = {
    id: "i-internal",
    userId: "u1",
    clientId: "c1",
    invoiceNumber: "INV-INTERNAL",
    invoiceDate: "2026-08-01",
    dueDate: "2026-08-31",
    status: "sent",
    currency: "HKD",
    items: [{ name: "Service", description: "", quantity: 1, price: 100, taxRate: 0 }],
    subtotal: "100",
    discountAmount: "0",
    total: "100",
    paidAmount: "0",
    serviceCategory: "others",
    notes: null,
    internalNote: secret,
    termsConditions: null,
    remark: null,
    shareToken: null,
    shareTokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buf = await streamInvoicePdfToBuffer(
    invoice as unknown as Parameters<typeof streamInvoicePdfToBuffer>[0],
    client as unknown as Parameters<typeof streamInvoicePdfToBuffer>[1],
    settingsNoBranding as unknown as Parameters<typeof streamInvoicePdfToBuffer>[2],
  );
  assert.ok(buf.length > 500);
  const latin = buf.toString("latin1");
  const utf8 = buf.toString("utf8");
  assert.equal(latin.includes(secret), false);
  assert.equal(utf8.includes(secret), false);
  assert.ok(countPdfPages(buf) >= 1);
});

test("quotation PDF without branding completes and is not stuck", async () => {
  const quotation = {
    id: "q1",
    userId: "u1",
    clientId: "c1",
    quotationNumber: "QT-NOBRAND",
    quotationDate: "2026-08-01",
    validUntil: "2026-08-31",
    status: "draft",
    currency: "HKD",
    items: [{ name: "Service", description: "", quantity: 1, price: 100, taxRate: 0 }],
    subtotal: "100",
    discountAmount: "0",
    total: "100",
    serviceCategory: "others",
    convertedInvoiceId: null,
    cancellationReason: null,
    termsConditions: null,
    remark: null,
    quotationAttn: null,
    shareToken: null,
    shareTokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buf = await streamQuotationPdfToBuffer(
    quotation as unknown as Parameters<typeof streamQuotationPdfToBuffer>[0],
    client as unknown as Parameters<typeof streamQuotationPdfToBuffer>[1],
    settingsNoBranding as unknown as Parameters<typeof streamQuotationPdfToBuffer>[2],
  );
  assert.ok(buf.length > 500);
  const latin = buf.toString("latin1");
  assert.equal(latin.includes("/Subtype /Image"), false);
  assert.equal(latin.includes("Company Chop"), false);
  assert.equal(countPdfPages(buf), 1);
});

test("job order PDF completes without branding", async () => {
  const jobOrder = {
    id: "jo1",
    userId: "u1",
    clientId: "c1",
    jobOrderNumber: "JO-BRANDING",
    jobDate: "2026-08-01",
    status: "draft",
    sourceType: null,
    sourceId: null,
    items: [{ name: "Service", description: "", quantity: 1, price: 100, taxRate: 0 }],
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const withoutStamp = await streamJobOrderPdfToBuffer(
    jobOrder as unknown as Parameters<typeof streamJobOrderPdfToBuffer>[0],
    client as unknown as Parameters<typeof streamJobOrderPdfToBuffer>[1],
    settingsNoBranding as unknown as Parameters<typeof streamJobOrderPdfToBuffer>[2],
    null,
    null,
    [],
  );
  assert.equal(withoutStamp.toString("latin1").includes("/Subtype /Image"), false);
  assert.ok(countPdfPages(withoutStamp) >= 1);
});
