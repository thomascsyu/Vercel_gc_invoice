/**
 * Layout presets for the Document layouts editor.
 *
 * A preset is a fully-formed `PdfDocumentProfile` for a given `DocKind`. Users
 * pick one from the left rail to seed their working draft, then refine
 * sections / offsets / line columns / footer in the inspector.
 *
 * `diffProfile` powers the "Diff vs default" badge so the inspector can tell
 * users how far they've drifted from a baseline.
 */
import type {
  LineTableColumnKind,
  PdfDocumentProfile,
  PdfLayoutSections,
  PdfSectionOffsetKey,
  PdfSectionOffsetPoint,
} from "@/lib/modulesApi";
import type { DocKind } from "@/lib/pdfLayoutGeometry";

export type PresetId = "classic" | "custom";

export interface PresetMeta {
  id: Exclude<PresetId, "custom">;
  label: string;
  description: string;
}

export const PRESET_LIST: PresetMeta[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Default Gabriel layout — every section visible, no offsets, simple line table.",
  },
];

const DEFAULT_LINE_ORDER: LineTableColumnKind[] = [
  "item",
  "quantity",
  "rate",
  "tax",
  "amount",
  "description",
];

const ZERO: PdfSectionOffsetPoint = { x: 0, y: 0 };

function emptyOffsets(): Partial<Record<PdfSectionOffsetKey, PdfSectionOffsetPoint>> {
  return {
    showLogoRow: { ...ZERO },
    showHeaderBannerLogo: { ...ZERO },
    showTitleBlock: { ...ZERO },
    showBillingBlock: { ...ZERO },
    jobOrderConsultants: { ...ZERO },
    lineItems: { ...ZERO },
    showTotals: { ...ZERO },
    showBankAccounts: { ...ZERO },
    showSignatures: { ...ZERO },
    quotationExtra: { ...ZERO },
    showFooterAddress: { ...ZERO },
    showPaymentAdvicePage: { ...ZERO },
  };
}

function allSectionsOn(): PdfLayoutSections {
  return {
    showHeaderBannerLogo: true,
    showLogoRow: true,
    showTitleBlock: true,
    showBillingBlock: true,
    showTotals: true,
    showBankAccounts: true,
    showSignatures: true,
    showFooterAddress: true,
    showPaymentAdvicePage: true,
  };
}

/**
 * `showPaymentAdvicePage` is invoice-only. Older saved `pdf_document_layouts` may still
 * include it under quotation/job order/receipt — strip so the document-layouts UI and
 * PATCH payloads stay consistent.
 */
export function sanitizeInvoiceOnlyKeysFromNonInvoiceProfile(
  kind: DocKind,
  profile: PdfDocumentProfile,
): PdfDocumentProfile {
  const out: PdfDocumentProfile = { ...profile };
  if (kind !== "invoice") {
    if (out.sections) {
      const s = { ...out.sections };
      delete s.showPaymentAdvicePage;
      out.sections = s;
    }
    if (out.sectionOffsets) {
      const o = { ...out.sectionOffsets };
      delete o.showPaymentAdvicePage;
      out.sectionOffsets = o;
    }
  }
  if (kind !== "jobOrder") {
    if (out.sections) {
      const s = { ...out.sections };
      delete s.showConsultantsLine;
      delete s.showJobOrderIssuerBlock;
      out.sections = s;
    }
    if (out.sectionOffsets) {
      const o = { ...out.sectionOffsets };
      delete o.jobOrderConsultants;
      out.sectionOffsets = o;
    }
  }
  if (kind === "invoice") return out;
  return out;
}

function classicProfile(kind: DocKind): PdfDocumentProfile {
  const sections: PdfLayoutSections = allSectionsOn();
  if (kind === "invoice" || kind === "quotation") {
    sections.showPaymentAdvicePage = false;
  } else {
    delete sections.showPaymentAdvicePage;
  }
  if (kind === "receipt") {
    delete sections.showBankAccounts;
    delete sections.showSignatures;
  }
  const profile: PdfDocumentProfile = {
    presetId: "classic",
    tableMode: "simple",
    sections,
    sectionOffsets: emptyOffsets(),
    lineColumns: { order: [...DEFAULT_LINE_ORDER], visible: {} },
    footerText: "",
  };
  if (kind === "quotation") {
    profile.quotation = { showRemarks: true, showPaymentTerms: true, showSignatureBlock: true };
  }
  if (kind === "receipt") {
    profile.receipt = { showAccentHeader: true, showChequeDetailRows: true };
  }
  if (kind === "jobOrder") {
    profile.sections = {
      ...profile.sections,
      showConsultantsLine: false,
      showJobOrderIssuerBlock: false,
    };
  }
  return profile;
}

const BUILDERS: Record<Exclude<PresetId, "custom">, (kind: DocKind) => PdfDocumentProfile> = {
  classic: classicProfile,
};

export function getPreset(id: Exclude<PresetId, "custom">, kind: DocKind): PdfDocumentProfile {
  return BUILDERS[id](kind);
}

