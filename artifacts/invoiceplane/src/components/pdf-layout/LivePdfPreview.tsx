/**
 * LivePdfPreview — debounced PDF preview iframe.
 *
 * Watches the editor draft and re-fetches a sample PDF (~600ms after the user
 * pauses editing) using `POST /pdf-document-layouts/preview`. A "Live" toggle
 * disables auto-refresh. Blob URLs are revoked on swap to prevent leaks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Eye, EyeOff, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  fetchPdfLayoutPreviewBlob,
  type PdfDocumentProfile,
  type PdfLayoutPreviewKind,
} from "@/lib/modulesApi";
import { profilePreviewSignature } from "@/lib/pdfLayoutPresets";

const DEFAULT_DEBOUNCE_MS = 600;

export interface LivePdfPreviewProps {
  kind: PdfLayoutPreviewKind;
  profile: PdfDocumentProfile;
  /** Show the iframe at this height (CSS px). */
  height?: number;
  /** Disabled when there is no client to render against. */
  disabled?: boolean;
  /** Optional debounce override (defaults to 600ms). */
  debounceMs?: number;
  /**
   * Fingerprint of company branding (logo / header / chop / updatedAt).
   * When branding changes, the live PDF refreshes so removed logos do not stick.
   */
  brandingKey?: string;
}

export function LivePdfPreview({
  kind,
  profile,
  height = 720,
  disabled,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  brandingKey = "",
}: LivePdfPreviewProps) {
  const { toast } = useToast();
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastReqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const previewSignature = useMemo(() => profilePreviewSignature(profile), [profile]);

  const refresh = async (immediate = false) => {
    if (disabled) return;
    if (!immediate && !live) return;
    setErrorMsg(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const reqId = ++lastReqRef.current;
    setLoading(true);
    try {
      const blob = await fetchPdfLayoutPreviewBlob(kind, profileRef.current, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (reqId !== lastReqRef.current) return;
      const next = URL.createObjectURL(blob);
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return next;
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      if (reqId !== lastReqRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      const friendly =
        msg === "Unauthorized"
          ? "Session expired. Click Retry to refresh the preview."
          : msg;
      setErrorMsg(friendly);
      if (immediate) {
        toast({ title: "Preview failed", description: friendly, variant: "destructive" });
      }
    } finally {
      if (reqId === lastReqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (disabled || !live) return;
    const t = setTimeout(() => {
      void refresh();
    }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when PDF-relevant profile/branding fields change
  }, [previewSignature, kind, live, debounceMs, disabled, brandingKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    },
    [],
  );

  return (
    <Card className="h-full">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Live PDF preview</CardTitle>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Switch
              id="live-preview-toggle"
              checked={live}
              onCheckedChange={setLive}
              aria-label="Toggle live preview"
            />
            <Label htmlFor="live-preview-toggle" className="text-xs cursor-pointer">
              {live ? (
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3 w-3" /> Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <EyeOff className="h-3 w-3" /> Manual
                </span>
              )}
            </Label>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void refresh(true)}
            disabled={disabled || loading}
            aria-label="Refresh preview"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            Refresh
          </Button>
          {url ? (
            <Button asChild type="button" variant="ghost" size="sm" className="h-8 gap-1.5">
              <a href={url} download={`layout-preview-${kind}.pdf`}>
                <Download className="h-3.5 w-3.5" aria-hidden />
                Download
              </a>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div
          className="relative w-full bg-muted/30"
          style={{ height: `${height}px` }}
          data-testid="live-preview-frame"
        >
          {url ? (
            <iframe
              key={url}
              src={url}
              className="w-full h-full border-0"
              title={`PDF layout preview — ${kind}`}
            />
          ) : disabled ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground p-4 text-center">
              Add a client first to render a sample PDF preview.
            </div>
          ) : loading ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Generating preview…
            </div>
          ) : errorMsg ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <p className="text-sm text-destructive">Preview failed: {errorMsg}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void refresh(true)}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Preview will appear here.
            </div>
          )}
          {url && loading ? (
            <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-xs shadow">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Updating
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
