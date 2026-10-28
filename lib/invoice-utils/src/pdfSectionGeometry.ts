import { titleBlockBaseY } from "./pdfTitleBlock";

/**
 * Shared page geometry for PDF layout sections, used by both the
 * document-layouts WYSIWYG canvas (`artifacts/invoiceplane/src/lib/pdfLayoutGeometry.ts`)
 * and the server-side layout profile validation
 * (`artifacts/api-server/src/lib/pdfLayoutProfile.ts`) so a stored section
 * offset can be checked against the same page-edge bounds the canvas itself
 * enforces while dragging.
 *
 * Units are PDF points (1pt = 1/72 inch). A4 = 595 × 842 pt.
 */

export const A4_WIDTH_PT = 595;
export const A4_HEIGHT_PT = 842;
export const PAGE_MARGIN_PT = 50;

export const CONTENT_WIDTH_PT = A4_WIDTH_PT - PAGE_MARGIN_PT * 2;

/** Matches PDF drawers (`pdfBrandingBand.ts`). */
export const COMPANY_LOGO_BASE_W_PT = 120;
export const COMPANY_LOGO_BASE_H_PT = 45;
export const HEADER_BANNER_BASE_H_PT = 55;
export const BRANDING_BAND_GAP_PT = 8;

/** Stored as 1–2 (100%–200%); invalid values default to 1. */
export function brandingScaleFactor(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(1, n));
}

/**
 * Header banner width as a fraction of the full content width (0.25–1, i.e.
 * 25%–100%); invalid values default to 1 (today's full-width behavior).
 * Lets the banner be narrowed enough to sit beside the company logo on the
 * same row instead of only stacking full-width below it.
 */
export function headerBannerWidthScaleFactor(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0.25, n));
}

/**
 * Layout width of the header banner block on PDFs and the document-layout canvas.
 * Capped by content width × {@link headerBannerWidthScaleFactor}; when
 * `headerBannerAspectRatio` (image width ÷ height) is known, shrinks to the width
 * needed at the configured banner height so the box matches visible artwork.
 */
export function headerBannerLayoutWidthPt(opts: {
  headerLogoWidthScale?: unknown;
  headerLogoScale?: unknown;
  headerBannerAspectRatio?: number | null;
}): number {
  const maxW = CONTENT_WIDTH_PT * headerBannerWidthScaleFactor(opts.headerLogoWidthScale);
  const headerH = HEADER_BANNER_BASE_H_PT * brandingScaleFactor(opts.headerLogoScale);
  const ar = opts.headerBannerAspectRatio;
  if (typeof ar === "number" && Number.isFinite(ar) && ar > 0) {
    return Math.min(maxW, Math.max(1, headerH * ar));
  }
  return maxW;
}

/** Content offset for stacked branding (matches `pdfBrandingBand.ts`). */
export function layoutBrandingContentOffset(opts: {
  showLogoRow: boolean;
  showHeaderBannerLogo: boolean;
  hasCompanyLogo?: boolean;
  hasHeaderLogo?: boolean;
  companyLogoScale?: unknown;
  headerLogoScale?: unknown;
}): number {
  return layoutBrandingEffectiveContentOffset({ ...opts, offLogoY: 0, offHeaderBannerY: 0 });
}

/**
 * Vertical space below y=10 for title/billing, including logo and header banner
 * section Y offsets. When the header banner is dragged up beside the company logo,
 * this is less than the stacked {@link layoutBrandingContentOffset} (matches PDF drawers).
 */
export function layoutBrandingEffectiveContentOffset(opts: {
  showLogoRow: boolean;
  showHeaderBannerLogo: boolean;
  hasCompanyLogo?: boolean;
  hasHeaderLogo?: boolean;
  companyLogoScale?: unknown;
  headerLogoScale?: unknown;
  offLogoY?: number;
  offHeaderBannerY?: number;
}): number {
  const logoRowH = COMPANY_LOGO_BASE_H_PT * brandingScaleFactor(opts.companyLogoScale);
  const headerBannerH = HEADER_BANNER_BASE_H_PT * brandingScaleFactor(opts.headerLogoScale);
  const hasCompanyLogo = opts.hasCompanyLogo !== false;
  const hasHeaderLogo = opts.hasHeaderLogo !== false;
  const offLogoY = opts.offLogoY ?? 0;
  const offHeaderBannerY = opts.offHeaderBannerY ?? 0;
  const logoRowInset =
    opts.showLogoRow && hasCompanyLogo ? logoRowH + BRANDING_BAND_GAP_PT : 0;

  let maxBottom = 10;
  if (opts.showLogoRow && hasCompanyLogo) {
    maxBottom = Math.max(maxBottom, 10 + offLogoY + logoRowH);
  }
  if (opts.showHeaderBannerLogo && hasHeaderLogo) {
    maxBottom = Math.max(maxBottom, 10 + logoRowInset + offHeaderBannerY + headerBannerH);
  }
  if (maxBottom <= 10) return 0;
  return maxBottom - 10 + BRANDING_BAND_GAP_PT;
}

