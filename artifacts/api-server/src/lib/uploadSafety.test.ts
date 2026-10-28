import assert from "node:assert/strict";
import test from "node:test";
import {
  contentDispositionAttachment,
  isAllowedPaymentReceiptMime,
  sanitizeDownloadFileName,
} from "./uploadSafety";

test("payment receipt MIME allowlist accepts images and PDFs only", () => {
  assert.equal(isAllowedPaymentReceiptMime("application/pdf"), true);
  assert.equal(isAllowedPaymentReceiptMime("image/png"), true);
  assert.equal(isAllowedPaymentReceiptMime("image/jpeg; charset=binary"), true);
  assert.equal(isAllowedPaymentReceiptMime("application/x-msdownload"), false);
  assert.equal(isAllowedPaymentReceiptMime("text/html"), false);
  assert.equal(isAllowedPaymentReceiptMime(""), false);
});

test("download filenames cannot inject quotes or newlines into Content-Disposition", () => {
  assert.equal(sanitizeDownloadFileName('invoice.pdf'), "invoice.pdf");
  assert.equal(sanitizeDownloadFileName('evil\r\nLocation: x"'), "evil__Location: x_");
  assert.equal(contentDispositionAttachment('a"b.pdf'), 'attachment; filename="a_b.pdf"');
});
