import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSectionRects, sectionOffsetBounds } from "@workspace/invoice-utils";
import { mergePdfDocumentLayouts, patchPdfDocumentLayouts, getLayoutsFromSettings, mergeSectionOffsets } from "./pdfLayoutProfile.js";

describe("mergeSectionOffsets", () => {
  it("clamps a footer offset to the flat ±400pt cap when no kind is given", () => {
    const out = mergeSectionOffsets({ showFooterAddress: { x: 0, y: 400 } });
    assert.equal(out.showFooterAddress?.y, 400);
  });

  it("clamps a footer offset to the page-edge bound when the document kind is known", () => {
    const out = mergeSectionOffsets({ showFooterAddress: { x: 0, y: 400 } }, "invoice");
    assert.ok(
      out.showFooterAddress!.y < 400,
      "footer near the bottom margin must not be pushed off the page by a stored +400 offset",
    );
  });

  it("allows a moderate upward offset for a section with room to move, but still clamps an extreme one", () => {
    const moderate = mergeSectionOffsets({ showTitleBlock: { x: 0, y: -50 } }, "invoice");
    assert.equal(moderate.showTitleBlock?.y, -50);

    const extreme = mergeSectionOffsets({ showTitleBlock: { x: 0, y: -300 } }, "invoice");
    assert.ok(
      extreme.showTitleBlock!.y > -300,
      "an offset that would push the title above the page top must be clamped",
    );
  });

  it("falls back to the flat cap for a key the given kind doesn't place", () => {
    const out = mergeSectionOffsets({ showBankAccounts: { x: 0, y: 400 } }, "jobOrder");
    assert.equal(out.showBankAccounts?.y, 400);
  });

  it("allows a bill-to block to move further down when the company has no logos", () => {
    // Bill-to (and everything below it) stacks off `contentOffset`, which shrinks
    // to 0 with no branding images — so the real page-edge bound has more room
    // to move down than the generic bound (both logos present) assumes.
    const rectOpts = { hasCompanyLogo: false, hasHeaderLogo: false };
    const rect = defaultSectionRects("invoice", rectOpts).showBillingBlock!;
    const realMaxY = sectionOffsetBounds(rect).maxY;
    const staticMaxY = sectionOffsetBounds(defaultSectionRects("invoice").showBillingBlock!).maxY;
    assert.ok(realMaxY > staticMaxY, "test setup: no-logo bill-to must have more downward room than the generic bound");

    const targetY = Math.min(realMaxY, staticMaxY + 30);
    assert.ok(targetY > staticMaxY, "test setup: target Y must exceed the generic bound");

    const out = mergeSectionOffsets({ showBillingBlock: { x: 0, y: targetY } }, "invoice", rectOpts);
    assert.equal(out.showBillingBlock?.y, targetY);
  });

  it("clamps bank/payment details tighter when large logos push the block further down the page", () => {
    // At 200% branding scale, the bank block's real Y sits further down the page
    // than the generic (100%, both-logos) bound assumes — so the real page-edge
    // bound leaves less downward room, and a stored offset that only fit under
    // the generic bound must still be clamped to keep the block on the page.
    const rectOpts = {
      hasCompanyLogo: true,
      hasHeaderLogo: true,
      companyLogoScale: 2,
      headerLogoScale: 2,
    };
    const rect = defaultSectionRects("invoice", rectOpts).showBankAccounts!;
    const realMaxY = sectionOffsetBounds(rect).maxY;
    const staticMaxY = sectionOffsetBounds(defaultSectionRects("invoice").showBankAccounts!).maxY;
    assert.ok(realMaxY < staticMaxY, "test setup: 200%-branding bank block must have less downward room than the generic bound");

    const out = mergeSectionOffsets({ showBankAccounts: { x: 0, y: staticMaxY } }, "invoice", rectOpts);
    assert.equal(out.showBankAccounts?.y, realMaxY);
  });

  it("preserves a rightward header banner offset when branding narrows banner width", () => {
    const rectOpts = {
      hasCompanyLogo: true,
      hasHeaderLogo: true,
      showLogoRow: true,
      showHeaderBannerLogo: true,
    };
    const fullRect = defaultSectionRects("invoice", { ...rectOpts, headerLogoWidthScale: 1 }).showHeaderBannerLogo!;
    const narrowRect = defaultSectionRects("invoice", { ...rectOpts, headerLogoWidthScale: 0.25 }).showHeaderBannerLogo!;
    const fullMaxX = sectionOffsetBounds(fullRect).maxX;
    const narrowMaxX = sectionOffsetBounds(narrowRect).maxX;
    assert.ok(narrowMaxX > fullMaxX, "narrow banner must allow dragging further right");

    const targetX = Math.min(narrowMaxX, fullMaxX + 50);
    assert.ok(targetX > fullMaxX, "test setup: target X must exceed full-width maxX");

    const fullOut = mergeSectionOffsets(
      { showHeaderBannerLogo: { x: targetX, y: 0 } },
      "invoice",
      { ...rectOpts, headerLogoWidthScale: 1 },
    );
    const narrowOut = mergeSectionOffsets(
      { showHeaderBannerLogo: { x: targetX, y: 0 } },
      "invoice",
      { ...rectOpts, headerLogoWidthScale: 0.25 },
    );

    assert.equal(fullOut.showHeaderBannerLogo?.x, fullMaxX);
    assert.equal(narrowOut.showHeaderBannerLogo?.x, targetX);
  });
});


