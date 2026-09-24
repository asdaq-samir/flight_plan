import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { api } from "../lib/api/client";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  invalid?: boolean;
  className?: string;
}

/** 200ms, not on every keystroke -- a lookup this app already treats
 *  as cheap server-side (an in-memory prefix filter) still isn't worth
 *  a request per character while someone's still mid-word. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * DEP or DEST as shadcn's own combobox: a button showing the ident that
 * opens a `Command` -- its search box, its list, its keyboard handling
 * (Up/Down/Enter/Escape, the highlighted row, `aria-activedescendant`)
 * all cmdk's -- with the airport lookup as the list. Typing "duluth"
 * surfaces KDLH the same as typing "KDL" would, for a pilot who does
 * not have every ident memorised; an ident the lookup does not know
 * (a private strip, say) still goes through on Enter. This replaced a
 * hand-rolled input-anchored combobox that carried its own keyboard
 * navigation and ARIA wiring; the stock shape costs one more tap and
 * gives a phone a full-width search box and rows the size of a finger.
 */
export default function AirportPicker({ value, onChange, placeholder, ariaLabel, invalid, className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const q = useDebounced(typed, 200);
  const { data, isPlaceholderData } = useQuery({
    queryKey: ["airportSearch", q],
    queryFn: () => api.airportSearch(q),
    enabled: open && q.length > 0,
    placeholderData: keepPreviousData,
  });
  // The rows answer `q`, which trails the box by the debounce and then by
  // the request (the last answer stays up while the next one loads).
  // Enter takes the highlighted row only once the rows answer what is in
  // the box: it used to take it whenever there were rows, so "KD", a
  // pause, then "LH" and a quick Enter set the field to the first "KD..."
  // airport rather than KDLH.
  const rows = typed && q ? (data ?? []) : [];
  const answered = q === typed && !isPlaceholderData;

  const pick = (ident: string) => {
    onChange(ident.toUpperCase());
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          className={cn("font-mono uppercase", !value && "text-muted-foreground", className)}
        >
          {value || placeholder}
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {/* The server already filters (an ident or name prefix), so
            cmdk's own filter is off: it would drop a row whose name
            matched but whose ident, the `value`, did not. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Ident or airport name"
            value={query}
            onValueChange={setQuery}
            onKeyDown={e => {
              // What was typed goes through when the rows are not the
              // answer to it yet, and when the lookup has nothing for it
              // (a private strip, say).
              if (e.key === "Enter" && typed && !(answered && rows.length > 0)) {
                e.preventDefault();
                pick(typed);
              }
            }}
          />
          {/* Dimmed while they answer something older than the box. */}
          <CommandList className={cn(!answered && "opacity-60")} aria-busy={!answered}>
            <CommandEmpty>{typed ? "No airport matches; Enter keeps what you typed." : "Type an ident, or a name."}</CommandEmpty>
            {rows.map(r => (
              <CommandItem key={r.ident} value={r.ident} onSelect={() => pick(r.ident)}>
                <span className="font-mono font-semibold">{r.ident}</span>
                <span className="truncate text-muted-foreground">
                  {r.name}
                  {r.municipality ? ` · ${r.municipality}` : ""}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
