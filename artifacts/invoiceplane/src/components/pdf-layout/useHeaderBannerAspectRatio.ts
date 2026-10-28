import { useEffect, useState } from "react";
import { resolvePublicAssetUrl } from "@/lib/api-base";

/** Loads header banner natural width ÷ height for layout width fitting. */
export function useHeaderBannerAspectRatio(url: string | null | undefined): number | null {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    const resolved = url ? resolvePublicAssetUrl(url) || url : "";
    if (!resolved) {
      setAspectRatio(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const { naturalWidth, naturalHeight } = img;
      if (naturalWidth > 0 && naturalHeight > 0) {
        setAspectRatio(naturalWidth / naturalHeight);
      } else {
        setAspectRatio(null);
      }
    };
    img.onerror = () => {
      if (!cancelled) setAspectRatio(null);
    };
    img.src = resolved;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  return aspectRatio;
}
