import assert from "node:assert/strict";
import { test } from "node:test";
import { streamJobOrderPdfToBuffer } from "./jobOrderPdfDraw";

function countPdfPages(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

const previewJobOrder = {
  id: "1",
  userId: "1",
  clientId: "1",
  jobOrderNumber: "PREVIEW-JO",
  jobDate: "2026-06-08",
  status: "draft",
  sourceType: null,
  sourceId: null,
  items: [
    { name: "Professional services", description: "Sample description line.", quantity: 2, price: 150.5, taxRate: 0 },
    { name: "Materials & supplies", quantity: 1, price: 320, taxRate: 6 },
  ],
  notes: "Sample job order notes for layout preview.",
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

const classicJobOrderLayout = {
  presetId: "classic",
  tableMode: "simple",
  sections: {
    showHeaderBannerLogo: true,
    showLogoRow: true,
    showBillingBlock: true,
    showTotals: true,
    showSignatures: true,
    showFooterAddress: true,
    showConsultantsLine: false,
    showJobOrderIssuerBlock: false,
  },
  sectionOffsets: {},
  footerText: "",
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
  companyLogoScale: 1,
  headerLogoScale: 1,
  chopScale: 1,
  pdfDocumentLayouts: { jobOrder: classicJobOrderLayout },
  bankAccount1: null,
  bankAccount2: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

test("job order layout preview fits on one page when footer is enabled (regression: footer must not spill onto a blank page 2)", async () => {
  const buf = await streamJobOrderPdfToBuffer(
    previewJobOrder as unknown as Parameters<typeof streamJobOrderPdfToBuffer>[0],
    previewClient as unknown as Parameters<typeof streamJobOrderPdfToBuffer>[1],
    previewSettings as unknown as Parameters<typeof streamJobOrderPdfToBuffer>[2],
    null,
    null,
    [],
  );
  assert.equal(countPdfPages(buf), 1);
});
