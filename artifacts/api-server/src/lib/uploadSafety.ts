const ALLOWED_PAYMENT_RECEIPT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function isAllowedPaymentReceiptMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return ALLOWED_PAYMENT_RECEIPT_MIME.has(mimeType.toLowerCase().split(";")[0]!.trim());
}

/** Strip CR/LF/quotes so a stored filename cannot break Content-Disposition. */
export function sanitizeDownloadFileName(fileName: string, fallback = "download"): string {
  const cleaned = fileName.replace(/[\r\n"]/g, "_").replace(/[^\x20-\x7E]/g, "_").trim();
  return cleaned.slice(0, 200) || fallback;
}

export function contentDispositionAttachment(fileName: string): string {
  return `attachment; filename="${sanitizeDownloadFileName(fileName)}"`;
}
