import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  BRANDING_BAND_GAP_PT,
  COMPANY_LOGO_BASE_H_PT,
  CONTENT_WIDTH_PT,
  HEADER_BANNER_BASE_H_PT,
  MAX_SECTION_OFFSET_PT,
  PAGE_MARGIN_PT,
  SNAP_GRID_PT,
  VISUAL_PT_SCALE,
  clampPoint,
  clampSectionOffset,
  defaultSectionRects,
  headerBannerWidthScaleFactor,
  headerBannerLayoutWidthPt,
  laneOrder,
  layoutBrandingContentOffset,
  layoutBrandingEffectiveContentOffset,
  ptToPx,
  sectionOffsetBounds,
  snapPoint,
  titleBlockBaseY,
} from "./pdfLayoutGeometry.ts";

describe("pdfLayoutGeometry", () => {
  describe("constants", () => {
    it("matches A4 in PDF points", () => {
      assert.equal(A4_WIDTH_PT, 595);
      assert.equal(A4_HEIGHT_PT, 842);
      assert.equal(CONTENT_WIDTH_PT, A4_WIDTH_PT - PAGE_MARGIN_PT * 2);
    });

    it("snap grid is 8 PDF points", () => {
      assert.equal(SNAP_GRID_PT, 8);
    });

    it("visual scale is positive", () => {
      assert.ok(VISUAL_PT_SCALE > 0);
      assert.equal(ptToPx(100), 100 * VISUAL_PT_SCALE);
    });
  });

  describe("snapPoint", () => {
    it("snaps to the nearest 8-pt grid step", () => {
      assert.deepEqual(snapPoint({ x: 0, y: 0 }), { x: 0, y: 0 });
      assert.deepEqual(snapPoint({ x: 7, y: -7 }), { x: 8, y: -8 });
      assert.deepEqual(snapPoint({ x: 12, y: 4 }), { x: 16, y: 8 });
      assert.deepEqual(snapPoint({ x: 11.9, y: -3.1 }), { x: 8, y: -0 });
    });

    it("clamps to the ±MAX_SECTION_OFFSET_PT range (fallback)", () => {
      const huge = MAX_SECTION_OFFSET_PT + 500;
      assert.deepEqual(snapPoint({ x: huge, y: -huge }), {
        x: MAX_SECTION_OFFSET_PT,
        y: -MAX_SECTION_OFFSET_PT,
      });
    });

    it("returns zeros for non-finite input", () => {
      assert.deepEqual(snapPoint({ x: NaN, y: Infinity }), { x: 0, y: 0 });
    });
  });

  describe("clampPoint", () => {
    it("clamps without snapping", () => {
      assert.deepEqual(clampPoint({ x: 12.4, y: -3.6 }), { x: 12, y: -4 });
    });

    it("clamps to range", () => {
      const huge = MAX_SECTION_OFFSET_PT + 999;
      assert.deepEqual(clampPoint({ x: huge, y: -huge }), {
        x: MAX_SECTION_OFFSET_PT,
        y: -MAX_SECTION_OFFSET_PT,
      });
    });
  });

  describe("defaultSectionRects", () => {
    it("provides rects for every lane in invoice", () => {
      const rects = defaultSectionRects("invoice");
      for (const k of laneOrder("invoice")) {
        const r = rects[k];
        assert.ok(r, `expected rect for ${k}`);
        assert.ok(r!.w > 0 && r!.h > 0, `rect ${k} must have positive size`);
      }
    });

    it("provides rects for every lane in quotation/jobOrder/receipt", () => {
      for (const kind of ["quotation", "jobOrder", "receipt"] as const) {
        const rects = defaultSectionRects(kind);
        for (const k of laneOrder(kind)) {
          assert.ok(rects[k], `${kind}: expected rect for ${k}`);
        }
      }
    });

    it("exposes payment advice rect for invoice canvas only", () => {
      const inv = defaultSectionRects("invoice").showPaymentAdvicePage;
      assert.ok(inv && inv.w > 0 && inv.h > 0);
      assert.equal(defaultSectionRects("quotation").showPaymentAdvicePage, undefined);
    });

    it("job order bill-to block is left-column width only, matching jobOrderPdfDraw.ts's addrValueW column and leaving the right column free for consultants", () => {
      const rects = defaultSectionRects("jobOrder");
      const billing = rects.showBillingBlock!;
      const consultants = rects.jobOrderConsultants!;
      assert.equal(billing.w, CONTENT_WIDTH_PT / 2);
      assert.ok(
        billing.x + billing.w <= consultants.x,
        "bill-to block must not extend into the consultants column",
      );
    });

    it("other kinds keep the full-width bill-to block (no right-column neighbor at that row)", () => {
      for (const kind of ["invoice", "quotation", "receipt"] as const) {
        assert.equal(defaultSectionRects(kind).showBillingBlock!.w, CONTENT_WIDTH_PT);
      }
    });

    it("receipt title strip defaults to the 80pt accent band when showAccentHeader is unset, matching quotationReceiptPdfDraw.ts's `!== false` default", () => {
      const withUnsetFlag = defaultSectionRects("receipt", { receiptAccentHeader: undefined });
      const withAccentOn = defaultSectionRects("receipt", { receiptAccentHeader: true });
      const withAccentOff = defaultSectionRects("receipt", { receiptAccentHeader: false });
      assert.equal(withUnsetFlag.showBillingBlock!.y, withAccentOn.showBillingBlock!.y);
      assert.ok(withAccentOff.showBillingBlock!.y < withAccentOn.showBillingBlock!.y);
    });

    it("places rects within A4 page bounds", () => {
      for (const kind of ["invoice", "quotation", "jobOrder", "receipt"] as const) {
        const rects = defaultSectionRects(kind);
        for (const [k, r] of Object.entries(rects)) {
          if (!r) continue;
          assert.ok(r.x >= 0, `${kind}/${k}: x must be ≥ 0`);
          assert.ok(r.y >= 0, `${kind}/${k}: y must be ≥ 0`);
          assert.ok(r.x + r.w <= A4_WIDTH_PT + 1, `${kind}/${k}: right edge must fit page`);
          assert.ok(
            r.y + r.h <= A4_HEIGHT_PT + 1,
            `${kind}/${k}: bottom edge must fit page (got ${r.y + r.h})`,
          );
        }
      }
    });

    it("grows the logo and header bands when branding scale is above 100%", () => {
      const base = defaultSectionRects("invoice");
      const scaled = defaultSectionRects("invoice", {
        companyLogoScale: 1.7,
        headerLogoScale: 1.1,
      });
      assert.ok(scaled.showLogoRow!.h > base.showLogoRow!.h);
      assert.ok(scaled.showHeaderBannerLogo!.h > base.showHeaderBannerLogo!.h);
      assert.ok(
        scaled.showTitleBlock!.y > base.showTitleBlock!.y,
        "title block must shift down so it clears stacked scaled logos",
      );
      assert.ok(scaled.showHeaderBannerLogo!.y > scaled.showLogoRow!.y + scaled.showLogoRow!.h);
    });

    it("defaults header banner width to full content width", () => {
      const rects = defaultSectionRects("invoice");
      assert.equal(rects.showHeaderBannerLogo!.w, CONTENT_WIDTH_PT);
    });

    it("narrows the header banner width and widens its drag bounds so it can sit beside the company logo", () => {
      const full = defaultSectionRects("invoice");
      const narrowed = defaultSectionRects("invoice", { headerLogoWidthScale: 0.25 });
      assert.equal(narrowed.showHeaderBannerLogo!.w, CONTENT_WIDTH_PT * 0.25);

      const fullBounds = sectionOffsetBounds(full.showHeaderBannerLogo!);
      const narrowedBounds = sectionOffsetBounds(narrowed.showHeaderBannerLogo!);
      assert.ok(
        narrowedBounds.maxX > fullBounds.maxX,
        "a narrower banner must be draggable further right, past the company logo",
      );
    });

    it("title block Y matches titleBlockBaseY from visible branding", () => {
      const offset = layoutBrandingContentOffset({
        showLogoRow: true,
        showHeaderBannerLogo: true,
        hasCompanyLogo: true,
        hasHeaderLogo: true,
      });
      const rects = defaultSectionRects("invoice", {
        showLogoRow: true,
        showHeaderBannerLogo: true,
        hasCompanyLogo: true,
        hasHeaderLogo: true,
      });
      assert.equal(rects.showTitleBlock!.y, titleBlockBaseY(offset));
    });

    it("title block defaults to Y=45 when branding sections are off", () => {
      const rects = defaultSectionRects("invoice", {
        showLogoRow: false,
        showHeaderBannerLogo: false,
      });
      assert.equal(rects.showTitleBlock!.y, 45);
    });
  });

  describe("headerBannerWidthScaleFactor", () => {
    it("clamps to 0.25–1 and defaults to 1 for invalid input", () => {
      assert.equal(headerBannerWidthScaleFactor(undefined), 1);
      assert.equal(headerBannerWidthScaleFactor(0.4), 0.4);
      assert.equal(headerBannerWidthScaleFactor(0.1), 0.25);
      assert.equal(headerBannerWidthScaleFactor(2), 1);
      assert.equal(headerBannerWidthScaleFactor("not a number"), 1);
    });
  });

  describe("headerBannerLayoutWidthPt", () => {
    it("uses full max width when aspect ratio is unknown", () => {
      assert.equal(
        headerBannerLayoutWidthPt({ headerLogoWidthScale: 0.5 }),
        CONTENT_WIDTH_PT * 0.5,
      );
    });

    it("shrinks to image aspect at configured banner height", () => {
      const scale = 1.1;
      const headerH = HEADER_BANNER_BASE_H_PT * scale;
      const aspect = 2.5;
      const fitted = headerBannerLayoutWidthPt({
        headerLogoWidthScale: 1,
        headerLogoScale: scale,
        headerBannerAspectRatio: aspect,
      });
      assert.equal(fitted, headerH * aspect);
      assert.ok(fitted < CONTENT_WIDTH_PT);
    });

    it("never exceeds max width from banner width scale", () => {
      const maxW = CONTENT_WIDTH_PT * 0.4;
      const fitted = headerBannerLayoutWidthPt({
        headerLogoWidthScale: 0.4,
        headerLogoScale: 1,
        headerBannerAspectRatio: 10,
      });
      assert.equal(fitted, maxW);
    });
  });

  describe("layoutBrandingEffectiveContentOffset", () => {
    it("matches stacked offset with zero branding Y offsets", () => {
      const opts = {
        showLogoRow: true,
        showHeaderBannerLogo: true,
        hasCompanyLogo: true,
        hasHeaderLogo: true,
      };
      assert.equal(
        layoutBrandingEffectiveContentOffset(opts),
        layoutBrandingContentOffset(opts),
      );
    });

    it("shrinks when the header banner is moved up beside the company logo", () => {
      const stacked = layoutBrandingContentOffset({
        showLogoRow: true,
        showHeaderBannerLogo: true,
        hasCompanyLogo: true,
        hasHeaderLogo: true,
      });
      const logoRowInset = COMPANY_LOGO_BASE_H_PT + BRANDING_BAND_GAP_PT;
      const besideLogo = layoutBrandingEffectiveContentOffset({
        showLogoRow: true,
        showHeaderBannerLogo: true,
        hasCompanyLogo: true,
        hasHeaderLogo: true,
        offHeaderBannerY: -logoRowInset,
      });
      assert.ok(besideLogo < stacked);
      assert.equal(
        defaultSectionRects("invoice", {
          showLogoRow: true,
          showHeaderBannerLogo: true,
          hasCompanyLogo: true,
          hasHeaderLogo: true,
          offHeaderBannerY: -logoRowInset,
        }).showTitleBlock!.y,
        titleBlockBaseY(besideLogo),
      );
    });
  });

  describe("titleBlockBaseY", () => {
    it("matches stacked branding formula", () => {
      const contentOffset =
        COMPANY_LOGO_BASE_H_PT +
        BRANDING_BAND_GAP_PT +
        HEADER_BANNER_BASE_H_PT +
        BRANDING_BAND_GAP_PT;
      assert.equal(titleBlockBaseY(contentOffset), 10 + contentOffset);
      assert.equal(titleBlockBaseY(0), 45);
    });
  });

  describe("clampSectionOffset", () => {
    it("allows large upward nudge until the block top reaches the page edge", () => {
      const rect = { x: PAGE_MARGIN_PT, y: 126, w: CONTENT_WIDTH_PT, h: 40 };
      const clamped = clampSectionOffset({ x: 0, y: -126 }, rect);
      assert.equal(clamped.y, -126);
      assert.equal(clampSectionOffset({ x: 0, y: -200 }, rect).y, -126);
    });
  });

  describe("laneOrder", () => {
    it("starts with the logo row for every kind", () => {
      for (const kind of ["invoice", "quotation", "jobOrder", "receipt"] as const) {
        assert.equal(laneOrder(kind)[0], "showLogoRow");
      }
    });

    it("invoice lane order ends with payment advice; other kinds omit it", () => {
      const inv = laneOrder("invoice");
      assert.equal(inv[inv.length - 1], "showPaymentAdvicePage");
      assert.ok(!laneOrder("quotation").includes("showPaymentAdvicePage"));
      assert.ok(!laneOrder("jobOrder").includes("showPaymentAdvicePage"));
      assert.ok(!laneOrder("receipt").includes("showPaymentAdvicePage"));
    });

    it("only quotation includes quotationExtra", () => {
      assert.ok(laneOrder("quotation").includes("quotationExtra"));
      assert.ok(!laneOrder("invoice").includes("quotationExtra"));
    });

    it("only job order includes jobOrderConsultants", () => {
      assert.ok(laneOrder("jobOrder").includes("jobOrderConsultants"));
      assert.ok(!laneOrder("invoice").includes("jobOrderConsultants"));
    });
  });
});
