import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  brandingScaleFromPercent,
  buildBrandingSettingsPatch,
  headerLogoWidthPercentFromScale,
  headerLogoWidthScaleFromPercent,
} from "./brandingSettingsPatch.ts";

describe("buildBrandingSettingsPatch", () => {
  it("writes all three image URLs and scales in one payload", () => {
    const patch = buildBrandingSettingsPatch({
      logoUrl: "/api/storage/public-objects/branding/company-logo/a.png",
      headerLogoUrl: "/api/storage/public-objects/branding/header-logo/b.png",
      chopUrl: "/api/storage/public-objects/branding/company-chop/c.png",
      companyLogoPercent: 170,
      headerLogoPercent: 110,
      headerLogoWidthPercent: 40,
      chopPercent: 105,
      proposalShowChop: true,
    });
    assert.equal(patch.logoUrl, "/api/storage/public-objects/branding/company-logo/a.png");
    assert.equal(patch.headerLogoUrl, "/api/storage/public-objects/branding/header-logo/b.png");
    assert.equal(patch.chopUrl, "/api/storage/public-objects/branding/company-chop/c.png");
    assert.equal(patch.companyLogoScale, 1.7);
    assert.equal(patch.headerLogoScale, 1.1);
    assert.equal(patch.headerLogoWidthScale, 0.4);
    assert.equal(patch.chopScale, 1.05);
    assert.equal(patch.proposalShowChop, true);
  });

  it("clears blank paths so Save can remove an image", () => {
    const patch = buildBrandingSettingsPatch({
      logoUrl: "  ",
      headerLogoUrl: undefined,
      chopUrl: null,
      companyLogoPercent: 100,
      headerLogoPercent: 100,
      headerLogoWidthPercent: 100,
      chopPercent: 100,
      proposalShowChop: false,
    });
    assert.equal(patch.logoUrl, null);
    assert.equal(patch.headerLogoUrl, null);
    assert.equal(patch.chopUrl, null);
    assert.equal(patch.proposalShowChop, false);
  });
});

describe("headerLogoWidthScaleFromPercent", () => {
  it("clamps to 25–100% and stores 0.25–1", () => {
    assert.equal(headerLogoWidthScaleFromPercent(100), 1);
    assert.equal(headerLogoWidthScaleFromPercent(25), 0.25);
    assert.equal(headerLogoWidthScaleFromPercent(10), 0.25);
    assert.equal(headerLogoWidthScaleFromPercent(150), 1);
    assert.equal(headerLogoWidthScaleFromPercent(Number.NaN), 1);
  });
});

describe("headerLogoWidthPercentFromScale", () => {
  it("clamps to 25–100% in 5% steps and defaults invalid input to 100%", () => {
    assert.equal(headerLogoWidthPercentFromScale(undefined), 100);
    assert.equal(headerLogoWidthPercentFromScale(0.4), 40);
    assert.equal(headerLogoWidthPercentFromScale(0.1), 25);
    assert.equal(headerLogoWidthPercentFromScale(2), 100);
    assert.equal(headerLogoWidthPercentFromScale("not a number"), 100);
  });
});

describe("brandingScaleFromPercent", () => {
  it("clamps to 100–200% and stores 1–2", () => {
    assert.equal(brandingScaleFromPercent(100), 1);
    assert.equal(brandingScaleFromPercent(200), 2);
    assert.equal(brandingScaleFromPercent(50), 1);
    assert.equal(brandingScaleFromPercent(250), 2);
    assert.equal(brandingScaleFromPercent(Number.NaN), 1);
  });
});
