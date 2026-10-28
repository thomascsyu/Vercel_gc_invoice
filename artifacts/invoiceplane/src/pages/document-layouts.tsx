/**
 * Document layouts editor (redesigned).
 *
 * Three-pane layout: Presets rail (left), A4 WYSIWYG canvas + live preview
 * (center), Inspector (right). Each document kind (invoice, quotation,
 * job order, receipt) has its own draft profile that can be saved
 * independently. Saved data continues to use `pdf_document_layouts` JSON.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Columns2, FileSignature, FileText, LayoutTemplate, Rows2, ReceiptText, Save } from "lucide-react";
import { useListClients, type Client } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { PdfBrandingReadiness } from "@/components/pdf-branding-readiness";
import { useToast } from "@/hooks/use-toast";
import {
  apiGetBrandingStorageStatus,
  apiGetPdfDocumentLayouts,
  apiGetSettings,
  apiPatchPdfDocumentLayouts,
  type CompanySettings,
  type PdfDocumentLayouts,
  type PdfDocumentProfile,
  type PdfSectionOffsetPoint,
} from "@/lib/modulesApi";
import {
  type DocKind,
  type LayoutSectionKey,
} from "@/lib/pdfLayoutGeometry";
import {
  defaultProfile,
  detectPresetId,
  diffProfile,
  getPreset,
  PRESET_LIST,
  sanitizeInvoiceOnlyKeysFromNonInvoiceProfile,
  type PresetId,
} from "@/lib/pdfLayoutPresets";
import { A4LayoutCanvas } from "@/components/pdf-layout/A4LayoutCanvas";
import {
  PresetsRail,
  readActivePresetForKind,
  writeActivePresetForKind,
} from "@/components/pdf-layout/PresetsRail";
import { Inspector } from "@/components/pdf-layout/Inspector";
import { LivePdfPreview } from "@/components/pdf-layout/LivePdfPreview";

const TAB_META: { kind: DocKind; label: string; icon: typeof FileText }[] = [
  { kind: "invoice", label: "Invoices", icon: FileText },
  { kind: "quotation", label: "Quotations", icon: FileSignature },
  { kind: "jobOrder", label: "Job orders", icon: Briefcase },
  { kind: "receipt", label: "Receipts", icon: ReceiptText },
];

/** Merge a saved (partial) profile from the server over the default profile. */
function mergeFromServer(kind: DocKind, server: PdfDocumentLayouts | undefined): PdfDocumentProfile {
  const base = defaultProfile(kind);
  const saved = server?.[kind];
  if (!saved) return base;
  const savedPresetId =
    saved.presetId === "classic" || saved.presetId === "custom" ? saved.presetId : undefined;
  const merged: PdfDocumentProfile = {
    presetId: savedPresetId ?? base.presetId,
    tableMode: saved.tableMode ?? base.tableMode,
    sections: { ...base.sections, ...(saved.sections ?? {}) },
    sectionOffsets: { ...base.sectionOffsets, ...(saved.sectionOffsets ?? {}) },
    lineColumns: saved.lineColumns
      ? {
          order: saved.lineColumns.order ?? base.lineColumns?.order ?? [],
          visible: { ...(base.lineColumns?.visible ?? {}), ...(saved.lineColumns.visible ?? {}) },
        }
      : base.lineColumns,
    footerText: saved.footerText ?? base.footerText,
    quotation: { ...(base.quotation ?? {}), ...(saved.quotation ?? {}) },
    receipt: { ...(base.receipt ?? {}), ...(saved.receipt ?? {}) },
  };
  return sanitizeInvoiceOnlyKeysFromNonInvoiceProfile(kind, merged);
}

/** Effective preset id for the current draft (auto-detected if not custom). */
function effectivePresetId(draft: PdfDocumentProfile, kind: DocKind): PresetId {
  return detectPresetId(draft, kind);
}

