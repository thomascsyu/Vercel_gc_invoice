import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiClearTestData,
  apiGetSettings,
  apiUpdateSettings,
  type ClearTestDataCounts,
} from "@/lib/modulesApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, FlaskConical, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatCleared(counts: ClearTestDataCounts): string {
  return [
    `${counts.clients} clients`,
    `${counts.invoices} invoices`,
    `${counts.quotations} quotations`,
    `${counts.payments} payments`,
    `${counts.receipts} receipts`,
    `${counts.jobOrders} job orders`,
    `${counts.paymentReceipts} payment files`,
  ].join(", ");
}

export default function TestModeSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["/company-settings"],
    queryFn: apiGetSettings,
  });
  const enabled = Boolean(data?.testModeEnabled);

  const toggleMut = useMutation({
    mutationFn: (next: boolean) => apiUpdateSettings({ testModeEnabled: next }),
    onSuccess: (row) => {
      qc.setQueryData(["/company-settings"], row);
      void qc.invalidateQueries({ queryKey: ["/me"] });
      void qc.invalidateQueries();
      toast({
        title: row.testModeEnabled ? "Test mode on" : "Test mode off",
        description: row.testModeEnabled
          ? "You are now working in an empty sandbox. Live data is unchanged."
          : "Back to live data. Test sandbox rows are kept until you clear them.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not update test mode", description: e.message, variant: "destructive" }),
  });

  const clearMut = useMutation({
    mutationFn: apiClearTestData,
    onSuccess: (result) => {
      void qc.invalidateQueries();
      setConfirmOpen(false);
      toast({
        title: "Test data cleared",
        description: formatCleared(result.deleted),
      });
    },
    onError: (e: Error) =>
      toast({ title: "Clear failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Company test mode
          </CardTitle>
          <CardDescription>
            Company-wide sandbox for clients, invoices, quotations, payments, receipts, and job
            orders. The sandbox starts empty. Changes never touch live records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="test-mode-switch" className="text-base">
                Enable test mode for everyone
              </Label>
              <p className="text-sm text-muted-foreground">
                When on, all staff see only test-sandbox data. Live invoices, quotes, receipts, job
                orders, clients, and payments stay intact and hidden until you turn this off.
              </p>
            </div>
            <Switch
              id="test-mode-switch"
              checked={enabled}
              disabled={isLoading || toggleMut.isPending}
              onCheckedChange={(on) => toggleMut.mutate(on)}
              data-testid="test-mode-switch"
            />
          </div>

          {enabled ? (
            <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">Test mode is active</p>
                <p className="text-muted-foreground mt-1">
                  Create sample clients and documents freely. Email reminders and recurring invoice
                  jobs still use live data only.
                </p>
              </div>
            </div>
          ) : null}

          <div className="space-y-3 rounded-lg border p-4">
            <div>
              <p className="font-medium">Clear test sandbox</p>
              <p className="text-sm text-muted-foreground mt-1">
                Permanently deletes all test-mode clients, invoices, quotations, payments, receipts,
                and job orders. Live data is never deleted.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              disabled={clearMut.isPending}
              onClick={() => setConfirmOpen(true)}
              data-testid="clear-test-data"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {clearMut.isPending ? "Clearing…" : "Clear all test data"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear the test sandbox?</DialogTitle>
            <DialogDescription>
              This removes every test-mode client, invoice, quotation, payment, receipt, and job
              order for the company. Live records are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={clearMut.isPending}
              onClick={() => clearMut.mutate()}
            >
              {clearMut.isPending ? "Clearing…" : "Clear test data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
