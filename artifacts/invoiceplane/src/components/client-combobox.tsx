import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { apiListClientOptions, type ClientOption } from "@/lib/modulesApi";

const SEARCH_RESULT_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 250;

type ClientComboboxProps = {
  value: string;
  onChange: (clientId: string, client?: ClientOption) => void;
  /** Display label for `value` before the user has searched (e.g. the name already known from the parent entity). */
  initialLabel?: string;
  placeholder?: string;
  /** When set, shows an extra option to clear the selection (e.g. "All clients" for a filter). */
  clearLabel?: string;
  disabled?: boolean;
  activeOnly?: boolean;
  className?: string;
};

/**
 * Server-searched client picker. Queries `/clients/options?q=` as the user types instead of
 * preloading the full client list, so it stays fast and complete past a few hundred clients.
 */
export function ClientCombobox({
  value,
  onChange,
  initialLabel,
  placeholder = "Search or select client…",
  clearLabel,
  disabled,
  activeOnly = true,
  className,
}: ClientComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS);
  const [selectedLabel, setSelectedLabel] = useState(initialLabel ?? "");

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["/clients/options", "combobox", { q: debouncedQuery, active: activeOnly }],
    queryFn: () =>
      apiListClientOptions({ q: debouncedQuery || undefined, active: activeOnly, limit: SEARCH_RESULT_LIMIT }),
    enabled: open,
    staleTime: 15_000,
  });

  const displayLabel = selectedLabel || initialLabel || "";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal h-9 px-3", className)}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? displayLabel || "Selected client" : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type to search…" value={query} onValueChange={setQuery} />
          <CommandList>
            {isFetching ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
            ) : (
              <>
                <CommandEmpty>No matching client.</CommandEmpty>
                <CommandGroup>
                  {clearLabel && (
                    <CommandItem
                      value="__clear__"
                      onSelect={() => {
                        onChange("", undefined);
                        setSelectedLabel("");
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                      {clearLabel}
                    </CommandItem>
                  )}
                  {results.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => {
                        onChange(c.id, c);
                        setSelectedLabel(c.name);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{c.name}</span>
                      {c.clientCode ? (
                        <span className="ml-2 text-xs text-muted-foreground shrink-0">{c.clientCode}</span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
