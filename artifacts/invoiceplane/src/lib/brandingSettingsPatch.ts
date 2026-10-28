import type { CompanySettings } from "@/lib/modulesApi";
import { headerBannerWidthScaleFactor } from "@/lib/pdfLayoutGeometry";

/** Slider percent 100–200 → stored scale 1–2. */
export function brandingScaleFromPercent(percent: number): number {
  const n = Number(percent);
  const pct = Number.isFinite(n) ? Math.min(200, Math.max(100, n)) : 100;
  return Math.round(pct) / 100;
}

/** Slider percent 25–100 → stored scale 0.25–1 (header banner width). */
export function headerLogoWidthScaleFromPercent(percent: number): number {
  const n = Number(percent);
  const pct = Number.isFinite(n) ? Math.min(100, Math.max(25, n)) : 100;
  return Math.round(pct) / 100;
}

/** Stored scale 0.25–1 → slider percent 25–100 (5% steps), for branding form hydration. */
export function headerLogoWidthPercentFromScale(raw: unknown): number {
  const pct = Math.round(headerBannerWidthScaleFactor(raw) * 100);
  return Math.min(100, Math.max(25, Math.round(pct / 5) * 5));
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** Single PATCH body for company logo, header logo, and company chop. */
export function buildBrandingSettingsPatch(input: {
  logoUrl?: string | null;
  headerLogoUrl?: string | null;
  chopUrl?: string | null;
  companyLogoPercent: number;
  headerLogoPercent: number;
  headerLogoWidthPercent: number;
  chopPercent: number;
  proposalShowChop: boolean;
}): Partial<CompanySettings> {
  return {
    logoUrl: emptyToNull(input.logoUrl),
    headerLogoUrl: emptyToNull(input.headerLogoUrl),
    chopUrl: emptyToNull(input.chopUrl),
    companyLogoScale: brandingScaleFromPercent(input.companyLogoPercent),
    headerLogoScale: brandingScaleFromPercent(input.headerLogoPercent),
    headerLogoWidthScale: headerLogoWidthScaleFromPercent(input.headerLogoWidthPercent),
    chopScale: brandingScaleFromPercent(input.chopPercent),
    proposalShowChop: input.proposalShowChop,
  };
}