export default function DocumentLayoutsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeKind, setActiveKind] = useState<DocKind>("invoice");

  const { data: layoutData } = useQuery({
    queryKey: ["/pdf-document-layouts"],
    queryFn: apiGetPdfDocumentLayouts,
  });

  const { data: settings } = useQuery({
    queryKey: ["/company-settings"],
    queryFn: apiGetSettings,
  });

  const hasBranding = Boolean(settings?.logoUrl || settings?.headerLogoUrl);
  const { data: brandingStorageStatus } = useQuery({
    queryKey: ["/uploads/branding/storage-status"],
    queryFn: apiGetBrandingStorageStatus,
    enabled: hasBranding,
    staleTime: 60_000,
  });

  const { data: clientsPage } = useListClients({ page: 1, pageSize: 1 });
  const clients: Client[] = clientsPage?.data ?? [];
  const hasClient = clients.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <LayoutTemplate className="h-7 w-7 text-primary" aria-hidden />
          <h2 className="text-2xl font-bold tracking-tight">Document layouts</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          Pick a starting preset, then drag sections on the A4 canvas. The PDF preview updates live as you edit.
        </p>
      </div>

      <Tabs value={activeKind} onValueChange={(v) => setActiveKind(v as DocKind)}>
        <TabsList>
          {TAB_META.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.kind} value={t.kind} className="gap-2">
                <Icon className="h-4 w-4" aria-hidden />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <KindEditor
        key={activeKind}
        kind={activeKind}
        settings={settings ?? null}
        layoutData={layoutData}
        hasClient={hasClient}
        brandingNonPersistent={hasBranding && brandingStorageStatus?.persistent === false}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["/pdf-document-layouts"] });
          toast({ title: "PDF layout saved", description: `Layout for ${activeKind} updated.` });
        }}
      />

      {!hasClient ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Add at least one client before previewing — the preview uses your first client as sample bill-to data.
        </p>
      ) : null}
    </div>
  );
}

