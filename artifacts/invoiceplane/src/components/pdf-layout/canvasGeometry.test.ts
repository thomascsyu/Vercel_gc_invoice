import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ptToPx } from "../../lib/pdfLayoutGeometry.ts";
import type { LayoutSectionKey } from "../../lib/pdfLayoutGeometry.ts";
import type { PdfSectionOffsetPoint } from "../../lib/modulesApi.ts";
import {
  computeBlocks,
  computeGuides,
  detectCollisions,
  isHidden,
  type BlockGeom,
} from "./canvasGeometry.ts";

describe("canvasGeometry", () => {
  describe("isHidden", () => {
    it("returns true only when a hidable section is toggled false", () => {
      assert.equal(isHidden("showLogoRow", { showLogoRow: false }), true);
      assert.equal(isHidden("showLogoRow", { showLogoRow: true }), false);
      assert.equal(isHidden("showLogoRow", {}), false);
    });

    it("returns false for non-hidable sections regardless of toggle", () => {
      assert.equal(isHidden("lineItems", { lineItems: false }), false);
      assert.equal(isHidden("quotationExtra", { quotationExtra: false }), false);
    });
  });

  describe("computeBlocks", () => {
    it("produces a block for each lane in the kind", () => {
      const blocks = computeBlocks("invoice", {}, {});
      const keys = blocks.map((b) => b.key);
      for (const expected of [
        "showLogoRow",
        "showHeaderBannerLogo",
        "showBillingBlock",
        "lineItems",
        "showTotals",
        "showBankAccounts",
        "showSignatures",
        "showFooterAddress",
        "showPaymentAdvicePage",
      ] as LayoutSectionKey[]) {
        assert.ok(keys.includes(expected), `expected ${expected} in computed blocks`);
      }
    });

    it("job order line items vertical position is unchanged when consultants block is toggled (consultants share bill-to row)", () => {
      const withConsultants = computeBlocks("jobOrder", { showConsultantsLine: true }, {});
      const without = computeBlocks("jobOrder", { showConsultantsLine: false, jobOrderConsultants: false }, {});
      const liOn = withConsultants.find((b) => b.key === "lineItems")!;
      const liOff = without.find((b) => b.key === "lineItems")!;
      assert.equal(liOn.top, liOff.top, "line items anchor should match; consultants sit in right column");
    });

    it("shows consultants canvas block whenever Consultants on PDF is on, even when bill-to is off", () => {
      const blocks = computeBlocks("jobOrder", { showBillingBlock: false, showConsultantsLine: true }, {});
      const jc = blocks.find((b) => b.key === "jobOrderConsultants");
      assert.ok(jc);
      assert.equal(jc!.hidden, false);
    });

    it("produces quotation lanes including quotationExtra", () => {
      const blocks = computeBlocks("quotation", {}, {});
      const keys = blocks.map((b) => b.key);
      for (const expected of [
        "showLogoRow",
        "showHeaderBannerLogo",
        "showBillingBlock",
        "lineItems",
        "showTotals",
        "showBankAccounts",
        "quotationExtra",
        "showSignatures",
        "showFooterAddress",
      ] as LayoutSectionKey[]) {
        assert.ok(keys.includes(expected), `expected ${expected} in quotation blocks`);
      }
      assert.ok(!keys.includes("showPaymentAdvicePage"));
    });

    it("applies XY offsets in CSS pixels", () => {
      const offsets: Partial<Record<LayoutSectionKey, PdfSectionOffsetPoint>> = {
        showTotals: { x: 16, y: -8 },
      };
      const blocks = computeBlocks("invoice", {}, offsets);
      const totals = blocks.find((b) => b.key === "showTotals");
      assert.ok(totals);
      // Floating point math (e.g. 16 * 0.42) is approximate.
      assert.ok(Math.abs(totals!.left - totals!.baseLeft - ptToPx(16)) < 1e-6);
      assert.ok(Math.abs(totals!.top - totals!.baseTop - ptToPx(-8)) < 1e-6);
    });

    it("marks toggled-off hidable sections as hidden", () => {
      const blocks = computeBlocks("invoice", { showLogoRow: false }, {});
      const logo = blocks.find((b) => b.key === "showLogoRow");
      assert.ok(logo);
      assert.equal(logo!.hidden, true);
    });

    it("shifts the title block down when branding scales are above 100%", () => {
      const base = computeBlocks("invoice", {}, {}, { hasCompanyLogo: true, hasHeaderLogo: true });
      const scaled = computeBlocks(
        "invoice",
        {},
        {},
        { companyLogoScale: 1.7, headerLogoScale: 1.1, hasCompanyLogo: true, hasHeaderLogo: true },
      );
      const baseTitle = base.find((b) => b.key === "showTitleBlock")!;
      const scaledTitle = scaled.find((b) => b.key === "showTitleBlock")!;
      assert.ok(scaledTitle.top > baseTitle.top);
    });

    it("scales both company-logo dimensions while the banner keeps the content width", () => {
      for (const kind of ["invoice", "quotation", "jobOrder", "receipt"] as const) {
        const base = computeBlocks(kind, {}, {}, { companyLogoScale: 1, headerLogoScale: 1 });
        const scaled = computeBlocks(kind, {}, {}, { companyLogoScale: 2, headerLogoScale: 2 });
        const logo = base.find((b) => b.key === "showLogoRow")!;
        const largeLogo = scaled.find((b) => b.key === "showLogoRow")!;
        assert.equal(largeLogo.width, logo.width * 2);
        assert.equal(largeLogo.height, logo.height * 2);
        const banner = base.find((b) => b.key === "showHeaderBannerLogo")!;
        const largeBanner = scaled.find((b) => b.key === "showHeaderBannerLogo")!;
        assert.equal(banner.width, ptToPx(495));
        assert.equal(largeBanner.width, banner.width);
        assert.equal(largeBanner.height, banner.height * 2);
      }
    });

    it("raises the title block when logo and banner are toggled off", () => {
      const withBranding = computeBlocks(
        "invoice",
        { showLogoRow: true, showHeaderBannerLogo: true },
        {},
        { hasCompanyLogo: true, hasHeaderLogo: true },
      );
      const without = computeBlocks(
        "invoice",
        { showLogoRow: false, showHeaderBannerLogo: false },
        {},
      );
      const titleOn = withBranding.find((b) => b.key === "showTitleBlock")!;
      const titleOff = without.find((b) => b.key === "showTitleBlock")!;
      assert.ok(titleOff.top < titleOn.top);
    });
  });

  describe("detectCollisions", () => {
    function block(
      key: LayoutSectionKey,
      left: number,
      top: number,
      width = 50,
      height = 30,
      hidden = false,
    ): BlockGeom {
      return {
        key,
        left,
        top,
        width,
        height,
        baseLeft: left,
        baseTop: top,
        hidden,
      };
    }

    it("flags two overlapping blocks", () => {
      const hits = detectCollisions([
        block("showLogoRow", 0, 0),
        block("showHeaderBannerLogo", 10, 10),
      ]);
      assert.equal(hits.has("showLogoRow"), true);
      assert.equal(hits.has("showHeaderBannerLogo"), true);
    });

    it("ignores hidden blocks", () => {
      const hits = detectCollisions([
        block("showLogoRow", 0, 0),
        block("showHeaderBannerLogo", 10, 10, 50, 30, true),
      ]);
      assert.equal(hits.size, 0);
    });

    it("flags payment advice when it overlaps another block", () => {
      const hits = detectCollisions([
        block("showLogoRow", 0, 0),
        block("showPaymentAdvicePage", 0, 0),
      ]);
      assert.equal(hits.has("showLogoRow"), true);
      assert.equal(hits.has("showPaymentAdvicePage"), true);
    });

    it("returns empty when blocks don't overlap", () => {
      const hits = detectCollisions([
        block("showLogoRow", 0, 0, 30, 20),
        block("showHeaderBannerLogo", 100, 100),
      ]);
      assert.equal(hits.size, 0);
    });

    it("does not flag blocks that are only touching, including with float rounding noise", () => {
      // Exactly adjacent: right edge of A === left edge of B.
      const exact = detectCollisions([
        block("showBankAccounts", 0, 0, 50, 30),
        block("showSignatures", 50, 0, 50, 30),
      ]);
      assert.equal(exact.size, 0);

      // Same edges but with the kind of sub-pixel float error `ptToPx` produces
      // (e.g. 124.95 vs 124.94999999999999) — must not register as an overlap.
      const rounded = detectCollisions([
        block("showBankAccounts", 0, 0, 124.95, 30),
        block("showSignatures", 124.94999999999999, 0, 124.95, 30),
      ]);
      assert.equal(rounded.size, 0);
    });

    it("still flags a real, meaningful overlap between adjacent-ish blocks", () => {
      const hits = detectCollisions([
        block("showBankAccounts", 0, 0, 50, 30),
        block("showSignatures", 45, 0, 50, 30),
      ]);
      assert.equal(hits.has("showBankAccounts"), true);
      assert.equal(hits.has("showSignatures"), true);
    });
  });

  describe("computeGuides", () => {
    const active: BlockGeom = {
      key: "showLogoRow",
      left: 50,
      top: 50,
      width: 100,
      height: 40,
      baseLeft: 60,
      baseTop: 50,
      hidden: false,
    };

    it("emits a guide when an edge aligns with the page center", () => {
      const guides = computeGuides(active, [], 100, 100);
      assert.ok(guides.length > 0, "expected at least one alignment guide");
    });

    it("emits a guide when an edge aligns with another block's edge", () => {
      const other: BlockGeom = {
        key: "showTotals",
        left: 50, // matches active.left exactly
        top: 200,
        width: 100,
        height: 40,
        baseLeft: 50,
        baseTop: 200,
        hidden: false,
      };
      const guides = computeGuides(active, [other], 1000, 1000);
      assert.ok(
        guides.some((g) => g.axis === "x" && Math.abs(g.pos - 50) <= 2),
        "expected x guide aligned with the other block left edge",
      );
    });
  });
});
