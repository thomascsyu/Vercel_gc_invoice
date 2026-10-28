import { useMemo } from "react";

/** Memoized PDF preview iframe to prevent reloads when parent re-renders. */
export function PdfPreviewIframe({ pdfUrl, title }: { pdfUrl: string; title: string }) {
  const stableUrl = useMemo(() => pdfUrl, [pdfUrl]);
  return (
    <div className="w-full" style={{ height: "70vh" }}>
      <iframe
        src={stableUrl}
        className="w-full h-full rounded border"
        title={title}
      />
    </div>
  );
}
