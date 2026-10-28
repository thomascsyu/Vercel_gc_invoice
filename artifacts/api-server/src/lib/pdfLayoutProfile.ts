import {
  defaultSectionRects,
  sectionOffsetBounds,
  type LayoutSectionKey,
} from "@workspace/invoice-utils";

export type DocumentLayoutKind =
  | "invoice"
  | "quotation"
  | "jobOrder"
  | "receipt";

const ALL_KINDS: DocumentLayoutKind[] = ["invoice", "quotation", "jobOrder", "receipt"];

export type LineTableColumnKind = "item" | "description" | "quantity" | "rate" | "tax" | "amount";

/** User-editable ordering and visibility for the line-items table on PDFs. */
export interface LineItemsTableColumns {
  order: LineTableColumnKind[];
  /** Keys default to true when omitted. */
  visible?: Partial<Record<LineTableColumnKind, boolean>>;
}

export interface PdfDocumentLayoutSections {
  showHeaderBannerLogo?: boolean;
  showLogoRow?: boolean;
  /** Document heading: title word (INVOICE / QUOTATION / JOB ORDER), doc number, and date. */
  showTitleBlock?: boolean;
  showBillingBlock?: boolean;
  showTotals?: boolean;
  showBankAccounts?: boolean;
  showSignatures?: boolean;
  showFooterAddress?: boolean;
  /** Job order PDF: consultants in the right column, aligned with the client block (requires assigned consultants). */
  showConsultantsLine?: boolean;
  /**
   * Job order PDF: company name, address, tel, and email in the right column of the bill-to block.
   * Off by default so the layout matches the A4 job-order template (client-only left block).
   */
  showJobOrderIssuerBlock?: boolean;
  /** Invoice: block at bottom of page 1. Quotation: compact block at bottom of page 1 when enabled. */
  showPaymentAdvicePage?: boolean;
}

export type PdfLayoutPresetId = "classic" | "custom";

export interface PdfDocumentLayoutProfile {
  /**
   * UI-only hint: which named preset (if any) was last applied. The PDF
   * drawers ignore this; it is round-tripped so the editor can highlight the
   * active preset card across reloads. Stored as `"custom"` once the user
   * deviates from any named preset.
   */
  presetId?: PdfLayoutPresetId;
  tableMode?: "simple" | "detailed";
  lineColumns?: LineItemsTableColumns;
  sections?: PdfDocumentLayoutSections;
  /**
   * Fine 2D position nudges (PDF points) applied after the default layout.
   * `x`: horizontal shift (negative = left, positive = right)
   * `y`: vertical shift (negative = up, positive = down)
   * Clamped server-side for safety.
   */
  sectionOffsets?: Partial<
    Record<
      keyof PdfDocumentLayoutSections | "lineItems" | "quotationExtra" | "jobOrderConsultants",
      { x: number; y: number }
    >
  >;
  footerText?: string;
  quotation?: {
    showRemarks?: boolean;
    showPaymentTerms?: boolean;
    showSignatureBlock?: boolean;
  };
  receipt?: {
    showAccentHeader?: boolean;
    showChequeDetailRows?: boolean;
    /** When true, render company chop image from company settings (`chop_url`) on receipt PDFs. */
    showCompanyChop?: boolean;
  };
}

export type PdfDocumentLayoutsState = Partial<Record<DocumentLayoutKind, PdfDocumentLayoutProfile>>;

const OFFSET_KEYS_LIST = [
  "showLogoRow",
  "showHeaderBannerLogo",
  "showTitleBlock",
  "showBillingBlock",
  /** Job order: consultants block offset in the right column (paired with sections.showConsultantsLine). */
  "jobOrderConsultants",
  "lineItems",
  "showTotals",
  "showBankAccounts",
  "showSignatures",
  /** Quotation-only: nudges remarks, terms & conditions, and signature block together. */
  "quotationExtra",
  "showFooterAddress",
  "showPaymentAdvicePage",
] as const;

/** Fallback cap for keys/kinds `defaultSectionRects` doesn't place (safety net only). */
const MAX_SECTION_OFFSET_PT = 400;

