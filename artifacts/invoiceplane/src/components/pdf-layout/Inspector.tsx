/**
 * Inspector — right-side controls for the Document layouts editor.
 *
 * Hosts: section toggles, footer text, line column order/visibility,
 * quotation/receipt extras, and a "Diff vs default" badge that lists changes
 * with per-field undo buttons.
 * Each group has its own Reset button restoring it to the Classic baseline.
 */
import { ChevronDown, ChevronUp, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { defaultSectionRects, sectionOffsetBounds, clampSectionOffset, type DocKind, type LayoutSectionKey } from "@/lib/pdfLayoutGeometry";
import type {
  CompanySettings,
  LineTableColumnKind,
  PdfDocumentProfile,
  PdfLayoutSections,
  PdfSectionOffsetKey,
} from "@/lib/modulesApi";
import { defaultProfile, diffProfile, type ProfileDiffEntry } from "@/lib/pdfLayoutPresets";

const LINE_COL_LABEL: Record<LineTableColumnKind, string> = {
  item: "Title / Item",
  description: "Notes / Description",
  quantity: "Qty",
  rate: "Rate",
  tax: "Tax %",
  amount: "Amount",
};

const SECTION_LABEL: Record<keyof PdfLayoutSections, string> = {
  showLogoRow: "Company logo row",
  showHeaderBannerLogo: "Header banner image",
  showTitleBlock: "Document title, number & date",
  showBillingBlock: "Bill-to / address block",
  showConsultantsLine: "Consultants on PDF",
  showJobOrderIssuerBlock: "Company address on PDF (right column)",
  showTotals: "Total",
  showBankAccounts: "Bank / payment details",
  showSignatures: "Signature block",
  showFooterAddress: "Footer / terms line",
  showPaymentAdvicePage: "Payment advice (bottom of invoice page 1, bank name & account no.)",
};

function sectionKeysForKind(kind: DocKind): (keyof PdfLayoutSections)[] {
  if (kind === "invoice") {
    return [
      "showLogoRow",
      "showHeaderBannerLogo",
      "showTitleBlock",
      "showBillingBlock",
      "showTotals",
      "showBankAccounts",
      "showSignatures",
      "showFooterAddress",
      "showPaymentAdvicePage",
    ];
  }
  if (kind === "receipt") {
    return [
      "showLogoRow",
      "showHeaderBannerLogo",
      "showTitleBlock",
      "showBillingBlock",
      "showTotals",
      "showFooterAddress",
    ];
  }
  if (kind === "quotation") {
    return [
      "showLogoRow",
      "showHeaderBannerLogo",
      "showTitleBlock",
      "showBillingBlock",
      "showTotals",
      "showBankAccounts",
      "showSignatures",
      "showFooterAddress",
    ];
  }
  return [
    "showLogoRow",
    "showHeaderBannerLogo",
    "showTitleBlock",
    "showBillingBlock",
    "showConsultantsLine",
    "showJobOrderIssuerBlock",
    "showTotals",
    "showSignatures",
    "showFooterAddress",
  ];
}

const TITLE_BLOCK_LABEL: Partial<Record<DocKind, string>> = {
  invoice: "Invoice title, number & date",
  quotation: "Quotation title, number & date",
  jobOrder: "Job order title, number & date",
  receipt: "Receipt title, number & reference",
};

function sectionLabelFor(sk: keyof PdfLayoutSections, kind: DocKind): string {
  if (sk === "showTitleBlock") return TITLE_BLOCK_LABEL[kind] ?? SECTION_LABEL[sk];
  if (sk === "showSignatures" && kind === "invoice") return "Company chop";
  return SECTION_LABEL[sk];
}

const DEFAULT_LINE_ORDER: LineTableColumnKind[] = [
  "item",
  "quantity",
  "rate",
  "tax",
  "amount",
  "description",
];

export interface InspectorProps {
  kind: DocKind;
  draft: PdfDocumentProfile;
  onChange: (next: PdfDocumentProfile) => void;
  /** Canvas block currently selected; matching section row will be highlighted. */
  selectedSection?: LayoutSectionKey | null;
  settings?: CompanySettings | null;
}

export function Inspector({ kind, draft, onChange, selectedSection, settings }: InspectorProps) {
  const titleRect = defaultSectionRects(kind, {
    hasCompanyLogo: Boolean(settings?.logoUrl),
    hasHeaderLogo: Boolean(settings?.headerLogoUrl),
    companyLogoScale: settings?.companyLogoScale,
    headerLogoScale: settings?.headerLogoScale,
    headerLogoWidthScale: settings?.headerLogoWidthScale,
    showLogoRow: draft.sections?.showLogoRow,
    showHeaderBannerLogo: draft.sections?.showHeaderBannerLogo,
    receiptAccentHeader: draft.receipt?.showAccentHeader,
    offLogoY: draft.sectionOffsets?.showLogoRow?.y ?? 0,
    offHeaderBannerY: draft.sectionOffsets?.showHeaderBannerLogo?.y ?? 0,
  }).showTitleBlock!;
  const titleBounds = sectionOffsetBounds(titleRect);
  const titleOffset = draft.sectionOffsets?.showTitleBlock ?? { x: 0, y: 0 };
  const setTitleOffset = (axis: "x" | "y", value: number) => {
    if (!Number.isFinite(value)) return;
    onChange({ ...draft, sectionOffsets: {
      ...draft.sectionOffsets,
      showTitleBlock: clampSectionOffset({ ...titleOffset, [axis]: value }, titleRect),
    } });
  };
  const sectionKeys = useMemo(() => sectionKeysForKind(kind), [kind]);
  const baseline = useMemo(() => defaultProfile(kind), [kind]);
  const diff = useMemo(() => diffProfile(draft, baseline), [draft, baseline]);

  const lineOrder = draft.lineColumns?.order ?? DEFAULT_LINE_ORDER;
  const lineVisible = draft.lineColumns?.visible ?? {};

  // Ref map for section rows so we can scroll them into view on selection.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!selectedSection) return;
    const el = rowRefs.current.get(selectedSection);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedSection]);

  const setSectionToggle = (k: keyof PdfLayoutSections, on: boolean) => {
    onChange({
      ...draft,
      sections: { ...draft.sections, [k]: on },
    });
  };

  const setFooter = (text: string) => onChange({ ...draft, footerText: text });

  const setTableMode = (mode: "simple" | "detailed") =>
    onChange({ ...draft, tableMode: mode });

  const moveCol = (i: number, dir: -1 | 1) => {
    const arr = [...lineOrder];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange({ ...draft, lineColumns: { order: arr, visible: lineVisible } });
  };

  const setColVisible = (col: LineTableColumnKind, on: boolean) => {
    const next = { ...lineVisible };
    if (on) delete next[col];
    else next[col] = false;
    onChange({ ...draft, lineColumns: { order: [...lineOrder], visible: next } });
  };

  const resetSections = () => onChange({ ...draft, sections: { ...baseline.sections } });
  const resetOffsets = () =>
    onChange({ ...draft, sectionOffsets: { ...baseline.sectionOffsets } });
  const resetFooter = () => onChange({ ...draft, footerText: baseline.footerText ?? "" });
  const resetLineColumns = () =>
    onChange({
      ...draft,
      tableMode: baseline.tableMode,
      lineColumns: baseline.lineColumns
        ? { order: [...(baseline.lineColumns.order ?? [])], visible: { ...(baseline.lineColumns.visible ?? {}) } }
        : undefined,
    });

  /** Revert a single diff entry back to the baseline value. */
  const handleRevertEntry = (key: string) => {
    let next: PdfDocumentProfile = { ...draft };

    if (key === "tableMode") {
      next.tableMode = baseline.tableMode;
    } else if (key.startsWith("sections.")) {
      const sk = key.slice("sections.".length) as keyof PdfLayoutSections;
      next = { ...next, sections: { ...next.sections, [sk]: baseline.sections?.[sk] } };
    } else if (key.startsWith("offset.")) {
      const ok = key.slice("offset.".length) as PdfSectionOffsetKey;
      next = {
        ...next,
        sectionOffsets: { ...next.sectionOffsets, [ok]: baseline.sectionOffsets?.[ok] ?? { x: 0, y: 0 } },
      };
    } else if (key === "lineColumns.order") {
      next = {
        ...next,
        lineColumns: { order: [...(baseline.lineColumns?.order ?? [])], visible: { ...(next.lineColumns?.visible ?? {}) } },
      };
    } else if (key.startsWith("lineColumns.visible.")) {
      const col = key.slice("lineColumns.visible.".length) as LineTableColumnKind;
      const newVis = { ...(next.lineColumns?.visible ?? {}) };
      const baseVal = baseline.lineColumns?.visible?.[col];
      if (baseVal === false) newVis[col] = false;
      else delete newVis[col];
      next = { ...next, lineColumns: { order: [...(next.lineColumns?.order ?? [])], visible: newVis } };
    } else if (key === "footerText") {
      next.footerText = baseline.footerText ?? "";
    } else if (key.startsWith("quotation.")) {
      const f = key.slice("quotation.".length) as keyof NonNullable<PdfDocumentProfile["quotation"]>;
      next = { ...next, quotation: { ...next.quotation, [f]: baseline.quotation?.[f] } };
    } else if (key.startsWith("receipt.")) {
      const f = key.slice("receipt.".length) as keyof NonNullable<PdfDocumentProfile["receipt"]>;
      next = { ...next, receipt: { ...next.receipt, [f]: baseline.receipt?.[f] } };
    }

    onChange(next);
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Layout settings</CardTitle>
        <DiffBadge count={diff.length} entries={diff} onRevert={handleRevertEntry} />
      </CardHeader>
      <CardContent className="space-y-5">
        <Group title="Title, number & date position" onReset={() => onChange({
          ...draft, sectionOffsets: { ...draft.sectionOffsets, showTitleBlock: { x: 0, y: 0 } },
        })}>
          <p className="text-xs text-muted-foreground">
            Moves the heading, number and date together. Negative Y moves up; values are offsets in PDF points.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["x", "y"] as const).map((axis) => (
              <div key={axis} className="space-y-1">
                <Label htmlFor={`${kind}-title-${axis}`}>{axis === "x" ? "X (left / right)" : "Y (up / down)"}</Label>
                <Input
                  id={`${kind}-title-${axis}`}
                  type="number"
                  step={1}
                  min={axis === "x" ? titleBounds.minX : titleBounds.minY}
                  max={axis === "x" ? titleBounds.maxX : titleBounds.maxY}
                  key={`${kind}-${axis}-${titleOffset[axis]}`}
                  defaultValue={titleOffset[axis]}
                  onBlur={(e) => {
                    const value = e.currentTarget.valueAsNumber;
                    setTitleOffset(axis, value);
                    e.currentTarget.value = String(Number.isFinite(value)
                      ? clampSectionOffset({ ...titleOffset, [axis]: value }, titleRect)[axis]
                      : titleOffset[axis]);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                />
              </div>
            ))}
          </div>
        </Group>
        <Group
          title="Sections on the PDF"
          onReset={resetSections}
          resetLabel="Reset section toggles"
        >
          <div className="grid grid-cols-1 gap-1.5">
            {sectionKeys.map((sk) => {
              const cur = draft.sections?.[sk];
              const effectiveOn = cur !== false;
              const isSelected = selectedSection === sk;
              return (
                <div
                  key={sk}
                  ref={(el) => {
                    if (el) rowRefs.current.set(sk, el);
                    else rowRefs.current.delete(sk);
                  }}
                  className={`flex items-center justify-between gap-2 rounded border px-3 py-1.5 transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : ""
                  }`}
                >
                  <Label className="text-xs cursor-pointer" htmlFor={`${kind}-${sk}`}>
                    {sectionLabelFor(sk, kind)}
                  </Label>
                  <Switch
                    id={`${kind}-${sk}`}
                    checked={effectiveOn}
                    onCheckedChange={(on) => setSectionToggle(sk, on)}
                  />
                </div>
              );
            })}
          </div>
          <div className="pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={resetOffsets}
            >
              <RotateCcw className="h-3 w-3" />
              Reset positions
            </Button>
          </div>
        </Group>

        {kind === "quotation" ? (
          <Group
            title="Quotation extras"
            onReset={() =>
              onChange({
                ...draft,
                quotation: { showRemarks: true, showPaymentTerms: true, showSignatureBlock: true },
              })
            }
          >
            {(
              [
                ["showRemarks", "Remarks block"],
                ["showPaymentTerms", "Terms & conditions"],
                ["showSignatureBlock", "Acceptance / signatures"],
              ] as const
            ).map(([k, label]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-2 rounded border px-3 py-1.5"
              >
                <Label className="text-xs cursor-pointer" htmlFor={`${kind}-qx-${k}`}>
                  {label}
                </Label>
                <Switch
                  id={`${kind}-qx-${k}`}
                  checked={draft.quotation?.[k] !== false}
                  onCheckedChange={(on) =>
                    onChange({
                      ...draft,
                      quotation: { ...draft.quotation, [k]: on },
                    })
                  }
                />
              </div>
            ))}
          </Group>
        ) : null}

        {kind === "receipt" ? (
          <Group
            title="Receipt style"
            onReset={() =>
              onChange({
                ...draft,
                receipt: { showAccentHeader: true, showChequeDetailRows: true, showCompanyChop: false },
              })
            }
          >
            <div className="flex items-center justify-between gap-2 rounded border px-3 py-1.5">
              <Label className="text-xs cursor-pointer" htmlFor={`${kind}-rx-cheque`}>
                Cheque detail rows
              </Label>
              <Switch
                id={`${kind}-rx-cheque`}
                checked={draft.receipt?.showChequeDetailRows !== false}
                onCheckedChange={(on) =>
                  onChange({
                    ...draft,
                    receipt: { ...draft.receipt, showChequeDetailRows: on },
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded border px-3 py-1.5">
              <Label className="text-xs cursor-pointer" htmlFor={`${kind}-rx-chop`}>
                Company chop
              </Label>
              <Switch
                id={`${kind}-rx-chop`}
                checked={draft.receipt?.showCompanyChop === true}
                onCheckedChange={(on) =>
                  onChange({
                    ...draft,
                    receipt: { ...draft.receipt, showCompanyChop: on },
                  })
                }
              />
            </div>
            <p className="text-[10px] text-muted-foreground px-0.5">
              Uses the company chop image from Company settings. Off by default.
            </p>
          </Group>
        ) : null}

        <Separator />

        <Group title="Footer / closing line" onReset={resetFooter}>
          <Textarea
            className="min-h-[72px] text-sm"
            value={draft.footerText ?? ""}
            onChange={(e) => setFooter(e.target.value)}
            placeholder={
              kind === "quotation"
                ? "Thank you for your consideration!"
                : kind === "receipt"
                  ? "Optional receipt footer…"
                  : "Thank you for your business !"
            }
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Shown when the footer section is on. Default applies when empty.
          </p>
        </Group>

        <Separator />

        <Group title="Line items" onReset={resetLineColumns}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <Label htmlFor={`mode-${kind}`} className="text-xs">
              Detailed line table
            </Label>
            <Switch
              id={`mode-${kind}`}
              checked={draft.tableMode === "detailed"}
              onCheckedChange={(c) => setTableMode(c ? "detailed" : "simple")}
            />
          </div>
          <div className="space-y-1">
            {lineOrder.map((col, idx) => (
              <div
                key={col}
                className="flex items-center gap-2 rounded border px-2 py-1 text-sm bg-background/80"
              >
                <span className="flex-1 truncate">{LINE_COL_LABEL[col]}</span>
                <div className="flex gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === 0}
                    onClick={() => moveCol(idx, -1)}
                    aria-label={`Move ${LINE_COL_LABEL[col]} up`}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={idx === lineOrder.length - 1}
                    onClick={() => moveCol(idx, 1)}
                    aria-label={`Move ${LINE_COL_LABEL[col]} down`}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
                <Switch
                  checked={lineVisible[col] !== false}
                  onCheckedChange={(on) => setColVisible(col, on)}
                  aria-label={`Toggle ${LINE_COL_LABEL[col]} visibility`}
                />
              </div>
            ))}
          </div>
        </Group>
      </CardContent>
    </Card>
  );
}

function Group({
  title,
  onReset,
  resetLabel,
  children,
}: {
  title: string;
  onReset?: () => void;
  resetLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{title}</p>
        {onReset ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={onReset}
            title={resetLabel ?? "Reset to default"}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function DiffBadge({
  count,
  entries,
  onRevert,
}: {
  count: number;
  entries: ProfileDiffEntry[];
  onRevert: (key: string) => void;
}) {
  if (count === 0) {
    return (
      <Badge variant="outline" className="text-[10px]">
        No changes vs default
      </Badge>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <Badge variant="default" className="cursor-pointer text-[10px] select-none">
            {count} change{count === 1 ? "" : "s"} vs default
          </Badge>
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="text-[10px] font-medium text-muted-foreground mb-1.5 px-1">
          Changes from Classic — click ↩ to revert one
        </p>
        <ul className="space-y-0.5">
          {entries.slice(0, 20).map((e) => (
            <li
              key={e.key}
              className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted/50"
            >
              <span className="text-xs truncate flex-1">{e.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onRevert(e.key)}
                aria-label={`Revert: ${e.label}`}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
          {entries.length > 20 ? (
            <li className="text-[10px] opacity-70 px-1">…and {entries.length - 20} more</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
