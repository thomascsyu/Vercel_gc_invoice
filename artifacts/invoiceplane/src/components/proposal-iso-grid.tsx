import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ISO_STANDARD_OPTIONS } from "@/lib/proposal-shared";
import { cn } from "@/lib/utils";

type ProposalIsoGridProps = {
  selected: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
  className?: string;
};

export function ProposalIsoGrid({ selected, onChange, disabled, className }: ProposalIsoGridProps) {
  const toggle = (code: string) => {
    if (disabled) return;
    if (selected.includes(code)) {
      onChange(selected.filter((c) => c !== code));
    } else {
      onChange([...selected, code]);
    }
  };

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {ISO_STANDARD_OPTIONS.map((opt) => {
        const checked = selected.includes(opt.code);
        return (
          <label
            key={opt.code}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
              checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
              disabled && "opacity-60 cursor-not-allowed",
            )}
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={() => toggle(opt.code)}
              className="mt-0.5"
              aria-label={opt.label}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-none">{opt.label}</span>
              <span className="block text-xs text-muted-foreground mt-1">{opt.description}</span>
            </span>
          </label>
        );
      })}
      {selected.filter((c) => !ISO_STANDARD_OPTIONS.some((o) => o.code === c)).map((custom) => (
        <div key={custom} className="flex items-center gap-2 rounded-lg border border-dashed p-3 sm:col-span-2">
          <Checkbox checked disabled />
          <span className="text-sm">{custom}</span>
          {!disabled && (
            <button
              type="button"
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onChange(selected.filter((c) => c !== custom))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProposalIsoGridLabel() {
  return <Label>ISO standards</Label>;
}
