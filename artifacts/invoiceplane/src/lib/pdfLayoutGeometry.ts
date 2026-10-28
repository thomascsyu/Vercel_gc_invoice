/**
 * Approximate geometry for the document-layouts WYSIWYG canvas.
 *
 * The section-rectangle math mirrors the default placements used by the PDF
 * drawers (`artifacts/api-server/src/lib/invoicePdfDraw.ts`,
 *  `quotationReceiptPdfDraw.ts`, `jobOrderPdfDraw.ts`) and lives in
 * `@workspace/invoice-utils` so the server can bound stored offsets against
 * the same page-edge limits this canvas enforces while dragging. This file
 * re-exports that shared geometry and adds the canvas-only concerns (px
 * conversion, snap grid, section labels).
 */
import {
  sectionOffsetBounds,
  type DocKind,
  type LayoutSectionKey,
  type SectionRect,
} from "@workspace/invoice-utils";

export {
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  PAGE_MARGIN_PT,
  CONTENT_WIDTH_PT,
  COMPANY_LOGO_BASE_W_PT,
  COMPANY_LOGO_BASE_H_PT,
  HEADER_BANNER_BASE_H_PT,
  BRANDING_BAND_GAP_PT,
  JOB_ORDER_CONSULTANTS_BAND_H_PT,
  JOB_ORDER_CONSULTANTS_RESERVE_PT,
  brandingScaleFactor,
  headerBannerWidthScaleFactor,
  headerBannerLayoutWidthPt,
  layoutBrandingContentOffset,
  layoutBrandingEffectiveContentOffset,
  defaultSectionRects,
  sectionOffsetBounds,
  titleBlockBaseY,
  type DocKind,
  type LayoutSectionKey,
  type SectionRect,
} from "@workspace/invoice-utils";

/**
 * Visual scale factor: 1 PDF point → N CSS pixels on the canvas.
 * Matches the existing `VISUAL_PT_SCALE` so saved offsets feel familiar.
 */
export const VISUAL_PT_SCALE = 0.42;

/** PDF points per snap step (matches today's editor). */
export const SNAP_GRID_PT = 8;

function clampAxis(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(min, Math.min(max, n)));
}

/** Clamp a section offset using page-edge bounds for the section's base rectangle. */
export function clampSectionOffset(
  off: { x: number; y: number },
  rect: SectionRect,
): { x: number; y: number } {
  const b = sectionOffsetBounds(rect);
  return {
    x: clampAxis(off.x, b.minX, b.maxX),
    y: clampAxis(off.y, b.minY, b.maxY),
  };
}

/** Snap to grid then clamp to page-edge bounds. */
export function snapSectionOffset(
  off: { x: number; y: number },
  rect: SectionRect,
): { x: number; y: number } {
  const snap = (n: number) => {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n / SNAP_GRID_PT) * SNAP_GRID_PT;
  };
  return clampSectionOffset({ x: snap(off.x), y: snap(off.y) }, rect);
}

/** Fallback max nudge when page-edge bounds are unavailable (PDF points). */
export const MAX_SECTION_OFFSET_PT = 400;

/** Convert PDF points → CSS pixels for the canvas. */
export const ptToPx = (pt: number) => pt * VISUAL_PT_SCALE;

/** Default top-to-bottom lane order for the editor surface, per kind. */
export function laneOrder(kind: DocKind): LayoutSectionKey[] {
  if (kind === "invoice") {
    return [
      "showLogoRow",
      "showHeaderBannerLogo",
      "showTitleBlock",
      "showBillingBlock",
      "lineItems",
      "showTotals",
      "showBankAccounts",
      "showSignatures",
      "showFooterAddress",
      "showPaymentAdvicePage",
    ];
  }
  if (kind === "quotation") {
    return [
      "showLogoRow",
      "showHeaderBannerLogo",
      "showTitleBlock",
      "showBillingBlock",
      "lineItems",
      "showTotals",
      "showBankAccounts",
      "quotationExtra",
      "showSignatures",
      "showFooterAddress",
    ];
  }
  if (kind === "jobOrder") {
    return [
      "showLogoRow",
      "showHeaderBannerLogo",
      "showTitleBlock",
      "showBillingBlock",
      "jobOrderConsultants",
      "lineItems",
      "showTotals",
      "showSignatures",
      "showFooterAddress",
    ];
  }
  return [
    "showLogoRow",
    "showHeaderBannerLogo",
    "showTitleBlock",
    "showBillingBlock",
    "lineItems",
    "showTotals",
    "showFooterAddress",
  ];
}

/** Snap a point (PDF points) to the nearest grid step, clamped to ±MAX_SECTION_OFFSET_PT. */
export function snapPoint(p: { x: number; y: number }): { x: number; y: number } {
  const snap = (n: number) => {
    if (!Number.isFinite(n)) return 0;
    const r = Math.round(n / SNAP_GRID_PT) * SNAP_GRID_PT;
    return Math.max(-MAX_SECTION_OFFSET_PT, Math.min(MAX_SECTION_OFFSET_PT, Math.round(r)));
  };
  return { x: snap(p.x), y: snap(p.y) };
}

/** Clamp without snapping (during drag), using ±MAX_SECTION_OFFSET_PT. */
export function clampPoint(p: { x: number; y: number }): { x: number; y: number } {
  const c = (n: number) => {
    if (!Number.isFinite(n)) return 0;
    return Math.max(-MAX_SECTION_OFFSET_PT, Math.min(MAX_SECTION_OFFSET_PT, Math.round(n)));
  };
  return { x: c(p.x), y: c(p.y) };
}

/** Display label for each section. */
export const SECTION_LABEL: Record<LayoutSectionKey, string> = {
  showLogoRow: "Company logo row",
  showHeaderBannerLogo: "Header banner image",
  showTitleBlock: "Document title, number & date",
  showBillingBlock: "Bill-to / address block",
  jobOrderConsultants: "Consultants line",
  lineItems: "Line items table",
  showTotals: "Total",
  showBankAccounts: "Bank / payment details",
  showSignatures: "Signature block",
  quotationExtra: "Remarks, terms & signatures (quotation)",
  showFooterAddress: "Footer line",
  showPaymentAdvicePage: "Payment advice (optional footer block on invoice page 1)",
};
