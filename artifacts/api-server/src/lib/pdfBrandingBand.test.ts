import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRANDING_BAND_GAP_PT,
  COMPANY_LOGO_BASE_H_PT,
  HEADER_BANNER_BASE_H_PT,
  pdfBrandingBand,
  titleBlockBaseY,
} from "./pdfBrandingBand.js";

describe("pdfBrandingBand", () => {
  it("is zero when neither branding image is drawn", () => {
    const band = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: false,
      hasHeaderLogo: false,
    });
    assert.equal(band.logoRowInset, 0);
    assert.equal(band.contentOffset, 0);
  });

  it("uses company-logo height when only the logo row is drawn", () => {
    const band = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: true,
      hasHeaderLogo: false,
    });
    assert.equal(band.logoRowInset, COMPANY_LOGO_BASE_H_PT + BRANDING_BAND_GAP_PT);
    assert.equal(band.contentOffset, band.logoRowInset);
  });

  it("uses header height when only the banner is drawn", () => {
    const band = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: false,
      hasHeaderLogo: true,
    });
    assert.equal(band.logoRowInset, 0);
    assert.equal(band.contentOffset, HEADER_BANNER_BASE_H_PT + BRANDING_BAND_GAP_PT);
  });

  it("stacks company logo + header banner so title content clears both", () => {
    const band = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
      companyLogoScale: 1.7,
      headerLogoScale: 1.1,
    });
    const expectedLogo = COMPANY_LOGO_BASE_H_PT * 1.7 + BRANDING_BAND_GAP_PT;
    const expectedHeader = HEADER_BANNER_BASE_H_PT * 1.1 + BRANDING_BAND_GAP_PT;
    assert.equal(band.logoRowInset, expectedLogo);
    assert.equal(band.contentOffset, expectedLogo + expectedHeader);
    assert.ok(
      band.contentOffset > expectedHeader,
      "content offset must not ignore the company logo when the header banner is also present",
    );
  });

  it("titleBlockBaseY uses 45 when no branding stack, else 10 + content offset", () => {
    assert.equal(titleBlockBaseY(0), 45);
    const band = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
    });
    assert.equal(titleBlockBaseY(band.contentOffset), 10 + band.contentOffset);
  });

  it("ignores images whose layout section is toggled off", () => {
    const band = pdfBrandingBand({
      showLogoRow: false,
      showHeaderBanner: false,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
    });
    assert.equal(band.logoRowInset, 0);
    assert.equal(band.contentOffset, 0);
  });

  it("defaults header banner width to full scale (1) when unset", () => {
    const band = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
    });
    assert.equal(band.headerWidthScale, 1);
  });

  it("narrows header banner width and clamps to 0.25–1 so it can sit beside the company logo", () => {
    const narrow = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
      headerLogoWidthScale: 0.4,
    });
    assert.equal(narrow.headerWidthScale, 0.4);

    const belowMin = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
      headerLogoWidthScale: 0.1,
    });
    assert.equal(belowMin.headerWidthScale, 0.25);

    const aboveMax = pdfBrandingBand({
      showLogoRow: true,
      showHeaderBanner: true,
      hasCompanyLogo: true,
      hasHeaderLogo: true,
      headerLogoWidthScale: 1.5,
    });
    assert.equal(aboveMax.headerWidthScale, 1);
  });
});
