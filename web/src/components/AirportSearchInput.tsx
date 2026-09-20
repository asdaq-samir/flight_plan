import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { InputGroupInput } from "./ui/input-group";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
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
 *  as cheap server-side (an in-memory prefix filter, see
 *  `airport_search`'s own docstring) still isn't worth a request per
 *  character while someone's still mid-word. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * DEP/DEST, with a live "did you mean" dropdown underneath -- typing
 * "duluth" surfaces KDLH the same as typing "KDL" would, for a pilot
 * who doesn't have every ident memorized. A plain `InputGroupInput`
 * doubling as a combobox's own anchor (Radix's documented shape for
 * "an existing input drives an attached popover," not the
 * button-opens-a-search-dialog shape `Command`'s own demo shows) --
 * the popover's own open state gates on having real results, not just
 * focus, so it never flashes empty while a debounced fetch is still in
 * flight or a route's real ident has no close match at all.
 *
 * Keyboard nav is hand-rolled (a tracked `highlighted` index, Up/Down/
 * Enter/Escape on the input's own onKeyDown) rather than `cmdk`'s own
 * built-in version: `Command`'s keyboard handling assumes its own
 * `CommandInput` lives in the same DOM subtree as its `CommandItem`s,
 * which isn't true here -- `PopoverContent` portals the suggestion
 * list elsewhere in the document, while the real input (this
 * component's own anchor) has to stay exactly where the caller placed
 * it, inside the bordered `InputGroup` next to DEP or DEST's own
 * sibling field.
 */
export default function AirportSearchInput({
  value, onChange, placeholder, ariaLabel, invalid, className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debouncedValue = useDebounced(value.trim(), 200);

  const { data: suggestions } = useQuery({
    queryKey: ["airportSearch", debouncedValue],
    queryFn: () => api.airportSearch(debouncedValue),
    enabled: debouncedValue.length > 0,
    placeholderData: keepPreviousData,
  });
  const results = suggestions ?? [];

  // Reset during render, not a useEffect -- an effect only runs after
  // the stale highlight has already committed and painted against a
  // fresh keystroke's own new list, which is a visible one-frame flash
  // of the wrong row highlighted; this react-hooks-docs-recommended
  // "adjust state while rendering" pattern (see NavLogView's own
  // DescriptionCell for the same trick) applies the reset before that
  // first paint instead.
  const [lastDebouncedValue, setLastDebouncedValue] = useState(debouncedValue);
  if (debouncedValue !== lastDebouncedValue) {
    setLastDebouncedValue(debouncedValue);
    setHighlighted(0);
  }

  const pick = (ident: string) => {
    onChange(ident);
    setOpen(false);
  };

  return (
    <Popover open={open && results.length > 0}>
      <PopoverAnchor asChild>
        <InputGroupInput
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={e => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted(i => (i + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted(i => (i - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              // Picks the highlighted suggestion instead of submitting
              // the surrounding route form -- a second Enter (the
              // popover now closed) submits normally.
              const picked = results[highlighted];
              if (picked) {
                e.preventDefault();
                pick(picked.ident);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-autocomplete="list"
          autoComplete="off"
          className={className}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        // The stock z-50: this used to need z-[1000] to paint over
        // Leaflet's own panes, until Shell's `isolate` contained them.
        className="w-64 p-1"
        onOpenAutoFocus={e => e.preventDefault()}
        // Losing focus to a click inside this popover already closes
        // it via the input's own onBlur above -- Radix's own default
        // outside-interact dismissal doesn't need to fire too.
        onInteractOutside={e => e.preventDefault()}
      >
        <ul role="listbox" className="max-h-64 overflow-y-auto">
          {results.map((r, i) => (
            // Mouse-only: this row is never itself focused, so it has
            // no keyboard events of its own to handle -- the input's
            // own onKeyDown above (Up/Down/Enter) is this combobox's
            // real keyboard path, the standard ARIA combobox shape
            // (the input owns focus and keyboard input; `aria-selected`
            // here just reflects which option that's currently
            // pointing at).
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={r.ident}
              role="option"
              aria-selected={i === highlighted}
              onClick={() => pick(r.ident)}
              // Fires before the input's own onBlur -- without this,
              // the blur (which closes the popover) beats the click to
              // the punch and the option unmounts before onClick runs.
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setHighlighted(i)}
              className={cn(
                "flex cursor-default items-baseline gap-2 rounded-sm px-2 py-1.5 text-sm select-none",
                i === highlighted && "bg-accent text-accent-foreground",
              )}
            >
              <span className="font-mono font-semibold">{r.ident}</span>
              <span className="truncate text-muted-foreground">
                {r.name}
                {r.municipality ? ` · ${r.municipality}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
