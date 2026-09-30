import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchSelectOption {
  value: string;
  label: string;
  hint?: string;
}

/** Dropdown with a search box. Every dropdown in the app uses this instead of a native select. */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  allowCustom = false,
  disabled,
  className,
  contentClassName,
  title,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Offers the typed text as a value when nothing in the list fits. */
  allowCustom?: boolean;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  title?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((o) => o.value === value);
  const typed = search.trim();
  const showCustom =
    allowCustom &&
    typed !== "" &&
    !options.some((o) => o.label.toLowerCase() === typed.toLowerCase());

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          title={title}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[7px] border border-input bg-background px-3 text-left text-sm transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !selected && !value && "text-muted-foreground")}>
            {selected?.label ?? (value || placeholder)}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0", contentClassName)}
      >
        <Command>
          <CommandInput value={search} onValueChange={setSearch} placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {showCustom && (
              <CommandGroup>
                <CommandItem value={`__custom__ ${typed}`} onSelect={() => choose(typed)}>
                  <Plus aria-hidden />
                  Use “{typed}”
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value || "__empty__"}
                  value={o.value || "__empty__"}
                  keywords={[o.label, o.hint ?? ""]}
                  onSelect={() => choose(o.value)}
                >
                  <Check
                    className={cn(o.value === value ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && (
                    <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                      {o.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
