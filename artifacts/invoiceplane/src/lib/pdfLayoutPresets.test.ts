import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRESET_LIST,
  defaultProfile,
  detectPresetId,
  diffProfile,
  getPreset,
  profilePreviewSignature,
  sanitizeInvoiceOnlyKeysFromNonInvoiceProfile,
} from "./pdfLayoutPresets.ts";
import type { PdfDocumentProfile } from "./modulesApi.ts";

describe("pdfLayoutPresets", () => {
  describe("getPreset / defaultProfile", () => {
    it("Classic profile equals defaultProfile for every kind", () => {
      for (const kind of ["invoice", "quotation", "jobOrder", "receipt"] as const) {
        const def = defaultProfile(kind);
        const classic = getPreset("classic", kind);
        assert.equal(diffProfile(classic, def).length, 0, `classic must match default for ${kind}`);
      }
    });

    it("includes a preset for every entry in PRESET_LIST", () => {
      for (const kind of ["invoice", "quotation", "jobOrder", "receipt"] as const) {
        for (const meta of PRESET_LIST) {
          const p = getPreset(meta.id, kind);
          assert.equal(p.presetId, meta.id, `preset ${meta.id}/${kind} must round-trip its id`);
        }
      }
    });

    it("invoice and quotation classic keep payment advice off by default", () => {
      assert.equal(getPreset("classic", "invoice").sections?.showPaymentAdvicePage, false);
      assert.equal(getPreset("classic", "quotation").sections?.showPaymentAdvicePage, false);
      assert.equal(getPreset("classic", "jobOrder").sections?.showPaymentAdvicePage, undefined);
      assert.equal(getPreset("classic", "receipt").sections?.showPaymentAdvicePage, undefined);
    });

    it("job order classic keeps consultants line and issuer company block off by default", () => {
      const jo = getPreset("classic", "jobOrder");
      assert.equal(jo.sections?.showConsultantsLine, false);
      assert.equal(jo.sections?.showJobOrderIssuerBlock, false);
    });

    it("sanitize strips payment advice from non-invoice profiles (legacy merged data)", () => {
      const q: PdfDocumentProfile = {
        presetId: "custom",
        sections: { showLogoRow: true, showPaymentAdvicePage: true },
        sectionOffsets: { showPaymentAdvicePage: { x: 3, y: 4 } },
      };
      const out = sanitizeInvoiceOnlyKeysFromNonInvoiceProfile("quotation", q);
      assert.equal(out.sections?.showPaymentAdvicePage, undefined);
      assert.equal(out.sectionOffsets?.showPaymentAdvicePage, undefined);
      const inv = sanitizeInvoiceOnlyKeysFromNonInvoiceProfile("invoice", {
        sections: { showPaymentAdvicePage: true },
      });
      assert.equal(inv.sections?.showPaymentAdvicePage, true);
    });

    it("sanitize strips job-order consultants keys from non-job-order profiles", () => {
      const invProf: PdfDocumentProfile = {
        presetId: "custom",
        sections: { showConsultantsLine: false },
        sectionOffsets: { jobOrderConsultants: { x: 1, y: 2 } },
      };
      const out = sanitizeInvoiceOnlyKeysFromNonInvoiceProfile("invoice", invProf);
      assert.equal(out.sections?.showConsultantsLine, undefined);
      assert.equal(out.sectionOffsets?.jobOrderConsultants, undefined);
    });
  });

  describe("diffProfile", () => {
    it("returns [] when comparing a preset to itself", () => {
      const p = getPreset("classic", "invoice");
      assert.deepEqual(diffProfile(p, p), []);
    });

    it("flags table-mode changes", () => {
      const a = getPreset("classic", "invoice");
      const b: PdfDocumentProfile = { ...a, tableMode: "detailed" };
      const diff = diffProfile(b, a);
      assert.ok(diff.some((d) => d.key === "tableMode"));
    });

    it("flags section toggle changes", () => {
      const a = getPreset("classic", "invoice");
      const b: PdfDocumentProfile = {
        ...a,
        sections: { ...a.sections, showLogoRow: false },
      };
      const diff = diffProfile(b, a);
      assert.ok(diff.some((d) => d.key === "sections.showLogoRow"));
    });

    it("flags non-zero offsets", () => {
      const a = getPreset("classic", "invoice");
      const b: PdfDocumentProfile = {
        ...a,
        sectionOffsets: {
          ...a.sectionOffsets,
          showTotals: { x: 16, y: -8 },
        },
      };
      const diff = diffProfile(b, a);
      assert.ok(diff.some((d) => d.key === "offset.showTotals"));
    });

    it("flags line-column reorders", () => {
      const a = getPreset("classic", "invoice");
      const b: PdfDocumentProfile = {
        ...a,
        lineColumns: {
          order: ["amount", "rate", "item", "quantity", "tax", "description"],
          visible: a.lineColumns?.visible ?? {},
        },
      };
      const diff = diffProfile(b, a);
      assert.ok(diff.some((d) => d.key === "lineColumns.order"));
    });

    it("flags line-column visibility changes", () => {
      const a = getPreset("classic", "invoice");
      const b: PdfDocumentProfile = {
        ...a,
        lineColumns: {
          order: a.lineColumns?.order ?? [],
          visible: { tax: false },
        },
      };
      const diff = diffProfile(b, a);
      assert.ok(diff.some((d) => d.key === "lineColumns.visible.tax"));
    });

    it("flags footer text changes", () => {
      const a = getPreset("classic", "invoice");
      const b: PdfDocumentProfile = { ...a, footerText: "custom footer" };
      const diff = diffProfile(b, a);
      assert.ok(diff.some((d) => d.key === "footerText"));
    });
  });

  describe("profilePreviewSignature", () => {
    it("ignores presetId so preview keys stay stable across preset detection", () => {
      const base = getPreset("classic", "invoice");
      const customId: PdfDocumentProfile = { ...base, presetId: "custom" };
      assert.equal(profilePreviewSignature(base), profilePreviewSignature(customId));
    });

    it("changes when PDF-relevant fields change", () => {
      const base = getPreset("classic", "invoice");
      const moved: PdfDocumentProfile = {
        ...base,
        sectionOffsets: { ...base.sectionOffsets, showTotals: { x: 8, y: 0 } },
      };
      assert.notEqual(profilePreviewSignature(base), profilePreviewSignature(moved));
    });
  });

  describe("detectPresetId", () => {
    it("returns the preset id when draft matches Classic", () => {
      assert.equal(detectPresetId(getPreset("classic", "invoice"), "invoice"), "classic");
    });

    it("returns 'custom' when the draft drifts from Classic", () => {
      const base = getPreset("classic", "invoice");
      const drifted: PdfDocumentProfile = {
        ...base,
        sectionOffsets: { ...base.sectionOffsets, showLogoRow: { x: 13, y: 27 } },
      };
      assert.equal(detectPresetId(drifted, "invoice"), "custom");
    });
  });
});
