import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { apiListDeleted, apiPurge, apiRestore, type DeletedRow } from "@/lib/modulesApi";
import { RotateCcw, Trash2, X } from "lucide-react";

type Entity = "clients" | "invoices" | "quotations" | "payments" | "receipts";

/** Shared "trash" view for a soft-deletable entity: lists deleted rows with a Restore action. */
export function DeletedItemsDialog({
  open,
  onOpenChange,
  entity,
  title,
  renderLabel,
  renderSubLabel,
  onRestored,
  canPurge,
  onPurged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: Entity;
  title: string;
  renderLabel: (row: DeletedRow) => string;
  renderSubLabel?: (row: DeletedRow) => string | undefined;
  /** Called after a successful restore so the caller can refresh its own (non-deleted) list. */
  onRestored?: () => void;
  /** Enables a "Delete permanently" action alongside Restore. Only "invoices" supports this today. */
  canPurge?: boolean;
  /** Called after a successful permanent delete. */
  onPurged?: () => void;
}) {
  const { toast } = useToast();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: [`/${entity}/deleted`],
    queryFn: () => apiListDeleted(entity),
    enabled: open,
  });
  const rows = data?.data ?? [];

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try {
      await apiRestore(entity, id);
      toast({ title: "Restored" });
      await refetch();
      onRestored?.();
    } catch (err) {
      toast({
        title: "Failed to restore",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setRestoringId(null);
    }
  };

  const handlePurge = async (row: DeletedRow) => {
    if (!canPurge || entity !== "invoices") return;
    if (!confirm(`Permanently delete ${renderLabel(row)}? This cannot be undone.`)) return;
    setPurgingId(row.id);
    try {
      await apiPurge(entity, row.id);
      toast({ title: "Permanently deleted" });
      await refetch();
      onPurged?.();
    } catch (err) {
      toast({
        title: "Failed to delete",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPurgingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> {title}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Nothing deleted.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{renderLabel(row)}</div>
                  {renderSubLabel?.(row) && (
                    <div className="text-xs text-muted-foreground truncate">{renderSubLabel(row)}</div>
                  )}
                  {row.deletedAt && (
                    <div className="text-xs text-muted-foreground mt-0.5">Deleted {formatDate(row.deletedAt)}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRestore(row.id)}
                    disabled={restoringId === row.id || purgingId === row.id}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Restore
                  </Button>
                  {canPurge && entity === "invoices" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handlePurge(row)}
                      disabled={restoringId === row.id || purgingId === row.id}
                    >
                      <X className="h-3.5 w-3.5 mr-1.5" /> Delete permanently
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
