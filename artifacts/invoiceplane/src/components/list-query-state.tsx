import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeApiFailure } from "@/lib/describeApiFailure";

type ListQueryStateProps = {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyMessage: ReactNode;
  onRetry?: () => void;
  isRetrying?: boolean;
  skeleton?: ReactNode;
  children: ReactNode;
};

/**
 * Standard loading / error / empty handling for data tables.
 */
export function ListQueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  emptyMessage,
  onRetry,
  isRetrying,
  skeleton,
  children,
}: ListQueryStateProps) {
  if (isLoading) {
    return (
      <>
        {skeleton ?? <p className="text-muted-foreground text-sm p-6">Loading…</p>}
      </>
    );
  }

  if (isError) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-destructive text-sm">{describeApiFailure(error)}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isRetrying && "animate-spin")} />
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  if (isEmpty) {
    return <div className="text-muted-foreground text-sm p-6">{emptyMessage}</div>;
  }

  return <>{children}</>;
}
