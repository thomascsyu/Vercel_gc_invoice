/**
 * PresetsRail — left rail of the Document layouts editor.
 *
 * Shows the Classic preset, the active selection, and a "Reset all" action.
 * The user's last preset selection per kind is persisted to localStorage as a
 * UI hint; the authoritative state comes from the saved profile's `presetId`.
 */
import { RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  PRESET_LIST,
  type PresetId,
} from "@/lib/pdfLayoutPresets";

const STORAGE_KEY = "invoiceplane-document-layout-active-preset";

type PerKindActive = Partial<Record<string, Exclude<PresetId, "custom">>>;

export function readActivePresetForKind(kind: string): Exclude<PresetId, "custom"> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PerKindActive;
    const v = parsed[kind];
    if (typeof v === "string") return v;
    return null;
  } catch {
    return null;
  }
}

export function writeActivePresetForKind(kind: string, id: Exclude<PresetId, "custom">) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: PerKindActive = raw ? (JSON.parse(raw) as PerKindActive) : {};
    parsed[kind] = id;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export interface PresetsRailProps {
  activeId: PresetId;
  onApply: (id: Exclude<PresetId, "custom">) => void;
  onResetAll: () => void;
}

export function PresetsRail({
  activeId,
  onApply,
  onResetAll,
}: PresetsRailProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Layout presets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-1.5">
          {PRESET_LIST.map((p) => {
            const active = activeId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onApply(p.id)}
                className={cn(
                  "w-full text-left rounded-md border px-3 py-2 transition-colors",
                  "hover:border-primary/50 hover:bg-accent/40",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border bg-background",
                )}
                aria-pressed={active}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{p.label}</span>
                  {active ? (
                    <Check className="h-4 w-4 text-primary shrink-0" aria-hidden />
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{p.description}</p>
              </button>
            );
          })}
          {activeId === "custom" ? (
            <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Custom — your edits don't match any preset.
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 justify-start"
            onClick={onResetAll}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Reset to Classic
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