/** Branding state used by the editor and PDF title position bounds. */
export interface PdfLayoutBranding {
  logoUrl?: string | null;
  headerLogoUrl?: string | null;
  companyLogoScale?: unknown;
  headerLogoScale?: unknown;
  headerLogoWidthScale?: unknown;
  /**
   * Header banner image width ÷ height, when known. Narrows the header
   * banner's layout width to the visible artwork (matches the canvas), so
   * the server's page-edge bounds for its horizontal offset aren't computed
   * against the wider full-content-width fallback and don't clip a stored
   * `x` nudge back down on every read/save.
   */
  headerBannerAspectRatio?: number | null;
}

function sectionOffsetYFromProfile(
  profile: PdfDocumentLayoutProfile,
  key: keyof NonNullable<PdfDocumentLayoutProfile["sectionOffsets"]>,
): number {
  const v = profile.sectionOffsets?.[key];
  const legacyY = parseOffsetNumber(v);
  if (legacyY != null && (typeof v === "number" || typeof v === "string")) return legacyY;
  if (v && typeof v === "object") {
    const n = parseOffsetNumber((v as { y?: unknown }).y);
    return n ?? 0;
  }
  return 0;
}

function titleRectOptions(profile: PdfDocumentLayoutProfile, branding?: PdfLayoutBranding) {
  return {
    companyLogoScale: branding?.companyLogoScale,
    headerLogoScale: branding?.headerLogoScale,
    headerLogoWidthScale: branding?.headerLogoWidthScale,
    hasCompanyLogo: branding ? Boolean(branding.logoUrl) : undefined,
    hasHeaderLogo: branding ? Boolean(branding.headerLogoUrl) : undefined,
    showLogoRow: profile.sections?.showLogoRow,
    showHeaderBannerLogo: profile.sections?.showHeaderBannerLogo,
    receiptAccentHeader: profile.receipt?.showAccentHeader,
    offLogoY: sectionOffsetYFromProfile(profile, "showLogoRow"),
    offHeaderBannerY: sectionOffsetYFromProfile(profile, "showHeaderBannerLogo"),
    headerBannerAspectRatio: branding?.headerBannerAspectRatio,
  };
}

function clampOffsetAxis(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(min, Math.min(max, n)));
}

function parseOffsetNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

/**
 * Parse stored section offset object; invalid keys dropped, values clamped.
 * When `kind` is known, clamps to that document's page-edge bounds; falls
 * back to the flat ±400pt cap for keys the kind doesn't place.
 */
export function mergeSectionOffsets(
  raw: unknown,
  kind?: DocumentLayoutKind,
  titleOptions?: Parameters<typeof defaultSectionRects>[1],
): NonNullable<PdfDocumentLayoutProfile["sectionOffsets"]> {
  if (!raw || typeof raw !== "object") return {};
  const out: NonNullable<PdfDocumentLayoutProfile["sectionOffsets"]> = {};
  const o = raw as Record<string, unknown>;
  // Every section below the branding band (bill-to, totals, bank accounts,
  // signatures/chop, ...) stacks its Y position off `contentOffset`, which
  // depends on the company's actual logo presence/scale and the logo/header
  // banner Y offsets (see `layoutBrandingEffectiveContentOffset`). Recomputing
  // the live rects from the real `titleOptions` — not just for the title and
  // header banner — keeps every section's page-edge bound in sync with where
  // it actually renders, the same fix applied to the header banner's width.
  const liveRects = kind ? defaultSectionRects(kind, titleOptions) : undefined;
  for (const k of OFFSET_KEYS_LIST) {
    const liveRect = liveRects?.[k as LayoutSectionKey];
    const b = liveRect ? sectionOffsetBounds(liveRect) : undefined;
    const clampX = (n: number) => clampOffsetAxis(n, b?.minX ?? -MAX_SECTION_OFFSET_PT, b?.maxX ?? MAX_SECTION_OFFSET_PT);
    const clampY = (n: number) => clampOffsetAxis(n, b?.minY ?? -MAX_SECTION_OFFSET_PT, b?.maxY ?? MAX_SECTION_OFFSET_PT);
    const v = o[k];
    const legacyY = parseOffsetNumber(v);
    if (legacyY != null) {
      out[k] = { x: 0, y: clampY(legacyY) };
      continue;
    }
    if (v && typeof v === "object") {
      const point = v as Record<string, unknown>;
      const px = parseOffsetNumber(point.x);
      const py = parseOffsetNumber(point.y);
      if (px != null || py != null) {
        out[k] = {
          x: clampX(px ?? 0),
          y: clampY(py ?? 0),
        };
      }
    }
  }
  return out;
}

