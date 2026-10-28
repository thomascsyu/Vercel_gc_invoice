/**
 * Default PDF Y for the document title block (INVOICE / QUOTATION / etc.)
 * before `sectionOffsets.showTitleBlock`. Shared by the document-layout
 * canvas (`artifacts/invoiceplane/src/lib/pdfLayoutGeometry.ts`) and the PDF
 * drawers (`artifacts/api-server/src/lib/pdfBrandingBand.ts`) so the two stay
 * in sync by construction rather than by comment.
 */
export function titleBlockBaseY(contentOffset: number): number {
  return contentOffset > 0 ? 10 + contentOffset : 45;
}
