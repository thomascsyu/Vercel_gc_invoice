/**
 * A4LayoutCanvas — WYSIWYG editor surface for the Document layouts page.
 *
 * Renders an A4-ratio surface with each layout section drawn at its
 * approximate PDF footprint. Users drag blocks to nudge their `sectionOffsets`
 * (PDF points). Snap-to-grid (8 pt) applies on pointer-up. Alignment guides
 * appear while dragging; overlapping blocks are flagged with a warning border.
 */
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/api-base";
import {
  brandingScaleFactor,
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  PAGE_MARGIN_PT,
  SNAP_GRID_PT,
  VISUAL_PT_SCALE,
  defaultSectionRects,
  type DocKind,
  type LayoutSectionKey,
  ptToPx,
  clampSectionOffset,
  snapSectionOffset,
  SECTION_LABEL,
} from "@/lib/pdfLayoutGeometry";
import type { PdfSectionOffsetPoint } from "@/lib/modulesApi";
import {
  computeBlocks,
  computeGuides,
  detectCollisions,
  type BlockGeom,
} from "./canvasGeometry";
import { useHeaderBannerAspectRatio } from "./useHeaderBannerAspectRatio";

/**
 * `BlockBody` content renders inside a wrapper scaled down by `VISUAL_PT_SCALE`
 * (see `LayoutBlock`'s "Draw content in PDF-point units" div), so a literal
 * `font-size: Npx` there ends up Nx `VISUAL_PT_SCALE` on screen. This converts
 * a desired on-screen pixel size into the pt-space unit that yields it.
 */
const onScreenPx = (px: number) => px / VISUAL_PT_SCALE;

const TITLE_BLOCK_LABEL: Record<DocKind, string> = {
  invoice: "Invoice title, number & date",
  quotation: "Quotation title, number & date",
  jobOrder: "Job order title, number & date",
  receipt: "Receipt title, number & reference",
};

const TITLE_HEADING: Record<DocKind, string> = {
  invoice: "INVOICE",
  quotation: "QUOTATION",
  jobOrder: "JOB ORDER",
  receipt: "RECEIPT",
};

export interface A4LayoutCanvasProps {
  kind: DocKind;
  /** Section toggle map; `false` = explicitly hidden. */
  sectionToggles: Record<string, boolean | undefined>;
  /** Current XY offset per section (PDF points). */
  sectionOffsets: Partial<Record<LayoutSectionKey, PdfSectionOffsetPoint>>;
  /**
   * Called when the user finishes dragging a section (pointer-up). Positions are
   * snapped to the 8 pt grid before this fires.
   */
  onOffsetChange: (key: LayoutSectionKey, value: PdfSectionOffsetPoint) => void;
  /** Optional: company logo URL to render inside the logo block. */
  logoUrl?: string | null;
  /** Optional: header banner image URL to render in the banner block. */
  headerBannerUrl?: string | null;
  /** Optional: company chop (invoice & quotation PDFs). */
  stampUrl?: string | null;
  chopScale?: number | null;
  /** Company logo size multiplier (1–2), matching Branding & images. */
  companyLogoScale?: number | null;
  /** Header banner size multiplier (1–2), matching Branding & images. */
  headerLogoScale?: number | null;
  /** Header banner width as a fraction of content width (0.25–1), matching Branding & images. */
  headerLogoWidthScale?: number | null;
  /** Show snap grid. */
  showGrid?: boolean;
  /** Currently selected section (highlights block and syncs inspector). */
  selectedSection?: LayoutSectionKey | null;
  /** Called when user clicks a block; null when clicking the canvas background. */
  onSectionSelect?: (key: LayoutSectionKey | null) => void;
  /** Receipt: accent header band height on canvas (matches PDF). */
  receiptAccentHeader?: boolean;
}

interface DragState {
  key: LayoutSectionKey;
  startX: number;
  startY: number;
  startOff: PdfSectionOffsetPoint;
}

