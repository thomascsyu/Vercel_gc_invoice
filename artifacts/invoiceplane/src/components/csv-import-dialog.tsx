import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, CheckCircle, AlertCircle, Download } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

interface SkippedRow {
  row: number;
  reason: string;
  data?: Record<string, string>;
}

interface ValidationResult {
  previewCount: number;
  /** Total data rows in the CSV file (including invalid); clients import only. */
  totalRowsInFile?: number;
  errors: string[];
  probableSkips?: number;
  probableSkippedRows?: SkippedRow[];
}

interface CommitResult {
  inserted: number;
  updated?: number;
  skipped: number;
  skippedRows?: SkippedRow[];
  errors: string[];
}

interface ClientImportJobAccepted {
  jobId: string;
  acceptedCount: number;
}

interface ClientImportJobStatus {
  status: "running" | "completed" | "failed";
  phase: string;
  processed: number;
  total: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  skippedRows?: SkippedRow[];
  errors?: string[];
  error?: string;
}

function isClientImportJobAccepted(x: unknown): x is ClientImportJobAccepted {
  return (
    typeof x === "object" &&
    x !== null &&
    "jobId" in x &&
    typeof (x as ClientImportJobAccepted).jobId === "string"
  );
}

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importUrl: string;
  entityName: string;
  onSuccess?: () => void;
  csvTemplate?: { filename: string; content: string };
  templateUrl?: string;
  supportsOverwrite?: boolean;
  /** Clients CSV: copy and actions emphasize importing only valid rows; invalid rows are skipped without blocking. */
  validRowsImportFocus?: boolean;
}

const KEY_FIELDS = [
  "clientId",
  "clientCode",
  "clientName",
  "invoiceDate",
  "quotationDate",
  "paymentDate",
  "jobDate",
  "currency",
  "amount",
  "invoiceId",
  "email",
  "name",
];

function SkippedRowSummary({ data }: { data?: Record<string, string> }) {
  if (!data) return null;
  const entries = KEY_FIELDS.flatMap((key) => {
    const val = data[key];
    return val ? [{ key, val }] : [];
  });
  if (entries.length === 0) return null;
  return (
    <span className="ml-1 text-amber-700">
      ({entries.map((e, i) => (
        <span key={e.key}>{i > 0 ? ", " : ""}<span className="font-medium">{e.key}:</span> {e.val}</span>
      ))})
    </span>
  );
}

