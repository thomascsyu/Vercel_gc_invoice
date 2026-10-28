import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ProposalDetailPanelProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

export function ProposalDetailPanel({
  open,
  title,
  subtitle,
  headerActions,
  onClose,
  children,
}: ProposalDetailPanelProps) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="lg:hidden fixed inset-0 z-40 bg-black/40"
        aria-label="Close proposal panel"
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed z-50 top-0 right-0 h-full bg-background border-l shadow-xl flex flex-col",
          "w-full sm:max-w-xl lg:max-w-none lg:w-[min(44vw,580px)]",
          "animate-in slide-in-from-right duration-300",
        )}
        aria-label="Proposal details"
      >
        <header className="shrink-0 border-b px-4 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">{title}</h2>
              {subtitle ? <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p> : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 shrink-0"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {headerActions ? (
            <div className="flex flex-wrap gap-2">{headerActions}</div>
          ) : null}
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      </aside>
    </>
  );
}