export function A4LayoutCanvas({
  kind,
  sectionToggles,
  sectionOffsets,
  onOffsetChange,
  logoUrl,
  headerBannerUrl,
  stampUrl,
  chopScale,
  companyLogoScale,
  headerLogoScale,
  headerLogoWidthScale,
  showGrid = true,
  selectedSection,
  onSectionSelect,
  receiptAccentHeader,
}: A4LayoutCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draggingKey, setDraggingKey] = useState<LayoutSectionKey | null>(null);
  /** Live offset while dragging — kept local to avoid parent re-renders per pointer move. */
  const [dragLiveOffset, setDragLiveOffset] = useState<PdfSectionOffsetPoint | null>(null);
  const headerBannerAspectRatio = useHeaderBannerAspectRatio(headerBannerUrl);

  const pageW = ptToPx(A4_WIDTH_PT);
  const pageH = ptToPx(A4_HEIGHT_PT);
  const gridPx = SNAP_GRID_PT * VISUAL_PT_SCALE;
  const marginPx = ptToPx(PAGE_MARGIN_PT);

  const layoutRectOpts = useMemo(
    () => ({
      companyLogoScale,
      headerLogoScale,
      headerLogoWidthScale,
      showLogoRow: sectionToggles.showLogoRow !== false,
      showHeaderBannerLogo: sectionToggles.showHeaderBannerLogo !== false,
      hasCompanyLogo: Boolean(logoUrl),
      hasHeaderLogo: Boolean(headerBannerUrl),
      receiptAccentHeader,
      headerBannerAspectRatio,
    }),
    [
      companyLogoScale,
      headerLogoScale,
      headerLogoWidthScale,
      sectionToggles.showLogoRow,
      sectionToggles.showHeaderBannerLogo,
      logoUrl,
      headerBannerUrl,
      receiptAccentHeader,
      headerBannerAspectRatio,
    ],
  );

  const sectionRects = useMemo(
    () => defaultSectionRects(kind, layoutRectOpts),
    [kind, layoutRectOpts],
  );

  const sectionBaseRect = useCallback(
    (key: LayoutSectionKey) => sectionRects[key],
    [sectionRects],
  );

  const clampDragOffset = useCallback(
    (key: LayoutSectionKey, off: PdfSectionOffsetPoint): PdfSectionOffsetPoint => {
      const rect = sectionBaseRect(key);
      if (!rect) return off;
      return clampSectionOffset(off, rect);
    },
    [sectionBaseRect],
  );

  const snapDragOffset = useCallback(
    (key: LayoutSectionKey, off: PdfSectionOffsetPoint): PdfSectionOffsetPoint => {
      const rect = sectionBaseRect(key);
      if (!rect) return off;
      return snapSectionOffset(off, rect);
    },
    [sectionBaseRect],
  );

  const effectiveOffsets = useMemo(() => {
    if (!draggingKey || !dragLiveOffset) return sectionOffsets;
    return { ...sectionOffsets, [draggingKey]: dragLiveOffset };
  }, [sectionOffsets, draggingKey, dragLiveOffset]);

  const blocks = useMemo(
    () =>
      computeBlocks(kind, sectionToggles, effectiveOffsets, {
        companyLogoScale,
        headerLogoScale,
        headerLogoWidthScale,
        receiptAccentHeader,
        hasCompanyLogo: Boolean(logoUrl),
        hasHeaderLogo: Boolean(headerBannerUrl),
        headerBannerAspectRatio,
      }),
    [
      kind,
      sectionToggles,
      effectiveOffsets,
      companyLogoScale,
      headerLogoScale,
      headerLogoWidthScale,
      receiptAccentHeader,
      logoUrl,
      headerBannerUrl,
      headerBannerAspectRatio,
    ],
  );
  const collisions = useMemo(() => detectCollisions(blocks), [blocks]);

  const activeBlock = blocks.find((b) => b.key === draggingKey) ?? null;
  const guides = useMemo(() => {
    if (!activeBlock) return [];
    return computeGuides(
      activeBlock,
      blocks.filter((b) => b.key !== activeBlock.key),
      pageW,
      pageH,
    );
  }, [activeBlock, blocks, pageW, pageH]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent, key: LayoutSectionKey) => {
      if (e.button !== 0) return;
      e.preventDefault();
      surfaceRef.current?.setPointerCapture(e.pointerId);
      const startOff = sectionOffsets[key] ?? { x: 0, y: 0 };
      dragRef.current = {
        key,
        startX: e.clientX,
        startY: e.clientY,
        startOff: { x: startOff.x, y: startOff.y },
      };
      setDraggingKey(key);
      onSectionSelect?.(key);
    },
    [sectionOffsets, onSectionSelect],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dxPx = e.clientX - d.startX;
      const dyPx = e.clientY - d.startY;
      const next = clampDragOffset(d.key, {
        x: d.startOff.x + dxPx / VISUAL_PT_SCALE,
        y: d.startOff.y + dyPx / VISUAL_PT_SCALE,
      });
      setDragLiveOffset(next);
    },
    [clampDragOffset],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      const d = dragRef.current;
      if (d) {
        const dxPx = e.clientX - d.startX;
        const dyPx = e.clientY - d.startY;
        const snapped = snapDragOffset(d.key, {
          x: d.startOff.x + dxPx / VISUAL_PT_SCALE,
          y: d.startOff.y + dyPx / VISUAL_PT_SCALE,
        });
        onOffsetChange(d.key, snapped);
        try {
          surfaceRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      dragRef.current = null;
      setDraggingKey(null);
      setDragLiveOffset(null);
    },
    [onOffsetChange, snapDragOffset],
  );

  const surfaceStyle: CSSProperties = {
    width: pageW,
    height: pageH,
    backgroundImage: showGrid
      ? `
        linear-gradient(to right, hsl(var(--border) / 0.4) 1px, transparent 1px),
        linear-gradient(to bottom, hsl(var(--border) / 0.4) 1px, transparent 1px)
      `
      : undefined,
    backgroundSize: showGrid ? `${gridPx}px ${gridPx}px` : undefined,
    backgroundPosition: `${marginPx}px 0`,
  };

  return (
    <div
      ref={surfaceRef}
      role="presentation"
      data-testid="a4-layout-canvas"
      className="relative mx-auto select-none touch-none rounded-md bg-card ring-1 ring-border shadow-sm overflow-hidden"
      style={surfaceStyle}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-section]")) return;
        onSectionSelect?.(null);
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 border border-dashed border-border/60"
        style={{
          left: marginPx,
          top: marginPx,
          right: marginPx,
          bottom: marginPx,
          width: pageW - marginPx * 2,
          height: pageH - marginPx * 2,
        }}
      />

      {guides.map((g, i) => (
        <div
          key={`${g.axis}-${g.pos}-${i}`}
          aria-hidden
          className="pointer-events-none absolute bg-pink-500/70"
          style={
            g.axis === "x"
              ? { left: Math.round(g.pos), top: 0, width: 1, height: pageH }
              : { top: Math.round(g.pos), left: 0, height: 1, width: pageW }
          }
        />
      ))}

      {blocks.map((b) => {
        const overlapping = collisions.has(b.key);
        const isDragging = draggingKey === b.key;
        const isSelected = selectedSection === b.key;
        const off = effectiveOffsets[b.key] ?? { x: 0, y: 0 };

        return (
          <LayoutBlock
            key={b.key}
            block={b}
            kind={kind}
            off={off}
            overlapping={overlapping}
            isDragging={isDragging}
            isSelected={isSelected}
            logoUrl={logoUrl}
            headerBannerUrl={headerBannerUrl}
            stampUrl={stampUrl}
            chopScale={chopScale}
            onPointerDown={onPointerDown}
          />
        );
      })}
    </div>
  );
}