export function CsvImportDialog({
  open,
  onOpenChange,
  importUrl,
  entityName,
  onSuccess,
  csvTemplate,
  templateUrl,
  supportsOverwrite = false,
  validRowsImportFocus = false,
}: CsvImportDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    phase: string;
    processed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwriteMode, setOverwriteMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const downloadCsvTemplate = () => {
    if (!csvTemplate) return;
    const blob = new Blob([csvTemplate.content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvTemplate.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const decodeFilename = (raw: string): string => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  const reset = () => {
    setFile(null);
    setValidation(null);
    setCommitResult(null);
    setError(null);
    setOverwriteMode(false);
    setValidating(false);
    setCommitting(false);
    setImportProgress(null);
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setValidation(null);
    setCommitResult(null);
    setError(null);
  };

  const handleDownloadTemplate = async () => {
    if (templateUrl) {
      try {
        const res = await fetch(templateUrl, { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        const blob = await res.blob();
        const disposition = res.headers.get("content-disposition") ?? "";
        const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        const filename =
          (filenameMatch?.[1] ? decodeFilename(filenameMatch[1]) : "") ||
          csvTemplate?.filename ||
          "template.csv";
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      } catch (err) {
        if (csvTemplate) {
          toast({
            title: "Using fallback template",
            description: "Could not download from server, saved local template instead.",
          });
          downloadCsvTemplate();
          return;
        }
        toast({
          variant: "destructive",
          title: "Template download failed",
          description: err instanceof Error ? err.message : "Unable to download template file.",
        });
        return;
      }
    }
    if (csvTemplate) {
      downloadCsvTemplate();
    }
  };

  const handleValidate = async () => {
    if (!file) return;
    setValidating(true);
    setError(null);
    setCommitResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await customFetch<ValidationResult>(importUrl, {
        method: "POST",
        credentials: "include",
        body: formData,
        responseType: "json",
      });
      setValidation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setValidating(false);
    }
  };

  const pollClientImportJob = async (jobId: string): Promise<CommitResult> => {
    const pollUrl = `/api/clients/import/jobs/${jobId}`;
    const maxPolls = 4500;
    for (let i = 0; i < maxPolls; i++) {
      const s = await customFetch<ClientImportJobStatus>(pollUrl, {
        method: "GET",
        credentials: "include",
        responseType: "json",
      });
      setImportProgress({
        phase: s.phase,
        processed: s.processed,
        total: s.total,
      });
      if (s.status === "completed") {
        return {
          inserted: s.inserted ?? 0,
          updated: s.updated ?? 0,
          skipped: s.skipped ?? 0,
          skippedRows: s.skippedRows,
          errors: s.errors ?? [],
        };
      }
      if (s.status === "failed") {
        throw new Error(s.error ?? "Import failed");
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("Import timed out while waiting for status. Check the client list and try again if needed.");
  };

  const handleCommit = async () => {
    if (!file) return;
    setCommitting(true);
    setImportProgress(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const baseUrl = importUrl.includes("?")
        ? `${importUrl}&commit=true`
        : `${importUrl}?commit=true`;
      let url =
        supportsOverwrite && overwriteMode ? `${baseUrl}&overwrite=true` : baseUrl;
      if (validRowsImportFocus && importUrl.includes("/clients/import")) {
        url += url.includes("?") ? "&async=true" : "?async=true";
      }
      setImportProgress({ phase: "Uploading file", processed: 0, total: validation?.previewCount ?? 0 });
      const raw = await customFetch<CommitResult | ClientImportJobAccepted>(url, {
        method: "POST",
        credentials: "include",
        body: formData,
        responseType: "json",
      });
      const data: CommitResult = isClientImportJobAccepted(raw)
        ? await pollClientImportJob(raw.jobId)
        : raw;
      setImportProgress(null);
      setCommitResult(data);
      const updated = data.updated ?? 0;
      const savedValid = data.inserted + updated;
      if (validRowsImportFocus) {
        toast({
          title: "Valid rows saved",
          description:
            `${savedValid} row${savedValid !== 1 ? "s" : ""} saved` +
            (data.skipped > 0 ? ` · ${data.skipped} row${data.skipped !== 1 ? "s" : ""} skipped` : "") +
            ".",
        });
      } else {
        toast({
          title: `Import complete`,
          description: `${data.inserted} record${data.inserted !== 1 ? "s" : ""} imported${updated > 0 ? `, ${updated} updated` : ""}${data.skipped > 0 ? `, ${data.skipped} duplicate${data.skipped !== 1 ? "s" : ""} skipped` : ""}.`,
        });
      }
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setCommitting(false);
      setImportProgress(null);
    }
  };

  const getFixHint = (reason: string): string => {
    if (/company name already exists/i.test(reason)) {
      return "A client with this company name already exists. Enable 'Overwrite duplicates' to update the existing client, or change the company name.";
    }
    if (/duplicate payment/i.test(reason)) {
      return "A payment with the same invoice, date, and amount already exists. Remove this row or update the date, amount, or invoice ID to make it unique.";
    }
    if (/duplicate/i.test(reason)) {
      return "This row is a duplicate of an existing record. Remove it or update the values to make it unique.";
    }
    if (/multiple clients match/i.test(reason)) {
      return "Use clientId (UUID from Clients list) or a unique clientCode so the row resolves to exactly one client.";
    }
    if (/no client matches/i.test(reason)) {
      return "Create or fix the client record first, then use clientId, clientCode, email, or exact client name.";
    }
    if (/missing|required/i.test(reason)) {
      return "Fill in the missing required field(s) and re-import this row.";
    }
    if (/invalid/i.test(reason)) {
      return "Correct the invalid value(s) in this row and re-import.";
    }
    return "Review the skip reason and correct the row before re-importing.";
  };

  const csvEscape = (val: string): string =>
    val.includes(",") || val.includes('"') || val.includes("\n")
      ? `"${val.replace(/"/g, '""')}"`
      : val;

  const handleDownloadSkippedRows = () => {
    if (!commitResult?.skippedRows?.length) return;
    const rows = commitResult.skippedRows.filter((sr) => sr.data);
    if (rows.length === 0) return;
    const allKeys = Array.from(new Set(rows.flatMap((sr) => Object.keys(sr.data!))));
    const header = [...allKeys, "skip_reason", "fix_hint"].join(",");
    const lines = rows.map((sr) => {
      const values = allKeys.map((k) => {
        const val = sr.data![k] ?? "";
        return csvEscape(val);
      });
      values.push(csvEscape(sr.reason));
      values.push(csvEscape(getFixHint(sr.reason)));
      return values.join(",");
    });
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "skipped-rows.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const canConfirm =
    validation !== null &&
    commitResult === null &&
    (validRowsImportFocus ? validation.previewCount > 0 : validation.errors.length === 0);

  const fileRowTotal =
    validation && validRowsImportFocus
      ? (validation.totalRowsInFile ?? validation.previewCount + validation.errors.length)
      : null;

  const hasSkippedRowMessages =
    !!validation &&
    (validation.errors.length > 0 ||
      (validation.probableSkips != null && validation.probableSkips > 0));

  const showNonBlockingCallout =
    !!validation && validRowsImportFocus && validation.previewCount > 0 && hasSkippedRowMessages;

  const importing = committing || importProgress !== null;
  const progressPercent =
    importProgress && importProgress.total > 0
      ? Math.min(100, Math.round((importProgress.processed / importProgress.total) * 100))
      : committing
        ? 5
        : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {validRowsImportFocus ? `Import valid ${entityName} from CSV` : `Import ${entityName} from CSV`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!commitResult && (
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {validRowsImportFocus ? (
                  <>
                    Only rows with valid required fields are saved. Invalid or empty rows are skipped—you do not need to fix the whole file to import the good rows.
                  </>
                ) : (
                  <>Upload a CSV file to validate and import {entityName.toLowerCase()} records.</>
                )}
              </p>
              {(templateUrl || csvTemplate) && (
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                >
                  <Download className="h-3 w-3" />
                  Download template
                </button>
              )}
            </div>
          )}
          {!commitResult && (
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Click to select a CSV file</p>
              )}
              <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {validRowsImportFocus && importProgress && !commitResult && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-foreground">Import in progress</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {importProgress.total > 0
                    ? `${importProgress.processed} / ${importProgress.total} rows`
                    : "Starting…"}
                </span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <p className="text-xs text-muted-foreground">{importProgress.phase}</p>
            </div>
          )}
          {commitResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-green-700">
                <CheckCircle className="h-4 w-4 text-green-600" />
                {validRowsImportFocus ? "Valid rows saved" : "Import complete"}
              </div>
              <div className="bg-muted rounded p-3 text-sm space-y-1">
                <p>{commitResult.inserted} row{commitResult.inserted !== 1 ? "s" : ""} inserted</p>
                {(commitResult.updated ?? 0) > 0 && (
                  <p className="text-blue-600">{commitResult.updated} row{commitResult.updated !== 1 ? "s" : ""} updated</p>
                )}
                {commitResult.skipped > 0 && (
                  <p className="text-muted-foreground">{commitResult.skipped} row{commitResult.skipped !== 1 ? "s" : ""} skipped</p>
                )}
              </div>
              {commitResult.skippedRows && commitResult.skippedRows.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      {validRowsImportFocus ? "Rows that were not imported (skipped)" : "Skipped rows"}
                    </p>
                    {commitResult.skippedRows.some((sr) => sr.data) && (
                      <button
                        type="button"
                        onClick={handleDownloadSkippedRows}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Download className="h-3 w-3" />
                        Download skipped rows
                      </button>
                    )}
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-1 max-h-40 overflow-y-auto">
                    {commitResult.skippedRows.map((sr) => (
                      <p key={sr.row} className="text-xs text-amber-800">
                        <span className="font-medium">Row {sr.row}:</span> {sr.reason}
                        <SkippedRowSummary data={sr.data} />
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {validation && !commitResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle className="h-4 w-4 text-green-600" />
                {validRowsImportFocus && fileRowTotal != null ? (
                  <span>
                    {validation.previewCount} valid row{validation.previewCount !== 1 ? "s" : ""} ready to import (out of {fileRowTotal} in file)
                  </span>
                ) : (
                  <span>
                    {validation.previewCount} row{validation.previewCount !== 1 ? "s" : ""} found
                  </span>
                )}
              </div>
              {showNonBlockingCallout && (
                <p className="text-xs rounded-md border border-blue-200 bg-blue-50 text-blue-900 px-3 py-2">
                  These issues do not block import.{" "}
                  <span className="font-medium">
                    Import valid rows ({validation.previewCount}) saves only those {validation.previewCount} row{validation.previewCount !== 1 ? "s" : ""}.
                  </span>
                </p>
              )}
              {validation.errors.length > 0 ? (
                <div className="space-y-1">
                  {validRowsImportFocus && (
                    <p className="text-xs font-medium text-muted-foreground">Rows that will not be imported (skipped)</p>
                  )}
                  <div className="bg-destructive/10 rounded p-3 space-y-1 max-h-40 overflow-y-auto">
                    {validation.errors.map((e, i) => (
                      <p key={i} className="text-xs text-destructive">{e}</p>
                    ))}
                  </div>
                </div>
              ) : (
                !validRowsImportFocus && (
                  <p className="text-xs text-muted-foreground">No validation errors — ready to import.</p>
                )
              )}
              {validation.probableSkips != null && validation.probableSkips > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-amber-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {validRowsImportFocus ? (
                      <span>
                        {validation.probableSkips} row{validation.probableSkips !== 1 ? "s" : ""}{" "}
                        {supportsOverwrite
                          ? `will be skipped as duplicate${validation.probableSkips !== 1 ? "s" : ""} unless you overwrite`
                          : `will be skipped as duplicate${validation.probableSkips !== 1 ? "s" : ""}`}
                      </span>
                    ) : (
                      <span>
                        {validation.probableSkips} row{validation.probableSkips !== 1 ? "s" : ""} may be skipped as duplicate{validation.probableSkips !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {supportsOverwrite && (
                    <div className="flex items-center gap-2 text-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={overwriteMode}
                          onChange={(e) => setOverwriteMode(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <span className="text-muted-foreground">Overwrite duplicates (update existing records)</span>
                      </label>
                    </div>
                  )}
                  {validation.probableSkippedRows && validation.probableSkippedRows.length > 0 && (
                    <div className="space-y-1">
                      {validRowsImportFocus && (
                        <p className="text-xs font-medium text-muted-foreground">Rows that will not be imported (skipped)</p>
                      )}
                      <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-1 max-h-40 overflow-y-auto">
                        {validation.probableSkippedRows.map((sr) => (
                          <p key={sr.row} className="text-xs text-amber-800">
                            <span className="font-medium">Row {sr.row}:</span> {sr.reason}
                            <SkippedRowSummary data={sr.data} />
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {commitResult ? (
              <Button onClick={() => handleClose(false)}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                {canConfirm ? (
                  <>
                    {validRowsImportFocus && hasSkippedRowMessages && (
                      <Button variant="outline" onClick={handleValidate} disabled={!file || validating || importing}>
                        {validating ? "Checking…" : "Check CSV again"}
                      </Button>
                    )}
                    <Button onClick={handleCommit} disabled={importing}>
                      {importing
                        ? "Importing…"
                        : validRowsImportFocus
                          ? `Import valid rows (${validation!.previewCount})`
                          : "Confirm Import"}
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleValidate} disabled={!file || validating || importing}>
                    {validating
                      ? validRowsImportFocus
                        ? "Checking…"
                        : "Validating…"
                      : validRowsImportFocus
                        ? "Check CSV for valid rows"
                        : "Validate CSV"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