describe("title position round trip", () => {
  for (const kind of ["invoice", "quotation", "jobOrder", "receipt"] as const) {
    for (const scale of [1, 1.7, 2]) {
      it(`${kind}: preserves a canvas-valid upward move at ${scale * 100}% branding`, () => {
        const branding = { logoUrl: "/logo.png", headerLogoUrl: "/header.png", companyLogoScale: scale, headerLogoScale: scale };
        const rect = defaultSectionRects(kind, { ...branding, hasCompanyLogo: true, hasHeaderLogo: true }).showTitleBlock!;
        const point = { x: -20, y: -Math.floor(rect.y) + 8 };
        const saved = patchPdfDocumentLayouts({}, { [kind]: { sectionOffsets: { showTitleBlock: point } } }, branding);
        const reloaded = mergePdfDocumentLayouts(saved, branding);
        const rendered = getLayoutsFromSettings(reloaded, branding);
        assert.deepEqual(rendered[kind]?.sectionOffsets?.showTitleBlock, point);
      });
    }
    it(`${kind}: uses saved hidden branding on an offset-only PATCH`, () => {
      const branding = { logoUrl: "/logo.png", headerLogoUrl: "/header.png", companyLogoScale: 2, headerLogoScale: 2 };
      const existing = { [kind]: { sections: { showLogoRow: false, showHeaderBannerLogo: false } } };
      const saved = patchPdfDocumentLayouts(existing, { [kind]: { sectionOffsets: { showTitleBlock: { x: 0, y: -200 } } } }, branding);
      assert.equal(saved[kind]?.sectionOffsets?.showTitleBlock?.y, -45);
    });
    it(`${kind}: absent images use the unbranded page-edge bound`, () => {
      const saved = mergePdfDocumentLayouts({ [kind]: { sectionOffsets: { showTitleBlock: { x: 0, y: -200 } } } }, {});
      assert.equal(saved[kind]?.sectionOffsets?.showTitleBlock?.y, -45);
    });
  }
  it("invoice: preserves a canvas-valid rightward header banner move at 25% width", () => {
    const branding = {
      logoUrl: "/logo.png",
      headerLogoUrl: "/header.png",
      headerLogoWidthScale: 0.25,
    };
    const rect = defaultSectionRects("invoice", {
      ...branding,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
    }).showHeaderBannerLogo!;
    const point = { x: Math.min(100, sectionOffsetBounds(rect).maxX), y: 0 };
    const saved = patchPdfDocumentLayouts(
      {},
      { invoice: { sectionOffsets: { showHeaderBannerLogo: point } } },
      branding,
    );
    const reloaded = mergePdfDocumentLayouts(saved, branding);
    const rendered = getLayoutsFromSettings(reloaded, branding);
    assert.deepEqual(rendered.invoice?.sectionOffsets?.showHeaderBannerLogo, point);
  });

  it("invoice: preserves a canvas-valid rightward header banner move for a narrow-aspect image", () => {
    // `headerLogoWidthScale` narrowing (tested above) is one way the banner can end
    // up narrower than the full content width; the image's own aspect ratio (as the
    // canvas already computes client-side via `useHeaderBannerAspectRatio`) is
    // another. Without it, the server falls back to treating the banner as
    // full-width, which silently truncates a legitimate rightward `x` nudge back
    // down on every save/reload — while the vertical `y` offset round-trips fine,
    // since its bound doesn't depend on banner width. This is the horizontal
    // position sync bug.
    const brandingWithoutAspect = {
      logoUrl: "/logo.png",
      headerLogoUrl: "/header.png",
    };
    const brandingWithAspect = { ...brandingWithoutAspect, headerBannerAspectRatio: 1 };

    const fullRect = defaultSectionRects("invoice", {
      ...brandingWithoutAspect,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
    }).showHeaderBannerLogo!;
    const narrowRect = defaultSectionRects("invoice", {
      ...brandingWithAspect,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
    }).showHeaderBannerLogo!;
    const fullMaxX = sectionOffsetBounds(fullRect).maxX;
    const narrowMaxX = sectionOffsetBounds(narrowRect).maxX;
    assert.ok(narrowMaxX > fullMaxX, "test setup: a square banner must allow dragging further right than full width");

    const point = { x: narrowMaxX, y: 0 };
    const saved = patchPdfDocumentLayouts(
      {},
      { invoice: { sectionOffsets: { showHeaderBannerLogo: point } } },
      brandingWithAspect,
    );
    const reloaded = mergePdfDocumentLayouts(saved, brandingWithAspect);
    const rendered = getLayoutsFromSettings(reloaded, brandingWithAspect);
    assert.deepEqual(rendered.invoice?.sectionOffsets?.showHeaderBannerLogo, point);
  });

  it("uses the saved receipt accent style for downward bounds", () => {
    for (const showAccentHeader of [true, false]) {
      const existing = { receipt: { receipt: { showAccentHeader } } };
      const saved = patchPdfDocumentLayouts(existing, { receipt: { sectionOffsets: { showTitleBlock: { x: 0, y: 900 } } } }, {});
      const rect = defaultSectionRects("receipt", { hasCompanyLogo: false, hasHeaderLogo: false, receiptAccentHeader: showAccentHeader }).showTitleBlock!;
      assert.equal(saved.receipt?.sectionOffsets?.showTitleBlock?.y, 842 - rect.y - rect.h);
    }
  });
});