const LayoutBlock = memo(function LayoutBlock({
  block: b,
  kind,
  off,
  overlapping,
  isDragging,
  isSelected,
  logoUrl,
  headerBannerUrl,
  stampUrl,
  chopScale,
  onPointerDown,
}: {
  block: BlockGeom;
  kind: DocKind;
  off: PdfSectionOffsetPoint;
  overlapping: boolean;
  isDragging: boolean;
  isSelected: boolean;
  logoUrl?: string | null;
  headerBannerUrl?: string | null;
  stampUrl?: string | null;
  chopScale?: number | null;
  onPointerDown: (e: ReactPointerEvent, key: LayoutSectionKey) => void;
}) {
  return (
    <div
      data-section={b.key}
      data-hidden={b.hidden ? "true" : undefined}
      data-overlap={overlapping ? "true" : undefined}
      className={cn(
        "group absolute rounded-sm text-[10px] font-medium",
        "flex flex-col cursor-grab active:cursor-grabbing outline outline-1 -outline-offset-1",
        "transition-shadow",
        b.hidden
          ? "outline-dashed outline-muted-foreground/40 bg-muted/40 text-muted-foreground opacity-60"
          : overlapping
            ? "outline-amber-500/80 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 shadow"
            : "outline-primary/30 bg-card/95 text-foreground shadow-sm",
        isDragging && "ring-2 ring-primary/40 shadow-lg z-20",
        isSelected && !isDragging && "ring-2 ring-primary shadow-md z-10",
      )}
      style={{
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
      }}
      onPointerDown={(e) => onPointerDown(e, b.key)}
    >
      {/* Editor labels overlay the footprint; they must never shrink PDF content. */}
      <div className={cn(
        "pointer-events-none absolute left-0 top-0 z-30 flex max-w-full items-center gap-1 rounded-sm bg-background/95 px-1 text-[9px] leading-3 shadow-sm",
        isSelected || isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}>
        <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {b.key === "showSignatures" && kind === "invoice"
            ? "Company chop"
            : b.key === "showTitleBlock"
              ? TITLE_BLOCK_LABEL[kind]
              : SECTION_LABEL[b.key]}
        </span>
        <span className="shrink-0 tabular-nums text-[9px] text-muted-foreground">
          {off.x !== 0 || off.y !== 0 ? `x${off.x} y${off.y}` : ""}
        </span>
      </div>
      {/* Draw content in PDF-point units, then scale everything together. */}
      <div
        className="absolute left-0 top-0 flex flex-col overflow-hidden origin-top-left"
        style={{
          width: b.width / VISUAL_PT_SCALE,
          height: b.height / VISUAL_PT_SCALE,
          transform: `scale(${VISUAL_PT_SCALE})`,
        }}
      >
        <BlockBody
          docKind={kind}
          section={b.key}
          logoUrl={logoUrl ?? undefined}
          headerBannerUrl={headerBannerUrl ?? undefined}
          stampUrl={stampUrl ?? undefined}
          chopScale={chopScale}
        />
      </div>
    </div>
  );
});

const BlockBody = memo(function BlockBody({
  docKind,
  section,
  logoUrl,
  headerBannerUrl,
  stampUrl,
  chopScale,
}: {
  docKind: DocKind;
  section: LayoutSectionKey;
  logoUrl?: string;
  headerBannerUrl?: string;
  stampUrl?: string;
  chopScale?: number | null;
}) {
  /**
   * Tracks the most recent <img> src whose load failed (e.g. the stored URL
   * 404s because the file is missing from storage — ephemeral disk wiped by
   * a redeploy). Comparing against the current src rather than a plain
   * boolean "resets" this automatically when the branding URL changes,
   * without needing an effect. Mirrors the same fix on the Admin > Branding
   * preview thumbnails (a bare failed <img> otherwise shows a near-invisible
   * broken-image glyph, reading as no logo at all).
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (section === "showLogoRow") {
    const src = logoUrl ? resolvePublicAssetUrl(logoUrl) : "";
    return (
      <div className="absolute inset-0 overflow-hidden">
        {src && src !== failedSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            aria-hidden
            className="block h-full w-full object-contain object-left-top"
            draggable={false}
            onError={() => setFailedSrc(src)}
          />
        ) : logoUrl ? (
          <span className="text-center text-amber-700 dark:text-amber-400" style={{ fontSize: onScreenPx(9) }}>
            Image failed to load — re-upload under Company settings
          </span>
        ) : (
          <span className="text-muted-foreground" style={{ fontSize: onScreenPx(9) }}>
            [logo]
          </span>
        )}
      </div>
    );
  }
  if (section === "showHeaderBannerLogo") {
    const src = headerBannerUrl ? resolvePublicAssetUrl(headerBannerUrl) : "";
    return (
      <div className="absolute inset-0 overflow-hidden">
        {src && src !== failedSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            aria-hidden
            className="block h-full w-full object-contain object-left"
            draggable={false}
            onError={() => setFailedSrc(src)}
          />
        ) : headerBannerUrl ? (
          <span className="text-center text-amber-700 dark:text-amber-400" style={{ fontSize: onScreenPx(9) }}>
            Image failed to load — re-upload under Company settings
          </span>
        ) : (
          <span className="text-muted-foreground" style={{ fontSize: onScreenPx(9) }}>
            [header banner]
          </span>
        )}
      </div>
    );
  }
  if (section === "showTitleBlock") {
    return (
      <div className="flex-1 flex items-center justify-between gap-1 overflow-hidden">
        <span
          className="font-bold tracking-tight text-foreground/80 truncate"
          style={{ fontSize: docKind === "jobOrder" ? 24 : 28 }}
        >
          {TITLE_HEADING[docKind]}
        </span>
        <span
          className="shrink-0 text-right leading-tight text-muted-foreground"
          style={{ fontSize: onScreenPx(10) }}
        >
          <div>No. …</div>
          <div>Date: …</div>
        </span>
      </div>
    );
  }
  if (section === "lineItems") {
    return (
      <div className="flex-1 flex items-center overflow-hidden rounded-sm border border-dashed border-foreground/20 bg-muted/20">
        <span
          className="w-full text-center text-muted-foreground"
          style={{ fontSize: onScreenPx(9) }}
        >
          Table area
        </span>
      </div>
    );
  }
  if (section === "showTotals") {
    return (
      <div className="flex-1 flex flex-col items-end justify-end gap-0.5 overflow-hidden">
        <div className="h-1 w-1/2 bg-foreground/30 rounded-sm" />
        <div className="h-1 w-1/4 bg-foreground/40 rounded-sm" />
      </div>
    );
  }
  if (section === "showBillingBlock") {
    // Job order: this block occupies the left column only (the right column
    // is the consultants/issuer block), so mock a single address column
    // rather than the two-column placeholder used by the full-width kinds.
    if (docKind === "jobOrder") {
      return (
        <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
          <div className="h-px bg-foreground/30 w-3/4" />
          <div className="h-px bg-foreground/20 w-2/3" />
          <div className="h-px bg-foreground/20 w-1/2" />
        </div>
      );
    }
    return (
      <div className="flex-1 grid grid-cols-2 gap-1 overflow-hidden">
        <div className="flex flex-col gap-0.5">
          <div className="h-px bg-foreground/30 w-3/4" />
          <div className="h-px bg-foreground/20 w-2/3" />
          <div className="h-px bg-foreground/20 w-1/2" />
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="h-px bg-foreground/30 w-3/4" />
          <div className="h-px bg-foreground/20 w-2/3" />
          <div className="h-px bg-foreground/20 w-1/2" />
        </div>
      </div>
    );
  }
  if (section === "jobOrderConsultants") {
    return (
      <div
        className="flex-1 flex flex-col justify-center gap-0.5 rounded-sm border border-dashed border-foreground/15 bg-muted/10 px-1 py-0.5 leading-tight text-muted-foreground"
        style={{ fontSize: onScreenPx(8) }}
      >
        <span className="text-foreground/70">Consultants :</span>
        <span className="truncate">Name A</span>
        <span className="truncate">Name B</span>
        <span className="truncate">Name C</span>
      </div>
    );
  }
  if (section === "showFooterAddress") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-px w-3/4 bg-foreground/30" />
      </div>
    );
  }
  if (section === "showPaymentAdvicePage") {
    return (
      <div
        className="flex-1 flex flex-col gap-0.5 overflow-hidden leading-tight text-muted-foreground"
        style={{ fontSize: onScreenPx(8) }}
      >
        <div className="font-semibold text-foreground/80">PAYMENT ADVICE</div>
        <div className="h-px bg-foreground/15" />
        <div className="flex justify-between gap-1">
          <span>Amount</span>
          <span className="tabular-nums">$ …</span>
        </div>
        <div className="h-px bg-foreground/10" />
        <span>Bank / Account</span>
      </div>
    );
  }
  if (section === "showSignatures" && (docKind === "invoice" || docKind === "quotation")) {
    // This lane is an approximate 70 pt band; keep the thumbnail square inside it.
    const chopSize = Math.min(70, 56 * brandingScaleFactor(chopScale));
    const stampSrc = stampUrl ? resolvePublicAssetUrl(stampUrl) : "";
    return (
      <div className="flex-1 flex min-h-0 items-center justify-end overflow-hidden">
        {stampSrc && stampSrc !== failedSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            style={{ width: chopSize, height: chopSize }}
            src={stampSrc}
            alt=""
            aria-hidden
            className="max-h-full shrink-0 rounded-sm border border-dashed border-foreground/25 object-contain bg-muted/15"
            draggable={false}
            onError={() => setFailedSrc(stampSrc)}
          />
        ) : (
          <span
            style={{ width: chopSize, height: chopSize, fontSize: onScreenPx(8) }}
            className="flex max-h-full shrink-0 items-center justify-center rounded-sm border border-dashed border-foreground/25 bg-muted/15 px-0.5 text-center leading-tight text-muted-foreground"
          >
            {stampUrl ? "Image failed to load" : "Company Chop"}
          </span>
        )}
      </div>
    );
  }
  return (
    <div
      className="flex-1 flex items-center justify-center text-muted-foreground"
      style={{ fontSize: onScreenPx(9) }}
    >
      {SECTION_LABEL[section]}
    </div>
  );
});
