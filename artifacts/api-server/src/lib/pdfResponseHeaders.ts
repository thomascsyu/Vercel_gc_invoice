import type { Response } from "express";

/** Dynamic PDFs embed live company branding — never let browsers/CDNs reuse a stale file. */
export function setPdfDownloadHeaders(
  res: Response,
  contentDisposition: string,
): void {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", contentDisposition);
  res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
}
