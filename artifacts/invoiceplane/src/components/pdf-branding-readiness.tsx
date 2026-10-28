import { Check } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PdfBrandingReadiness({
  logo,
  header,
  chop,
  includeChop = true,
  /**
   * True when uploaded branding files live on non-persistent disk (no GCS and
   * no host directory). A logo/header URL can be saved in company settings
   * ("ready" below) while the file bytes are gone after the container is
   * recreated, so the PDF silently renders without it.
   */
  nonPersistentStorage = false,
}: {
  logo: boolean;
  header: boolean;
  chop: boolean;
  /** Job-order PDFs intentionally use logos only. */
  includeChop?: boolean;
  nonPersistentStorage?: boolean;
}) {
  const assets = [
    { label: "Company logo", ready: logo },
    { label: "Header logo", ready: header },
    ...(includeChop ? [{ label: "Company chop", ready: chop }] : []),
  ];
  const complete = assets.every((asset) => asset.ready);
  const showStorageWarning = nonPersistentStorage && assets.some((asset) => asset.ready);

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">
            {complete ? "Branded PDF ready" : "PDF branding needs attention"}
          </p>
          <p className="text-xs text-muted-foreground">
            {complete
              ? `All ${includeChop ? "three" : "required"} branding assets are available to the saved PDF layout.`
              : "The PDF will still generate, but missing assets will be omitted."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {assets.map((asset) => (
            <Badge
              key={asset.label}
              variant="outline"
              className={cn(
                "gap-1",
                asset.ready
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              {asset.ready ? <Check className="h-3 w-3" aria-hidden /> : null}
              {asset.label}
            </Badge>
          ))}
          {!complete ? (
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Link href="/admin?tab=company-branding">Configure</Link>
            </Button>
          ) : null}
        </div>
      </div>
      {showStorageWarning ? (
        <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-300">
          Uploaded logos are on temporary server disk and can disappear when the app container is
          replaced, so a logo shown as ready above can still be missing from the PDF below. If it looks
          blank, re-upload it under{" "}
          <Link href="/admin?tab=company-branding" className="font-medium underline">
            Company settings → Branding
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
