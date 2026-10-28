import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { BRANDING_STORAGE_URL_PREFIX } from "./brandingImageUrl";
import { streamQuotationPdfToBuffer } from "./quotationReceiptPdfDraw";

function countPdfPages(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

const previewQuotation = {
  id: "1",
  userId: "1",
  clientId: "1",
  quotationNumber: "PREVIEW-QT",
  quotationDate: "2026-06-08",
  validUntil: "2026-07-08",
  status: "draft",
  currency: "HKD",
  items: [
    { name: "Professional services", description: "Sample description line.", quantity: 2, price: 150.5, taxRate: 0 },
    { name: "Materials & supplies", quantity: 1, price: 320, taxRate: 6 },
  ],
  subtotal: "621",
  discountAmount: "0",
  total: "640.20",
  serviceCategory: "others",
  convertedInvoiceId: null,
  cancellationReason: null,
  termsConditions: "Sample terms: payment within 14 days of acceptance. This PDF is for layout preview only.",
  remark: "Sample remark text for layout preview.",
  quotationAttn: "Sample attention line",
  shareToken: null,
  shareTokenExpiresAt: null,
  driveFileUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const previewClient = {
  id: "1",
  userId: "1",
  name: "Global Investigation & Security Consultancy Ltd.",
  addressLine1: "Unit 1203, 12/F., Lippo Sun Plaza,",
  addressLine2: "28 Canton Road, Tsim Sha Tsui, Kowloon.",
  addressLine3: null,
  addressLine4: null,
  address: null,
  email: null,
  phone: null,
  country: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

const classicQuotationLayout = {
  presetId: "classic",
  tableMode: "simple",
  sections: {
    showHeaderBannerLogo: true,
    showLogoRow: true,
    showBillingBlock: true,
    showTotals: true,
    showBankAccounts: true,
    showSignatures: true,
    showFooterAddress: true,
  },
  sectionOffsets: {},
  footerText: "",
  quotation: { showRemarks: true, showPaymentTerms: true, showSignatureBlock: true },
} as const;

const previewSettings = {
  id: "1",
  companyName: "Global Investigation & Security Consultancy Ltd.",
  addressLine1: "Suit E, 11/F.,",
  addressLine2: "Boton Technology Innovation Tower,",
  addressLine3: "368 Kwun Tong Road, Hong Kong.",
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
  pdfDocumentLayouts: { quotation: classicQuotationLayout },
  bankAccount1: null,
  bankAccount2: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

test("quotation layout preview fits on one page when footer is enabled", async () => {
  const buf = await streamQuotationPdfToBuffer(
    previewQuotation as unknown as Parameters<typeof streamQuotationPdfToBuffer>[0],
    previewClient as unknown as Parameters<typeof streamQuotationPdfToBuffer>[1],
    previewSettings as unknown as Parameters<typeof streamQuotationPdfToBuffer>[2],
  );
  assert.equal(countPdfPages(buf), 1);
});

test("quotation PDF without branding assets completes and does not stick logo placeholders", async () => {
  const buf = await streamQuotationPdfToBuffer(
    previewQuotation as unknown as Parameters<typeof streamQuotationPdfToBuffer>[0],
    previewClient as unknown as Parameters<typeof streamQuotationPdfToBuffer>[1],
    previewSettings as unknown as Parameters<typeof streamQuotationPdfToBuffer>[2],
  );
  const latin = buf.toString("latin1");
  assert.equal(latin.includes("/Subtype /Image"), false, "expected no embedded images without branding");
  assert.equal(latin.includes("Company Chop"), false, "expected no stuck Company Chop placeholder text");
  assert.equal(countPdfPages(buf), 1);
});

test("quotation PDF embeds company and header logos when branding assets exist", async () => {
  const relLogo = "branding/company-logo/test-logo.png";
  const relHeader = "branding/header-logo/test-header.png";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const localRoot = path.resolve(process.cwd(), ".local/public-objects");
  await mkdir(path.join(localRoot, path.dirname(relLogo)), { recursive: true });
  await mkdir(path.join(localRoot, path.dirname(relHeader)), { recursive: true });
  await writeFile(path.join(localRoot, relLogo), png);
  await writeFile(path.join(localRoot, relHeader), png);

  const settings = {
    ...previewSettings,
    logoUrl: `${BRANDING_STORAGE_URL_PREFIX}${relLogo}`,
    headerLogoUrl: `${BRANDING_STORAGE_URL_PREFIX}${relHeader}`,
  };

  const buf = await streamQuotationPdfToBuffer(
    previewQuotation as unknown as Parameters<typeof streamQuotationPdfToBuffer>[0],
    previewClient as unknown as Parameters<typeof streamQuotationPdfToBuffer>[1],
    settings as unknown as Parameters<typeof streamQuotationPdfToBuffer>[2],
  );
  const latin = buf.toString("latin1");
  assert.ok(latin.includes("/Subtype /Image"), "expected embedded image objects in PDF");
  assert.equal(countPdfPages(buf), 1);
});
