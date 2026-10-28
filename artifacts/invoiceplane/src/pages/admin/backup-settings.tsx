import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, RotateCcw, Upload } from "lucide-react";
import { apiDownloadBackup, apiRestoreBackup, type BackupRestoreCounts } from "@/lib/modulesApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function formatRestoreSummary(restored: BackupRestoreCounts): string {
  const parts = [
    `${restored.clients} clients`,
    `${restored.invoices} invoices`,
    `${restored.quotations} quotations`,
    `${restored.payments} payments`,
    `${restored.jobOrders} job orders`,
  ];
  if (restored.companySettings > 0 || restored.consultants > 0) {
    parts.push(`${restored.consultants} consultants`, `${restored.companySettings} company settings`);
  }
  return parts.join(", ");
}

export default function BackupSettingsPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [includeCompany, setIncludeCompany] = useState(true);
  const [restoreCompany, setRestoreCompany] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const exportMut = useMutation({
    mutationFn: () => apiDownloadBackup(includeCompany),
    onSuccess: () => {
      toast({
        title: "Backup downloaded",
        description: includeCompany
          ? "Your business data and company settings were exported."
          : "Your business data was exported.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Backup failed", description: e.message, variant: "destructive" }),
  });

  const restoreMut = useMutation({
    mutationFn: (file: File) => apiRestoreBackup(file, { restoreCompany, confirm: true }),
    onSuccess: (result) => {
      toast({
        title: "Backup restored",
        description: formatRestoreSummary(result.restored),
      });
      setPendingFile(null);
      setConfirmOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (e: Error) =>
      toast({ title: "Restore failed", description: e.message, variant: "destructive" }),
  });

  const onFileSelected = (file: File | undefined) => {
    if (!file) return;
    setPendingFile(file);
    setConfirmOpen(true);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Download backup
          </CardTitle>
          <CardDescription>
            Export your clients, invoices, quotations, payments, job orders, templates, and related
            records as a JSON file you can store offline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="include-company"
              checked={includeCompany}
              onCheckedChange={(v) => setIncludeCompany(v === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="include-company" className="font-medium">
                Include company settings and consultants
              </Label>
              <p className="text-sm text-muted-foreground">
                Adds shared company profile, branding URLs, email templates, and consultant records to
                the backup.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => exportMut.mutate()}
            disabled={exportMut.isPending}
            data-testid="backup-download"
          >
            <Download className="mr-2 h-4 w-4" />
            {exportMut.isPending ? "Preparing backup…" : "Download backup"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Roll back from backup
          </CardTitle>
          <CardDescription>
            Replace all of your business data with the contents of a previously downloaded backup
            file. This cannot be undone unless you have another backup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <Checkbox
              id="restore-company"
              checked={restoreCompany}
              onCheckedChange={(v) => setRestoreCompany(v === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="restore-company" className="font-medium">
                Restore company settings and consultants when present
              </Label>
              <p className="text-sm text-muted-foreground">
                Applies shared settings from backups that were exported with company data included.
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onFileSelected(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="destructive"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoreMut.isPending}
            data-testid="backup-restore"
          >
            <Upload className="mr-2 h-4 w-4" />
            {restoreMut.isPending ? "Restoring…" : "Upload backup to roll back"}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back from backup?</DialogTitle>
            <DialogDescription>
              This will permanently replace all of your current business data
              {pendingFile ? ` with the contents of "${pendingFile.name}"` : ""}. Make sure you have
              a recent backup of the current state before continuing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={restoreMut.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!pendingFile || restoreMut.isPending}
              onClick={() => {
                if (pendingFile) restoreMut.mutate(pendingFile);
              }}
            >
              Roll back now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