export type DocKind = "invoice" | "quotation" | "jobOrder" | "receipt";

export type LayoutSectionKey =
  | "showLogoRow"
  | "showHeaderBannerLogo"
  | "showTitleBlock"
  | "showBillingBlock"
  | "jobOrderConsultants"
  | "lineItems"
  | "showTotals"
  | "showBankAccounts"
  | "showSignatures"
  | "quotationExtra"
  | "showFooterAddress"
  | "showPaymentAdvicePage";

export interface SectionRect {
  /** PDF points from page left (after margin). */
  x: number;
  /** PDF points from page top. */
  y: number;
  /** PDF points wide. */
  w: number;
  /** PDF points tall. */
  h: number;
}

/**
 * Band height for the job-order consultants block on the layout canvas (~label + up to 3 name rows;
 * matches stacked one-name-per-row PDF output).
 */
export const JOB_ORDER_CONSULTANTS_BAND_H_PT = 52;
/**
 * Extra vertical gap between the billing block and the line-items table on job-order layouts
 * when the consultants block is shown. Consultants render in the right column alongside the
 * client block, so this reserve is zero; kept for API compatibility with older canvas code.
 */
export const JOB_ORDER_CONSULTANTS_RESERVE_PT = 0;

/**
 * Default section rectangles (before user offsets) for each document kind.
 *
 * Sizes are *typical* defaults; e.g. line-items height assumes ~6 rows so the
 * canvas reflects a realistic stack. The drawers themselves grow / shrink
 * dynamically — this is an approximation used for the canvas preview and for
 * bounding stored offsets to sane page-edge limits.
 */