function KindEditor({
  kind,
  settings,
  layoutData,
  hasClient,
  brandingNonPersistent,
  onSaved,
}: {
  kind: DocKind;
  settings: CompanySettings | null;
  layoutData: PdfDocumentLayouts | undefined;
  hasClient: boolean;
  brandingNonPersistent: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<PdfDocumentProfile>(() => mergeFromServer(kind, layoutData));
  const [selectedSection, setSelectedSection] = useState<LayoutSectionKey | null>(null);
  const [previewLayout, setPreviewLayout] = useState<"stacked" | "split">("stacked");

  useEffect(() => {
    setDraft(mergeFromServer(kind, layoutData));
  }, [kind, layoutData]);

  const activePresetId = useMemo<PresetId>(() => {
    if (draft.presetId === "classic") {
      const candidate = getPreset("classic", kind);
      if (diffProfile(draft, candidate).length === 0) return "classic";
    }
    return effectivePresetId(draft, kind);
  }, [draft, kind]);

  const applyPreset = (id: Exclude<PresetId, "custom">) => {
    const next = { ...getPreset(id, kind), presetId: id };
    setDraft(next);
    writeActivePresetForKind(kind, id);
    toast({ title: `Applied preset: ${PRESET_LIST.find((p) => p.id === id)?.label ?? id}` });
  };

  const onResetAll = () => {
    applyPreset("classic");
  };

  const onOffsetChange = useCallback(
    (key: LayoutSectionKey, value: PdfSectionOffsetPoint) => {
      setDraft((prev) => {
        const nextOffsets = { ...(prev.sectionOffsets ?? {}), [key]: value };
        const next: PdfDocumentProfile = {
          ...prev,
          sectionOffsets: nextOffsets,
          presetId: effectivePresetId({ ...prev, sectionOffsets: nextOffsets }, kind),
        };
        return next;
      });
    },
    [kind],
  );

  const handleInspectorChange = useCallback(
    (next: PdfDocumentProfile) => {
      const detected = effectivePresetId(next, kind);
      setDraft({ ...next, presetId: detected });
    },
    [kind],
  );

  const saveMut = useMutation({
    mutationFn: async () => {
      const detected = effectivePresetId(draft, kind);
      const cleaned = sanitizeInvoiceOnlyKeysFromNonInvoiceProfile(kind, { ...draft, presetId: detected });
      const payload: PdfDocumentLayouts = {
        [kind]: cleaned,
      };
      await apiPatchPdfDocumentLayouts(payload);
    },
    onSuccess: () => {
      onSaved();
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  // Read the locally-remembered preset id once on mount (for the initial state
  // before the server returns a saved layout). Preference is informational —
  // we don't auto-apply because the user may have saved a custom profile.
  useEffect(() => {
    if (draft.presetId && draft.presetId !== "custom") return;
    const local = readActivePresetForKind(kind);
    if (!local) return;
    setDraft((prev) => ({ ...prev, presetId: prev.presetId ?? local }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per kind mount
  }, []);

  /** Canvas hidden state for jobOrderConsultants follows "Consultants on PDF" (`!== false`, same as Inspector). */
  const sectionToggles = useMemo(
    () =>
      kind === "jobOrder"
        ? ({
            ...((draft.sections ?? {}) as Record<string, boolean | undefined>),
            jobOrderConsultants: draft.sections?.showConsultantsLine !== false,
          } as Record<string, boolean | undefined>)
        : ((draft.sections ?? {}) as Record<string, boolean | undefined>),
    [kind, draft.sections],
  );
  const sectionOffsets = draft.sectionOffsets ?? {};

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
      <div className="lg:sticky lg:top-4 self-start">
        <PresetsRail
          activeId={activePresetId}
          onApply={applyPreset}
          onResetAll={onResetAll}
        />
      </div>

      <div className="min-w-0 space-y-4">
        <PdfBrandingReadiness
          logo={Boolean(settings?.logoUrl)}
          header={Boolean(settings?.headerLogoUrl)}
          chop={Boolean(settings?.chopUrl)}
          includeChop={kind !== "jobOrder"}
        />
        {brandingNonPersistent ? (
          <p className="text-sm border rounded-md p-2 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Branding images are stored on temporary server disk and can disappear when the app
            container is replaced. The canvas above may still show a logo cached by your browser even
            after the file is gone, so the PDF preview and generated PDFs will be missing it until you
            re-upload. Open{" "}
            <Link href="/admin?tab=company-branding" className="font-medium underline">
              Company settings → Branding
            </Link>{" "}
            to re-upload, or configure persistent storage.
          </p>
        ) : null}
        <div className={previewLayout === "split" ? "flex gap-4 items-start" : "space-y-4"}>
          <div className={previewLayout === "split" ? "flex-1 min-w-0" : undefined}>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div>
                    <p className="text-sm font-medium">A4 canvas</p>
                    <p className="text-xs text-muted-foreground">
                      Drag sections; positions snap to an 8 pt grid on release. Pink lines indicate alignment with the
                      page or other blocks. Block sizes are approximate; check the PDF preview for final spacing.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setPreviewLayout((p) => p === "stacked" ? "split" : "stacked")}
                      title={previewLayout === "stacked" ? "Side-by-side preview" : "Stacked preview"}
                    >
                      {previewLayout === "stacked" ? (
                        <Columns2 className="h-4 w-4" aria-hidden />
                      ) : (
                        <Rows2 className="h-4 w-4" aria-hidden />
                      )}
                      {previewLayout === "stacked" ? "Split" : "Stack"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="gap-2"
                      onClick={() => saveMut.mutate()}
                      disabled={saveMut.isPending}
                    >
                      <Save className="h-4 w-4" aria-hidden />
                      Save layout
                    </Button>
                  </div>
                </div>
                <div className="overflow-auto">
                  <A4LayoutCanvas
                    kind={kind}
                    sectionToggles={sectionToggles}
                    sectionOffsets={sectionOffsets}
                    onOffsetChange={onOffsetChange}
                    logoUrl={settings?.logoUrl}
                    headerBannerUrl={settings?.headerLogoUrl}
                    stampUrl={settings?.chopUrl}
                    chopScale={settings?.chopScale}
                    companyLogoScale={settings?.companyLogoScale}
                    headerLogoScale={settings?.headerLogoScale}
                    headerLogoWidthScale={settings?.headerLogoWidthScale}
                    receiptAccentHeader={draft.receipt?.showAccentHeader}
                    selectedSection={selectedSection}
                    onSectionSelect={setSelectedSection}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className={previewLayout === "split" ? "flex-1 min-w-0" : undefined}>
            <LivePdfPreview
              kind={kind}
              profile={draft}
              disabled={!hasClient}
              height={previewLayout === "split" ? 560 : 720}
              brandingKey={[
                settings?.updatedAt ?? "",
                settings?.logoUrl ?? "",
                settings?.headerLogoUrl ?? "",
                settings?.chopUrl ?? "",
                settings?.companyLogoScale ?? "",
                settings?.headerLogoScale ?? "",
                settings?.headerLogoWidthScale ?? "",
                settings?.chopScale ?? "",
              ].join("|")}
            />
          </div>
        </div>
      </div>

      <div className="lg:sticky lg:top-4 self-start">
        <Inspector
          kind={kind}
          draft={draft}
          onChange={handleInspectorChange}
          selectedSection={selectedSection}
          settings={settings}
        />
      </div>
    </div>
  );
}