/** Default profile = Classic. Used as the diff baseline. */
export function defaultProfile(kind: DocKind): PdfDocumentProfile {
  return classicProfile(kind);
}

/** Whitelisted offset keys for diff/equality checks. */
const OFFSET_KEYS: PdfSectionOffsetKey[] = [
  "showLogoRow",
  "showHeaderBannerLogo",
  "showTitleBlock",
  "showBillingBlock",
  "jobOrderConsultants",
  "lineItems",
  "showTotals",
  "showBankAccounts",
  "showSignatures",
  "quotationExtra",
  "showFooterAddress",
  "showPaymentAdvicePage",
];

const SECTION_KEYS = [
  "showHeaderBannerLogo",
  "showLogoRow",
  "showTitleBlock",
  "showBillingBlock",
  "showConsultantsLine",
  "showJobOrderIssuerBlock",
  "showTotals",
  "showBankAccounts",
  "showSignatures",
  "showFooterAddress",
  "showPaymentAdvicePage",
] as const;

function offEq(a?: PdfSectionOffsetPoint, b?: PdfSectionOffsetPoint): boolean {
  return (a?.x ?? 0) === (b?.x ?? 0) && (a?.y ?? 0) === (b?.y ?? 0);
}

function lineOrderEq(a: LineTableColumnKind[] | undefined, b: LineTableColumnKind[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

export interface ProfileDiffEntry {
  key: string;
  label: string;
}

/** Produce a list of human-readable changes between `draft` and `base`. */
export function diffProfile(
  draft: PdfDocumentProfile,
  base: PdfDocumentProfile,
): ProfileDiffEntry[] {
  const out: ProfileDiffEntry[] = [];

  if ((draft.tableMode ?? "simple") !== (base.tableMode ?? "simple")) {
    out.push({ key: "tableMode", label: `Line table: ${draft.tableMode ?? "simple"}` });
  }

  for (const sk of SECTION_KEYS) {
    const da = draft.sections?.[sk];
    const ba = base.sections?.[sk];
    const dEffective = da !== false;
    const bEffective = ba !== false;
    if (dEffective !== bEffective) {
      out.push({ key: `sections.${sk}`, label: `${sk}: ${dEffective ? "shown" : "hidden"}` });
    }
  }

  for (const k of OFFSET_KEYS) {
    if (!offEq(draft.sectionOffsets?.[k], base.sectionOffsets?.[k])) {
      const o = draft.sectionOffsets?.[k] ?? ZERO;
      out.push({ key: `offset.${k}`, label: `${k}: x${o.x} y${o.y}` });
    }
  }

  if (!lineOrderEq(draft.lineColumns?.order, base.lineColumns?.order)) {
    out.push({ key: "lineColumns.order", label: "Line column order changed" });
  }

  const draftVis = draft.lineColumns?.visible ?? {};
  const baseVis = base.lineColumns?.visible ?? {};
  for (const k of DEFAULT_LINE_ORDER) {
    const d = draftVis[k] !== false;
    const b = baseVis[k] !== false;
    if (d !== b) out.push({ key: `lineColumns.visible.${k}`, label: `column ${k}: ${d ? "shown" : "hidden"}` });
  }

  if ((draft.footerText ?? "") !== (base.footerText ?? "")) {
    out.push({ key: "footerText", label: "Footer text edited" });
  }

  const dq = draft.quotation;
  const bq = base.quotation;
  if (dq || bq) {
    for (const f of ["showRemarks", "showPaymentTerms", "showSignatureBlock"] as const) {
      const dv = dq?.[f] !== false;
      const bv = bq?.[f] !== false;
      if (dv !== bv) out.push({ key: `quotation.${f}`, label: `${f}: ${dv ? "on" : "off"}` });
    }
  }

  const dr = draft.receipt;
  const br = base.receipt;
  if (dr || br) {
    for (const f of ["showAccentHeader", "showChequeDetailRows"] as const) {
      const dv = dr?.[f] !== false;
      const bv = br?.[f] !== false;
      if (dv !== bv) out.push({ key: `receipt.${f}`, label: `${f}: ${dv ? "on" : "off"}` });
    }
    const dChop = dr?.showCompanyChop === true;
    const bChop = br?.showCompanyChop === true;
    if (dChop !== bChop) {
      out.push({ key: "receipt.showCompanyChop", label: `showCompanyChop: ${dChop ? "on" : "off"}` });
    }
  }

  return out;
}

/** True when the draft matches one of the named presets; returns its id. */
export function detectPresetId(
  draft: PdfDocumentProfile,
  kind: DocKind,
): PresetId {
  for (const meta of PRESET_LIST) {
    const candidate = getPreset(meta.id, kind);
    if (diffProfile(draft, candidate).length === 0) return meta.id;
  }
  return "custom";
}

/**
 * Stable signature of profile fields that affect PDF output.
 * Excludes UI-only `presetId` so preview requests are not re-triggered when
 * preset detection runs after a drag commit.
 */
export function profilePreviewSignature(profile: PdfDocumentProfile): string {
  const { presetId: _presetId, ...previewRelevant } = profile;
  return JSON.stringify(previewRelevant);
}
