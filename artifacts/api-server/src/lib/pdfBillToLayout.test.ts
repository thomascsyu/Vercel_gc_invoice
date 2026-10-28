import assert from "node:assert/strict";
import { describe, it } from "node:test";
import PDFDocument from "pdfkit";
import { drawInvoicePdfDoc } from "./invoicePdfDraw.js";
import {
  PDF_BILL_TO_CHARS_PER_ROW,
  invoiceBillingColumns,
  pdfBillToMinValueWidthPt,
} from "./pdfBillToLayout.js";

describe("pdfBillToLayout", () => {
  it("reserves PDF width for at least 40 bill-to characters per row", () => {
    const doc = new PDFDocument();
    const minW = pdfBillToMinValueWidthPt(doc);
    const probe = "0".repeat(PDF_BILL_TO_CHARS_PER_ROW);
    assert.ok(minW >= doc.widthOfString(probe) - 0.01);
  });

  it("widens invoice left bill-to column beyond half-page when needed for 40 chars", () => {
    const doc = new PDFDocument();
    const marginL = 50;
    const contentW = 495.28;
    const addrValueX = marginL + 70;
    const halfPageValueW = contentW / 2 - 12 - (addrValueX - marginL);
    const cols = invoiceBillingColumns(doc, { marginL, contentW, addrValueX });
    assert.ok(
      cols.leftBillingValueWidth > halfPageValueW,
      "invoice bill-to value column should exceed legacy half-page width",
    );
    assert.ok(cols.leftBillingValueWidth >= pdfBillToMinValueWidthPt(doc));
    assert.ok(cols.rightBlockW >= 80);
  });
});

type TextCall = { text: string; x: number; y: number; height: number; lineHeight: number; width: number };
async function invoiceTextCalls(name: string, issuer?: string): Promise<TextCall[]> {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  doc.resume();
  const calls: TextCall[] = [];
  const originalText = doc.text.bind(doc);
  doc.text = ((text: string, x: number, y: number, options: PDFKit.Mixins.TextOptions = {}) => {
    if (typeof x === "number" && typeof y === "number") {
      calls.push({ text, x, y, height: doc.heightOfString(text, options), lineHeight: doc.currentLineHeight(true), width: options.width ?? 0 });
    }
    return originalText(text, x, y, options);
  }) as typeof doc.text;
  try {
    await drawInvoicePdfDoc(doc, {
      invoiceNumber: "TEST", invoiceDate: "2026-09-20", currency: "HKD",
      total: "100", paidAmount: "0", items: [],
    } as unknown as Parameters<typeof drawInvoicePdfDoc>[1], {
      name, addressLine1: "1 Test Road",
    } as Parameters<typeof drawInvoicePdfDoc>[2], issuer ? {
      companyName: issuer,
    } as Parameters<typeof drawInvoicePdfDoc>[3] : undefined);
    return calls;
  } finally {
    doc.end();
  }
}

it("fits a realistic uppercase client name on one rendered row", async () => {
  const name = "HONG KONG INTERNATIONAL TRADING LIMITED";
  const calls = await invoiceTextCalls(name);
  const row = calls.find((call) => call.text.trim() === name)!;
  assert.ok(row);
  assert.ok(row.height <= row.lineHeight + 0.01);
});

it("fits 40 wide characters without consuming the issuer column", async () => {
  const name = "W".repeat(40);
  const calls = await invoiceTextCalls(name);
  const row = calls.find((call) => call.text === name)!;
  const issuer = calls.find((call) => call.text === "Gabriel Consultant Limited")!;
  assert.ok(row.height <= row.lineHeight + 0.01);
  assert.ok(issuer.width >= 150 - 0.01);
  assert.ok(row.x + row.width + 24 <= issuer.x + 0.01);
});

for (const issuer of [undefined, "HONG KONG INTERNATIONAL CONSULTANCY SERVICES LIMITED"]) {
  it(`keeps wrapped issuer rows separate (${issuer ?? "default issuer"})`, async () => {
    const calls = await invoiceTextCalls("Acme Ltd", issuer);
    const rows = calls.filter((call) => call.x > 300 && call.y >= 110 && call.y < 300);
    assert.equal(rows.length, 6);
    assert.ok(rows.some((row) => row.height > row.lineHeight + 0.01));
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].y >= rows[i - 1].y + rows[i - 1].height + 1.99,
        `${rows[i].text} overlaps ${rows[i - 1].text}`);
    }
  });
}
