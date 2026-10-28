import assert from "node:assert/strict";
import { test } from "node:test";
import PDFDocument from "pdfkit";
import { drawInvoicePdfDoc } from "./invoicePdfDraw";
import { drawQuotationPdfDoc, drawReceiptPdfDoc } from "./quotationReceiptPdfDraw";
import { drawJobOrderPdfDoc } from "./jobOrderPdfDraw";

const sample = {
  invoiceNumber: "TEST-INV", quotationNumber: "TEST-QT", jobOrderNumber: "TEST-JO", receiptNumber: "TEST-RC",
  invoiceDate: "2026-09-21", quotationDate: "2026-09-21", jobDate: "2026-09-21", receiptDate: "2026-09-21",
  dueDate: "2026-10-05", currency: "HKD", amount: "100", total: "100", paidAmount: "0", subtotal: "100",
  items: [{ name: "Service", quantity: 1, price: 100, taxRate: 0 }],
};

for (const kind of ["invoice", "quotation", "jobOrder", "receipt"] as const) {
  for (const accent of kind === "receipt" ? [true, false] : [false]) {
    test(`${kind}${accent ? " accent" : ""}: heading and metadata move together in the PDF`, async (t) => {
      async function render(x: number, y: number) {
        const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
        doc.resume();
        const spy = t.mock.method(doc, "text");
        const settings = {
          companyName: "Example Company", pdfDocumentLayouts: {
            [kind]: { sectionOffsets: { showTitleBlock: { x, y } }, receipt: { showAccentHeader: accent } },
          },
        } as unknown as Parameters<typeof drawInvoicePdfDoc>[3];
        if (kind === "invoice") await drawInvoicePdfDoc(doc, sample as unknown as Parameters<typeof drawInvoicePdfDoc>[1], null, settings);
        if (kind === "quotation") await drawQuotationPdfDoc(doc, sample as unknown as Parameters<typeof drawQuotationPdfDoc>[1], null, settings);
        if (kind === "jobOrder") await drawJobOrderPdfDoc(doc, sample as unknown as Parameters<typeof drawJobOrderPdfDoc>[1], null, settings, null, null);
        if (kind === "receipt") await drawReceiptPdfDoc(doc, sample as unknown as Parameters<typeof drawReceiptPdfDoc>[1], null, null, settings);
        const calls = spy.mock.calls.map((call) => call.arguments as unknown as [string, number, number, { width?: number; align?: string }?]);
        // All title text is drawn before the first address or content label.
        const heading = { invoice: "INVOICE", quotation: "QUOTATION", jobOrder: "JOB ORDER", receipt: "RECEIPT" }[kind];
        const start = calls.findIndex(([text]) => text === heading);
        const count = kind === "jobOrder" ? 4 : kind === "receipt" ? (accent ? 5 : 4) : 3;
        doc.end();
        await new Promise<void>((resolve) => doc.on("end", resolve));
        return calls.slice(start, start + count);
      }
      const baseline = await render(0, 0);
      const moved = await render(-20, -32);
      assert.ok(baseline.length >= 3);
      for (let i = 0; i < baseline.length; i++) {
        assert.equal(moved[i][0], baseline[i][0]);
        assert.equal(moved[i][1], baseline[i][1] - 20);
        assert.equal(moved[i][2], baseline[i][2] - 32);
        if (baseline[i][3]?.align === "right") {
          assert.ok(typeof moved[i][3]?.width === "number", "right-aligned metadata needs an explicit width to move horizontally");
          assert.equal(moved[i][3]?.width, baseline[i][3]?.width);
        }
      }
    });
  }
}