export function defaultSectionRects(
  kind: DocKind,
  opts?: {
    jobOrderConsultantsReservePt?: number;
    companyLogoScale?: unknown;
    headerLogoScale?: unknown;
    /** Header banner width as a fraction of content width (0.25–1); defaults to 1 (full width). */
    headerLogoWidthScale?: unknown;
    /** When false, title Y ignores logo row height (matches PDF when section hidden). */
    showLogoRow?: boolean;
    showHeaderBannerLogo?: boolean;
    hasCompanyLogo?: boolean;
    hasHeaderLogo?: boolean;
    /** Receipt layout: taller title band when accent header is enabled. */
    receiptAccentHeader?: boolean;
    /** Section Y offsets for branding blocks (matches saved document layouts). */
    offLogoY?: number;
    offHeaderBannerY?: number;
    /** Header image width ÷ height; shrinks layout width to visible artwork. */
    headerBannerAspectRatio?: number | null;
  },
): Partial<Record<LayoutSectionKey, SectionRect>> {
  const left = PAGE_MARGIN_PT;
  const right = A4_WIDTH_PT - PAGE_MARGIN_PT;
  const halfW = CONTENT_WIDTH_PT / 2;

  const showLogoRow = opts?.showLogoRow !== false;
  const showHeaderBannerLogo = opts?.showHeaderBannerLogo !== false;

  const logoRowH = COMPANY_LOGO_BASE_H_PT * brandingScaleFactor(opts?.companyLogoScale);
  const headerBannerH = HEADER_BANNER_BASE_H_PT * brandingScaleFactor(opts?.headerLogoScale);
  const contentOffset = layoutBrandingEffectiveContentOffset({
    showLogoRow,
    showHeaderBannerLogo,
    hasCompanyLogo: opts?.hasCompanyLogo,
    hasHeaderLogo: opts?.hasHeaderLogo,
    companyLogoScale: opts?.companyLogoScale,
    headerLogoScale: opts?.headerLogoScale,
    offLogoY: opts?.offLogoY,
    offHeaderBannerY: opts?.offHeaderBannerY,
  });
  const billingBlockH = 72; // Bill To + 4 structured address rows + padding (matches PDF drawers)
  const jobOrderConsultantsReserve =
    kind === "jobOrder"
      ? Math.max(0, opts?.jobOrderConsultantsReservePt ?? JOB_ORDER_CONSULTANTS_RESERVE_PT)
      : 0;
  const lineItemsH = 168; // header + 6 rows × 22pt approx
  const totalsH = 60;
  const bankAccountsH = 110; // 1 bank ~7 rows of 13pt + footer notice
  const signaturesH = 70;
  /**
   * Reduced from the "no title block" baseline (130) by exactly `titleStripH`
   * so inserting the title block doesn't push the quotation stack's bottom
   * edge closer to the footer than before.
   */
  const quotationExtraH = 90;
  const footerAddressH = 28;
  /** Invoice payment advice: header + meta + amount + short bank lines + reference (~PDF footprint). */
  const paymentAdviceH = 200;

  // Vertical stack y-positions, mirroring the drawers' baseline math.
  const logoY = 10;
  const logoRowInset =
    showLogoRow && opts?.hasCompanyLogo !== false ? logoRowH + BRANDING_BAND_GAP_PT : 0;
  const headerBannerY = logoY + logoRowInset;
  const titleStripH = kind === "receipt" && opts?.receiptAccentHeader !== false ? 80 : 40;
  const titleY = titleBlockBaseY(contentOffset);
  const billingY = Math.max(110, titleY + titleStripH);
  const lineItemsY = billingY + billingBlockH + 20 + jobOrderConsultantsReserve;
  const totalsY = lineItemsY + lineItemsH + 8;
  const bankY = totalsY + totalsH + 16;
  const signaturesY = bankY; // signatures live on right column at bank level
  const quotationExtraY = bankY + bankAccountsH + 16;
  /** Footer rule sits above bottom margin + wrapped footer copy (matches pdfFooterPosition). */
  const footerY = A4_HEIGHT_PT - PAGE_MARGIN_PT - footerAddressH - 8;
  /** Bottom-aligned payment advice (50 pt bottom margin, matches invoice PDF). */
  const paymentAdviceY = A4_HEIGHT_PT - PAGE_MARGIN_PT - paymentAdviceH;

  /**
   * Job order PDFs draw the client block in the left column only (`contentW/2`,
   * matching `addrValueW` in jobOrderPdfDraw.ts) — the right column is reserved
   * for the consultants / issuer block. Other kinds have no right-column
   * neighbor at this row, so the bill-to block spans the full content width.
   */
  const billingBlockW = kind === "jobOrder" ? halfW : CONTENT_WIDTH_PT;

  const headerBannerW = headerBannerLayoutWidthPt({
    headerLogoWidthScale: opts?.headerLogoWidthScale,
    headerLogoScale: opts?.headerLogoScale,
    headerBannerAspectRatio: opts?.headerBannerAspectRatio,
  });

  const base: Partial<Record<LayoutSectionKey, SectionRect>> = {
    showLogoRow: { x: left, y: logoY, w: COMPANY_LOGO_BASE_W_PT * brandingScaleFactor(opts?.companyLogoScale), h: logoRowH },
    showHeaderBannerLogo: { x: left, y: headerBannerY, w: headerBannerW, h: headerBannerH },
    showTitleBlock: { x: left, y: titleY, w: CONTENT_WIDTH_PT, h: titleStripH },
    showBillingBlock: { x: left, y: billingY, w: billingBlockW, h: billingBlockH },
    lineItems: { x: left, y: lineItemsY, w: CONTENT_WIDTH_PT, h: lineItemsH },
    showTotals: { x: left, y: totalsY, w: CONTENT_WIDTH_PT, h: totalsH },
    showFooterAddress: { x: left, y: footerY, w: CONTENT_WIDTH_PT, h: footerAddressH },
  };

  if (kind === "invoice") {
    base.showBankAccounts = { x: left, y: bankY, w: halfW, h: bankAccountsH };
    base.showSignatures = { x: left + halfW, y: signaturesY, w: halfW, h: signaturesH };
    base.showPaymentAdvicePage = { x: left, y: paymentAdviceY, w: CONTENT_WIDTH_PT, h: paymentAdviceH };
  } else if (kind === "quotation") {
    base.quotationExtra = { x: left, y: quotationExtraY, w: CONTENT_WIDTH_PT, h: quotationExtraH };
    base.showSignatures = { x: left + halfW, y: signaturesY, w: halfW, h: signaturesH };
    base.showBankAccounts = { x: left, y: bankY, w: halfW, h: bankAccountsH };
  } else if (kind === "jobOrder") {
    base.jobOrderConsultants = {
      x: left + halfW,
      y: billingY,
      w: halfW,
      h: Math.max(JOB_ORDER_CONSULTANTS_BAND_H_PT, billingBlockH),
    };
    base.showSignatures = { x: left + halfW, y: signaturesY, w: halfW, h: signaturesH };
  } else {
    // Receipt: no bank/signature block in the editor's lane set
    void right;
  }

  return base;
}

/** Allowed nudge range so `baseRect + offset` stays on the A4 page. */
export function sectionOffsetBounds(rect: SectionRect): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: -rect.x,
    maxX: A4_WIDTH_PT - rect.x - rect.w,
    minY: -rect.y,
    maxY: A4_HEIGHT_PT - rect.y - rect.h,
  };
}
