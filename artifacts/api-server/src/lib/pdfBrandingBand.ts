import { headerBannerWidthScaleFactor, titleBlockBaseY } from "@workspace/invoice-utils";
import { logoScaleFactor } from "./logoScale";

export { titleBlockBaseY };

/** Matches PDF drawers and the document-layout canvas (`pdfLayoutGeometry.ts`). */
export const COMPANY_LOGO_BASE_W_PT = 120;
export const COMPANY_LOGO_BASE_H_PT = 45;
export const HEADER_BANNER_BASE_H_PT = 55;
export const BRANDING_BAND_GAP_PT = 8;

/**
 * Vertical space taken by the stacked company logo + header banner.
 *
 * Both assets draw when their layout toggle is on and bytes loaded. Title /
 * billing baselines must shift by the *sum* of those bands — using only the
 * header height when both are present overlaps INVOICE/QUOTATION/etc. with
 * the banner (the document-layout error after uploading logos).
 */
export function pdfBrandingBand(opts: {
  showLogoRow: boolean;
  showHeaderBanner: boolean;
  hasCompanyLogo: boolean;
  hasHeaderLogo: boolean;
  companyLogoScale?: unknown;
  headerLogoScale?: unknown;
  /** Header banner width as a fraction of content width (0.25–1); defaults to 1 (full width). */
  headerLogoWidthScale?: unknown;
}): {
  companyMaxW: number;
  companyMaxH: number;
  headerH: number;
  /** Header banner width scale factor (0.25–1) to multiply the caller's content width by. */
  headerWidthScale: number;
  /** Extra Y after the company logo; header banner is drawn at `10 + this`. */
  logoRowInset: number;
  /** Extra Y for title/billing so they clear stacked branding images. */
  contentOffset: number;
} {
  const companyMaxW = COMPANY_LOGO_BASE_W_PT * logoScaleFactor(opts.companyLogoScale);
  const companyMaxH = COMPANY_LOGO_BASE_H_PT * logoScaleFactor(opts.companyLogoScale);
  const headerH = HEADER_BANNER_BASE_H_PT * logoScaleFactor(opts.headerLogoScale);
  const headerWidthScale = headerBannerWidthScaleFactor(opts.headerLogoWidthScale);
  const logoRowInset =
    opts.showLogoRow && opts.hasCompanyLogo ? companyMaxH + BRANDING_BAND_GAP_PT : 0;
  const headerInset =
    opts.showHeaderBanner && opts.hasHeaderLogo ? headerH + BRANDING_BAND_GAP_PT : 0;
  return {
    companyMaxW,
    companyMaxH,
    headerH,
    headerWidthScale,
    logoRowInset,
    contentOffset: logoRowInset + headerInset,
  };
}