const DEFAULT_LINE_ORDER: LineTableColumnKind[] = [
  "item",
  "quantity",
  "rate",
  "tax",
  "amount",
  "description",
];

const ALLOWED_PRESET_IDS: ReadonlyArray<PdfLayoutPresetId> = ["classic", "custom"];

function parsePresetId(raw: unknown): PdfLayoutPresetId | undefined {
  if (typeof raw !== "string") return undefined;
  return (ALLOWED_PRESET_IDS as ReadonlyArray<string>).includes(raw)
    ? (raw as PdfLayoutPresetId)
    : undefined;
}

export function normalizeLineColumnOrder(order: unknown): LineTableColumnKind[] {
  const allowed = new Set<LineTableColumnKind>(DEFAULT_LINE_ORDER);
  if (!Array.isArray(order)) return [...DEFAULT_LINE_ORDER];
  const seen = new Set<LineTableColumnKind>();
  const out: LineTableColumnKind[] = [];
  for (const k of order) {
    if (typeof k !== "string" || !allowed.has(k as LineTableColumnKind) || seen.has(k as LineTableColumnKind)) continue;
    out.push(k as LineTableColumnKind);
    seen.add(k as LineTableColumnKind);
  }
  for (const k of DEFAULT_LINE_ORDER) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

function mergeSections(
  a: PdfDocumentLayoutSections | undefined,
  b: PdfDocumentLayoutSections | undefined,
): PdfDocumentLayoutSections | undefined {
  if (!a && !b) return undefined;
  return { ...a, ...b };
}

/** Default opt-in flags for job order PDF sections when keys are absent in stored JSON. */
function normalizeJobOrderSections(sections: PdfDocumentLayoutSections | undefined): PdfDocumentLayoutSections {
  const s = { ...(sections ?? {}) };
  if (typeof s.showConsultantsLine !== "boolean") s.showConsultantsLine = false;
  if (typeof s.showJobOrderIssuerBlock !== "boolean") s.showJobOrderIssuerBlock = false;
  return s;
}

export function mergePdfDocumentLayouts(stored: unknown, branding?: PdfLayoutBranding): PdfDocumentLayoutsState {
  if (!stored || typeof stored !== "object") return {};
  const src = stored as Record<string, unknown>;
  const out: PdfDocumentLayoutsState = {};
  for (const kind of ALL_KINDS) {
    const raw = src[kind];
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const lineColsRaw = p.lineColumns as Record<string, unknown> | undefined;
    const lc: LineItemsTableColumns = {
      order: normalizeLineColumnOrder(lineColsRaw?.order),
      visible:
        lineColsRaw?.visible && typeof lineColsRaw.visible === "object"
          ? (lineColsRaw.visible as Partial<Record<LineTableColumnKind, boolean>>)
          : {},
    };
    const prof: PdfDocumentLayoutProfile = {
      presetId: parsePresetId(p.presetId),
      tableMode: p.tableMode === "detailed" ? "detailed" : "simple",
      lineColumns: lc,
      sections: mergeSections(undefined, (p.sections ?? undefined) as PdfDocumentLayoutSections | undefined),
      sectionOffsets: mergeSectionOffsets(p.sectionOffsets, kind, titleRectOptions(p as PdfDocumentLayoutProfile, branding)),
      footerText: typeof p.footerText === "string" ? p.footerText : undefined,
    };
    if (p.quotation && typeof p.quotation === "object") {
      const q = p.quotation as Record<string, unknown>;
      prof.quotation = {
        showRemarks: typeof q.showRemarks === "boolean" ? q.showRemarks : undefined,
        showPaymentTerms: typeof q.showPaymentTerms === "boolean" ? q.showPaymentTerms : undefined,
        showSignatureBlock: typeof q.showSignatureBlock === "boolean" ? q.showSignatureBlock : undefined,
      };
    }
    if (p.receipt && typeof p.receipt === "object") {
      const r = p.receipt as Record<string, unknown>;
      prof.receipt = {
        showAccentHeader: typeof r.showAccentHeader === "boolean" ? r.showAccentHeader : undefined,
        showChequeDetailRows: typeof r.showChequeDetailRows === "boolean" ? r.showChequeDetailRows : undefined,
        showCompanyChop: typeof r.showCompanyChop === "boolean" ? r.showCompanyChop : undefined,
      };
    }
    if (kind === "jobOrder") {
      prof.sections = normalizeJobOrderSections(prof.sections);
    }
    out[kind] = prof;
  }
  return out;
}

/** Merge PATCH body partial into existing layouts (per-document keys). */
export function patchPdfDocumentLayouts(
  existing: PdfDocumentLayoutsState | null | undefined,
  patchBody: unknown,
  branding?: PdfLayoutBranding,
): PdfDocumentLayoutsState {
  const base =
    mergePdfDocumentLayouts(
      existing && typeof existing === "object"
        ? (existing as Record<string, unknown>)
        : {},
      branding,
    ) ?? {};

  // Offset-only PATCHes must use the saved visibility and receipt style too.
  const rawPatch = patchBody && typeof patchBody === "object" ? patchBody as Record<string, unknown> : {};
  const contextualPatch = Object.fromEntries(Object.entries(rawPatch).map(([kind, raw]) => {
    if (!raw || typeof raw !== "object") return [kind, raw];
    const p = raw as PdfDocumentLayoutProfile;
    const current = base[kind as DocumentLayoutKind];
    return [kind, {
      ...p,
      sections: { ...current?.sections, ...p.sections },
      receipt: { ...current?.receipt, ...p.receipt },
    }];
  }));
  const patch = mergePdfDocumentLayouts(contextualPatch, branding);

  const next: PdfDocumentLayoutsState = { ...base };
  for (const kind of ALL_KINDS) {
    const pu = patch[kind];
    if (!pu) continue;
    const cur = base[kind] ?? {};
    const merged: PdfDocumentLayoutProfile = {
      ...cur,
      ...pu,
      presetId: pu.presetId ?? cur.presetId,
      lineColumns:
        pu.lineColumns != null || cur.lineColumns != null
          ? {
              order: normalizeLineColumnOrder(
                pu.lineColumns?.order ??
                  cur.lineColumns?.order ??
                  DEFAULT_LINE_ORDER,
              ),
              visible: { ...cur.lineColumns?.visible, ...pu.lineColumns?.visible },
            }
          : undefined,
      sections: mergeSections(cur.sections, pu.sections),
      sectionOffsets:
        pu.sectionOffsets != null || cur.sectionOffsets != null
          ? {
              ...cur.sectionOffsets,
              ...pu.sectionOffsets,
            }
          : undefined,
      quotation:
        pu.quotation != null ? { ...(cur.quotation ?? {}), ...(pu.quotation ?? {}) } : cur.quotation,
      receipt: pu.receipt != null ? { ...(cur.receipt ?? {}), ...(pu.receipt ?? {}) } : cur.receipt,
    };
    if (kind === "jobOrder") {
      merged.sections = normalizeJobOrderSections(merged.sections);
    }
    next[kind] = merged;
  }
  return next;
}

export function isColumnVisible(
  kind: LineTableColumnKind,
  order: LineTableColumnKind[],
  visible?: Partial<Record<LineTableColumnKind, boolean>>,
): boolean {
  if (visible && visible[kind] === false) return false;
  return order.includes(kind);
}

/** Default column layout for simple (Description + Amount) tables. Item column is omitted in PDF output. */
export const DEFAULT_SIMPLE_LINE_ORDER: LineTableColumnKind[] = ["description", "amount"];

/** Default for detailed line table (full grid). */
export { DEFAULT_LINE_ORDER };

/** Normalized layouts from persisted JSON (empty object if missing). */
export function getLayoutsFromSettings(raw: unknown, branding?: PdfLayoutBranding): PdfDocumentLayoutsState {
  return mergePdfDocumentLayouts(raw, branding);
}

/** Section toggle: omitted or true = shown; explicit false hides. */
export function sectionShows(
  key: keyof PdfDocumentLayoutSections,
  profile?: PdfDocumentLayoutProfile,
): boolean {
  const v = profile?.sections?.[key];
  return v !== false;
}

/** Horizontal nudge in PDF points for a section (0 if unset). */
export function sectionOffsetX(
  key: keyof NonNullable<PdfDocumentLayoutProfile["sectionOffsets"]>,
  profile?: PdfDocumentLayoutProfile,
): number {
  const n = profile?.sectionOffsets?.[key]?.x;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Vertical nudge in PDF points for a section (0 if unset). */
export function sectionOffsetY(
  key: keyof NonNullable<PdfDocumentLayoutProfile["sectionOffsets"]>,
  profile?: PdfDocumentLayoutProfile,
): number {
  const n = profile?.sectionOffsets?.[key]?.y;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
