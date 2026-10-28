/** Bottom margin used by PDF drawers (matches `PDFDocument({ margin: 50 })`). */
export const PDF_PAGE_BOTTOM_MARGIN_PT = 50;

/** Gap between the footer rule and footer copy. */
export const PDF_FOOTER_LINE_TO_TEXT_GAP_PT = 8;

type FooterMeasureDoc = {
  page: { height: number };
  heightOfString: (text: string, options?: { width?: number }) => number;
};

/**
 * Place footer copy fully above the PDF bottom margin so PDFKit does not auto-add a blank page.
 * Returns Y positions for the horizontal rule and the text block.
 */
export function pdfFooterLineAndTextY(
  doc: FooterMeasureDoc,
  footerCopy: string,
  contentW: number,
  opts?: { lineToTextGap?: number; bottomMargin?: number; offsetY?: number },
): { lineY: number; textY: number; bandHeight: number } {
  const gap = opts?.lineToTextGap ?? PDF_FOOTER_LINE_TO_TEXT_GAP_PT;
  const bottomMargin = opts?.bottomMargin ?? PDF_PAGE_BOTTOM_MARGIN_PT;
  const offsetY = opts?.offsetY ?? 0;
  const textH = doc.heightOfString(footerCopy, { width: contentW });
  /** PDFKit adds a page when the text baseline is within ~1pt of the bottom margin. */
  const bottomSafetyPt = 1;
  const maxTextBottom = doc.page.height - bottomMargin - bottomSafetyPt;
  const textY = maxTextBottom - textH + offsetY;
  const lineY = textY - gap;
  return { lineY, textY, bandHeight: gap + textH };
}
