import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

type SortDir = "asc" | "desc";

interface SortableHeaderProps {
  label: string;
  field: string;
  sortBy: string | null;
  sortDir: SortDir;
  onSort: (field: string, newDir: SortDir) => void;
  className?: string;
}

export function SortableHeader({ label, field, sortBy, sortDir, onSort, className }: SortableHeaderProps) {
  const active = sortBy === field;

  const handleClick = () => {
    const newDir: SortDir = active && sortDir === "asc" ? "desc" : "asc";
    onSort(field, newDir);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1 select-none hover:text-foreground transition-colors",
        active ? "text-foreground font-semibold" : "text-muted-foreground",
        className,
      )}
    >
      {label}
      {active ? (
        sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
      ) : (
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
      )}
    </button>
  );
}
