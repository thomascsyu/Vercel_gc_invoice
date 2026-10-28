/**
 * Pure geometry helpers for `A4LayoutCanvas`. Extracted so they can be tested
 * without instantiating React.
 */
import {
  defaultSectionRects,
  laneOrder,
  ptToPx,
  type DocKind,
  type LayoutSectionKey,
} from "@/lib/pdfLayoutGeometry";
import type { PdfSectionOffsetPoint } from "@/lib/modulesApi";

export interface BlockGeom {
  key: LayoutSectionKey;
  /** CSS px from canvas left, after applying offsets. */
  left: number;
  /** CSS px from canvas top, after applying offsets. */
  top: number;
  width: number;
  height: number;
  /** Rectangle without offsets — used for alignment guides. */
  baseLeft: number;
  baseTop: number;
  hidden: boolean;
}

const SECTION_HIDABLE: Partial<Record<LayoutSectionKey, true>> = {
  showLogoRow: true,
  showHeaderBannerLogo: true,
  showTitleBlock: true,
  showBillingBlock: true,
  jobOrderConsultants: true,
  showTotals: true,
  showBankAccounts: true,
  showSignatures: true,
  showFooterAddress: true,
  showPaymentAdvicePage: true,
};

/** Section is "hidden" only if user toggled it off (and the section is hidable). */
export function isHidden(
  key: LayoutSectionKey,
  toggles: Record<string, boolean | undefined>,
): boolean {
  if (!SECTION_HIDABLE[key]) return false;
  return toggles[key] === false;
}

/** Compute current rectangles in CSS pixels for layout + collision. */
export function computeBlocks(
  kind: DocKind,
  toggles: Record<string, boolean | undefined>,
  offsets: Partial<Record<LayoutSectionKey, PdfSectionOffsetPoint>>,
  branding?: {
    companyLogoScale?: unknown;
    headerLogoScale?: unknown;
    headerLogoWidthScale?: unknown;
    receiptAccentHeader?: boolean;
    hasCompanyLogo?: boolean;
    hasHeaderLogo?: boolean;
    headerBannerAspectRatio?: number | null;
  },
): BlockGeom[] {
  const jobOrderConsultantsOn =
    kind === "jobOrder" && toggles.jobOrderConsultants !== false && toggles.showConsultantsLine !== false;
  const rects = defaultSectionRects(kind, {
    jobOrderConsultantsReservePt: kind === "jobOrder" && !jobOrderConsultantsOn ? 0 : undefined,
    companyLogoScale: branding?.companyLogoScale,
    headerLogoScale: branding?.headerLogoScale,
    headerLogoWidthScale: branding?.headerLogoWidthScale,
    showLogoRow: toggles.showLogoRow !== false,
    showHeaderBannerLogo: toggles.showHeaderBannerLogo !== false,
    hasCompanyLogo: branding?.hasCompanyLogo,
    hasHeaderLogo: branding?.hasHeaderLogo,
    receiptAccentHeader: branding?.receiptAccentHeader,
    offLogoY: offsets.showLogoRow?.y ?? 0,
    offHeaderBannerY: offsets.showHeaderBannerLogo?.y ?? 0,
    headerBannerAspectRatio: branding?.headerBannerAspectRatio,
  });
  const lanes = laneOrder(kind);
  const out: BlockGeom[] = [];
  for (const key of lanes) {
    const r = rects[key];
    if (!r) continue;
    const off = offsets[key] ?? { x: 0, y: 0 };
    const baseLeft = ptToPx(r.x);
    const baseTop = ptToPx(r.y);
    const left = baseLeft + ptToPx(off.x);
    const top = baseTop + ptToPx(off.y);
    out.push({
      key,
      left,
      top,
      width: ptToPx(r.w),
      height: ptToPx(r.h),
      baseLeft,
      baseTop,
      hidden: isHidden(key, toggles),
    });
  }
  return out;
}

/**
 * Pixel tolerance for overlap comparisons. Blocks that are meant to sit exactly
 * side-by-side (e.g. two half-width columns) can differ by a fraction of a
 * pixel purely from floating-point rounding in `ptToPx`; without this, that
 * rounding noise flags them as "overlapping" even when just touching.
 */
const COLLISION_EPSILON_PX = 0.5;

/** Detect overlapping pairs (axis-aligned bounding boxes). */
export function detectCollisions(blocks: BlockGeom[]): Set<LayoutSectionKey> {
  const hits = new Set<LayoutSectionKey>();
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    if (a.hidden) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      if (b.hidden) continue;
      const overlapX =
        a.left < b.left + b.width - COLLISION_EPSILON_PX && b.left < a.left + a.width - COLLISION_EPSILON_PX;
      const overlapY =
        a.top < b.top + b.height - COLLISION_EPSILON_PX && b.top < a.top + a.height - COLLISION_EPSILON_PX;
      if (overlapX && overlapY) {
        hits.add(a.key);
        hits.add(b.key);
      }
    }
  }
  return hits;
}

export interface ActiveGuide {
  axis: "x" | "y";
  /** CSS pixel position relative to the canvas surface. */
  pos: number;
}

/** Compute alignment guides while a block is being dragged. */
export function computeGuides(
  active: BlockGeom,
  others: BlockGeom[],
  pageW: number,
  pageH: number,
): ActiveGuide[] {
  const out: ActiveGuide[] = [];
  const activeEdges = {
    left: active.left,
    centerX: active.left + active.width / 2,
    right: active.left + active.width,
    top: active.top,
    centerY: active.top + active.height / 2,
    bottom: active.top + active.height,
  };
  const candidatesX: { pos: number }[] = [
    { pos: pageW / 2 },
    { pos: active.baseLeft },
    { pos: active.baseLeft + active.width },
  ];
  const candidatesY: { pos: number }[] = [
    { pos: pageH / 2 },
    { pos: active.baseTop },
    { pos: active.baseTop + active.height },
  ];
  for (const o of others) {
    candidatesX.push({ pos: o.left });
    candidatesX.push({ pos: o.left + o.width });
    candidatesY.push({ pos: o.top });
    candidatesY.push({ pos: o.top + o.height });
  }

  const TOL = 2; // px
  for (const c of candidatesX) {
    if (
      Math.abs(activeEdges.left - c.pos) <= TOL ||
      Math.abs(activeEdges.centerX - c.pos) <= TOL ||
      Math.abs(activeEdges.right - c.pos) <= TOL
    ) {
      out.push({ axis: "x", pos: c.pos });
    }
  }
  for (const c of candidatesY) {
    if (
      Math.abs(activeEdges.top - c.pos) <= TOL ||
      Math.abs(activeEdges.centerY - c.pos) <= TOL ||
      Math.abs(activeEdges.bottom - c.pos) <= TOL
    ) {
      out.push({ axis: "y", pos: c.pos });
    }
  }
  return out;
}
