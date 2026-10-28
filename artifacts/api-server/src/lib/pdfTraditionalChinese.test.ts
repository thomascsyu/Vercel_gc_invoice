import assert from "node:assert/strict";
import { test } from "node:test";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import { streamInvoicePdfToBuffer } from "./invoicePdfDraw";
import { streamQuotationPdfToBuffer, streamReceiptPdfToBuffer } from "./quotationReceiptPdfDraw";
import { textNeedsUnicodeFont } from "./pdfTraditionalChinese";
import { padMinFieldLength } from "./pdfTextMinField";

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

const companyName = "加百列顧問有限公司";
const clientName = "香港恆生貿易有限公司";
const address = "香港九龍觀塘道368號衞生中心";
const contact = "陳大文";

const settings = {
  id: "1",
  companyName,
  addressLine1: "香港九龍觀塘道368號",
  addressLine2: "創新中心11樓E室",
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
  bankAccount1: {
    bankName: "恒生銀行",
    accountNumber: "123-456789-001",
    bankCode: "024",
    branchName: "觀塘分行",
    swift: "HASEHKHH",
    bankAddress: "香港九龍觀塘",
    accountName: companyName,
  },
  bankAccount2: null,
  pdfDocumentLayouts: {
    invoice: { footerText: "多謝惠顧" },
    quotation: { footerText: "多謝查詢", quotation: { showRemarks: true, showPaymentTerms: true, showSignatureBlock: true } },
    receipt: { footerText: "此收據以繁體中文發出" },
  },
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

const client = {
  id: "c1",
  userId: "u1",
  name: clientName,
  contactPerson: contact,
  addressLine1: address,
  addressLine2: "嘅寫字樓喺創新中心",
  addressLine3: null,
  addressLine4: null,
  address: null,
  email: "client@example.hk",
  phone: null,
  country: "香港",
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

function countPdfPages(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

test("WinAnsi strings stay on the standard font", () => {
  assert.equal(textNeedsUnicodeFont("INVOICE 123 — €50…"), false);
  assert.equal(textNeedsUnicodeFont("發票"), true);
  assert.equal(textNeedsUnicodeFont("Hello 香港"), true);
  assert.equal(textNeedsUnicodeFont("【報價】"), true);
});

test("Traditional Chinese values are not space-padded", () => {
  assert.equal(padMinFieldLength("恒生銀行", 50), "恒生銀行");
  assert.equal(padMinFieldLength("Hello 香港", 20), "Hello 香港");
  assert.equal(padMinFieldLength("HSBC", 8), "HSBC    ");
});

test("Traditional Chinese is measured with a real glyph width and Latin metrics are restored", () => {
  const doc = new PDFDocument({ size: "A4" });
  doc.font("Helvetica").fontSize(10);
  const latin = doc.widthOfString("AAAA");
  const cjk = doc.widthOfString("香港發票");
  const latinAfter = doc.widthOfString("AAAA");
  doc.font("Helvetica-Bold").fontSize(10);
  const bold = doc.widthOfString("顧問");
  assert.ok(cjk >= 36, `expected full-width CJK advance, got ${cjk}`);
  assert.ok(cjk > latin, `expected CJK advance to exceed Latin, got ${cjk} vs ${latin}`);
  assert.equal(latinAfter, latin);
  assert.ok(bold > 10, `expected bold CJK width, got ${bold}`);
});

test("invoice PDF renders Traditional Chinese client, company, bank, and line text", async () => {
  const invoice = {
    id: "i1",
    userId: "u1",
    clientId: "c1",
    invoiceNumber: "INV-2604014",
    invoiceDate: "2026-04-14",
    dueDate: "2026-05-14",
    status: "sent",
    currency: "HKD",
    items: [
      {
        name: "專業顧問服務",
        description: "繁體中文項目說明",
        quantity: 1,
        price: 18000,
        taxRate: 0,
      },
    ],
    subtotal: "18000",
    discountAmount: "0",
    total: "18000",
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
    settings as unknown as Parameters<typeof streamInvoicePdfToBuffer>[2],
  );
  const raw = buf.toString("latin1");
  assert.ok(raw.includes("NotoSansTC"), "expected Noto Sans TC to be embedded");
  const text = compact(await pdfText(buf));
  for (const snippet of [companyName, clientName, address, contact, "專業顧問服務", "繁體中文項目說明", "恒生銀行", "觀塘分行", "多謝惠顧", "嘅寫字樓喺創新中心"]) {
    assert.ok(text.includes(snippet), `invoice PDF text missing ${snippet}`);
  }
});

test("English invoice PDF does not embed the Chinese font", async () => {
  const invoice = {
    id: "i2",
    userId: "u1",
    clientId: "c1",
    invoiceNumber: "INV-EN",
    invoiceDate: "2026-04-14",
    dueDate: "2026-05-14",
    status: "draft",
    currency: "HKD",
    items: [{ name: "Professional services", description: "Sample line", quantity: 1, price: 100, taxRate: 0 }],
    subtotal: "100",
    discountAmount: "0",
    total: "100",
    paidAmount: "0",
    serviceCategory: "others",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const englishClient = { ...client, name: "Acme Ltd", contactPerson: "Alex Wong", addressLine1: "1 Test Road", addressLine2: null, country: "Hong Kong" };
  const englishSettings = {
    ...settings,
    companyName: "Gabriel Consultant Limited",
    addressLine1: "Suite E, 11/F",
    addressLine2: null,
    bankAccount1: { bankName: "HSBC", accountNumber: "123", accountName: "Gabriel Consultant Limited" },
    pdfDocumentLayouts: { invoice: { footerText: "Thank you for your business !" } },
  };
  const buf = await streamInvoicePdfToBuffer(
    invoice as unknown as Parameters<typeof streamInvoicePdfToBuffer>[0],
    englishClient as unknown as Parameters<typeof streamInvoicePdfToBuffer>[1],
    englishSettings as unknown as Parameters<typeof streamInvoicePdfToBuffer>[2],
  );
  assert.equal(buf.toString("latin1").includes("NotoSansTC"), false);
});

test("quotation PDF renders Traditional Chinese remarks, terms, and line details", async () => {
  const quotation = {
    id: "q1",
    userId: "u1",
    clientId: "c1",
    quotationNumber: "QT-2604026",
    quotationDate: "2026-04-02",
    validUntil: "2026-05-02",
    status: "draft",
    currency: "HKD",
    items: [
      {
        name: "報價項目",
        description: "系統認證顧問",
        details: "包括文件審閱及現場輔導",
        quantity: 1,
        price: 25000,
        taxRate: 0,
      },
    ],
    subtotal: "25000",
    discountAmount: "0",
    total: "25000",
    serviceCategory: "others",
    remark: "此報價單以繁體中文顯示。",
    termsConditions: "付款條件：接受報價後十四日內支付。",
    quotationAttn: "李小姐",
    shareToken: null,
    shareTokenExpiresAt: null,
    driveFileUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buf = await streamQuotationPdfToBuffer(
    quotation as unknown as Parameters<typeof streamQuotationPdfToBuffer>[0],
    client as unknown as Parameters<typeof streamQuotationPdfToBuffer>[1],
    settings as unknown as Parameters<typeof streamQuotationPdfToBuffer>[2],
  );
  assert.equal(countPdfPages(buf), 1, "quotation with Chinese bank details should stay on one page");
  const text = compact(await pdfText(buf));
  for (const snippet of [companyName, clientName, "系統認證顧問", "包括文件審閱及現場輔導", "此報價單以繁體中文顯示。", "付款條件：接受報價後十四日內支付。", "李小姐", "多謝查詢", "恒生銀行"]) {
    assert.ok(text.includes(snippet), `quotation PDF text missing ${snippet}`);
  }
});

test("receipt PDF renders Traditional Chinese payer, notes, and cheque details", async () => {
  const receipt = {
    id: "r1",
    userId: "u1",
    clientId: "c1",
    invoiceId: "i1",
    receiptNumber: "RC-2604014",
    amount: "18000",
    currency: "HKD",
    chequeNumber: "998877",
    chequeDetails: "支票抬頭請寫「加百列顧問有限公司」",
    receiptDate: "2026-04-20",
    notes: "已收妥顧問費",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const buf = await streamReceiptPdfToBuffer(
    receipt as unknown as Parameters<typeof streamReceiptPdfToBuffer>[0],
    { invoiceNumber: "INV-2604014" } as unknown as Parameters<typeof streamReceiptPdfToBuffer>[1],
    client as unknown as Parameters<typeof streamReceiptPdfToBuffer>[2],
    settings as unknown as Parameters<typeof streamReceiptPdfToBuffer>[3],
  );
  const text = compact(await pdfText(buf));
  for (const snippet of [companyName, clientName, address, "支票抬頭請寫「加百列顧問有限公司」", "已收妥顧問費", "此收據以繁體中文發出"]) {
    assert.ok(text.includes(snippet), `receipt PDF text missing ${snippet}`);
  }
});
