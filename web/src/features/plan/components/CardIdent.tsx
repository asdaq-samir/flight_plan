import { useCallback, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "cn";
import AirportResults from "../../../components/AirportResults";
import { Popover, PopoverAnchor, PopoverContent } from "../../../components/ui/popover";
import { usePreferences, type RecentAirport } from "../../../lib/preferences";
import { TEXT } from "../../../lib/text";
import { useAirportSearch, type AirportSearchRow } from "../../../lib/useAirportSearch";

const NO_ROWS: AirportSearchRow[] = [];

/**
 * A card's ident a text box, at the owner's ask (2026-11-05: "the airport
 * id should be a text box", after "Make the cards airport ids editable so
 * it can be changed to anything"): typed over and taken as typed on Return
 * or as it is left, Escape putting it back. The app's neutral fill, a
 * field's, its width the ident's (or the card's, `wide`); over the head's
 * tap that folds the card. In the Plan's every card has one, the two ends'
 * before there is a route (RouteEnds) and a stop's being added
 * (ProceduresRoute), there being no route box there ("I want to
 * completely get rid of the route box for in the plan").
 */
export default function CardIdent({ value, label, onCommit, testId, bold = true, placeholder, focused = false, wide = false, onEmpty, suggest = true, fixes = false }: {
  value: string;
  label: string;
  onCommit: (ident: string) => void;
  testId: string;
  bold?: boolean;
  /** Its words while empty, in their own case. */
  placeholder?: string;
  /** Focused as it is drawn: a stop being added, typed into at once. By a
   *  ref, which runs as the input is put in, not the autoFocus attribute
   *  (jsx-a11y/no-autofocus, CI's lint); the same where it is asked for. */
  focused?: boolean;
  /** The rest of the card's line, not the ident's width. */
  wide?: boolean;
  /** Left empty: a stop being added, given up. */
  onEmpty?: () => void;
  /** Offers airports as it is typed; off where the ident is a name, not a
   *  place (a procedure step's rename). */
  suggest?: boolean;
  /** Offers the VFR and GPS waypoints too, as the route box does for a
   *  stop only; the ends and the fields' idents take airports. */
  fixes?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement | null>(null);
  const focusIn = useCallback((el: HTMLInputElement | null) => { input.current = el; el?.focus(); }, []);
  const keep = useCallback((el: HTMLInputElement | null) => { input.current = el; }, []);
  // The airports and waypoints that answer what is typed, under the field,
  // as the route box offers them (the owner, 2026-11-06: "route cards are
  // not showing ... airport suggestion with the search as you type"): the
  // same search and list, cmdk's arrows and Enter on the field.
  const [typing, setTyping] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const searching = suggest && typing && draft.trim() !== "" && draft !== value;
  const { rows, answered } = useAirportSearch(draft, searching, fixes);
  const open = searching && rows.length > 0 && dismissed !== draft;
  // Its ident again where the route changed it from elsewhere.
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setDraft(value);
  }
  // Set as a suggestion is taken, so the blur after it puts in nothing
  // more: its draft, read in that blur, is still what was half typed.
  const picked = useRef(false);
  // Set once an arrow has moved the highlight since the last typing: cmdk
  // lights the first row by itself, which Return must not take for the pilot.
  const arrowed = useRef(false);
  const commit = () => {
    setTyping(false);
    if (picked.current) {
      picked.current = false;
      return;
    }
    const next = draft.trim().toUpperCase();
    if (next && next !== value) onCommit(next);
    else if (!next && onEmpty) onEmpty();
    else setDraft(value);
  };
  // A suggestion taken: its ident the field's, committed as Return would.
  const pick = (ident: string, airport?: RecentAirport) => {
    if (airport) usePreferences.getState().addRecentAirport(airport);
    setDraft(ident);
    setTyping(false);
    if (ident !== value) onCommit(ident);
    picked.current = document.activeElement === input.current;
    input.current?.blur();
  };
  // As wide as what it holds: the input over a hidden copy of its words in
  // one grid cell, the copy giving the width, where its `size` in
  // characters cut KUGN's N off in the semibold capitals (the owner's
  // screenshot, 2026-11-05).
  const box = (
    <input
      value={draft} aria-label={label} data-testid={testId} placeholder={placeholder} ref={focused ? focusIn : keep}
      autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} enterKeyHint="done"
      size={1}
      onChange={e => { picked.current = false; arrowed.current = false; setDraft(e.target.value.toUpperCase()); setTyping(true); }}
      onFocus={() => { picked.current = false; }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") arrowed.current = true;
        // Return takes a suggestion only once an arrow has chosen it (cmdk's
        // own Enter on the root, after this); else the typing, and cmdk is
        // not let to take the row it lit by default.
        if (e.key === "Enter") {
          if (open && arrowed.current) return;
          e.stopPropagation();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") { setDraft(value); setTyping(false); e.currentTarget.blur(); }
      }}
      className={cn(
        "relative z-10 -my-0.5 min-w-0 rounded-md bg-foreground/8 px-1.5 py-0.5 uppercase outline-none placeholder:font-normal placeholder:normal-case placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
        bold ? "font-semibold" : "font-normal", wide ? "w-full flex-1 py-1.5" : "col-start-1 row-start-1 w-full", TEXT.row,
      )}
    />
  );
  const field = wide ? box : (
    <span className="inline-grid min-w-0">
      <span aria-hidden="true" className={cn("invisible col-start-1 row-start-1 -my-0.5 px-1.5 py-0.5 whitespace-pre", draft || !placeholder ? cn("uppercase", bold ? "font-semibold" : "font-normal") : "font-normal", TEXT.row)}>
        {(draft || placeholder || "WWW") + " "}
      </span>
      {box}
    </span>
  );
  return (
    <CommandPrimitive shouldFilter={false} loop className={wide ? "flex min-w-0 flex-1" : "contents"}>
      <Popover open={open} onOpenChange={next => { if (!next) setDismissed(draft); }}>
        <PopoverAnchor asChild>{field}</PopoverAnchor>
        <PopoverContent
          align="start" sideOffset={6} className="w-72 max-w-[calc(100vw-16px)] gap-0 p-2"
          // The typing stays in the field: a press on a row would take the
          // focus first, and the field's blur put in the half typed.
          onOpenAutoFocus={e => e.preventDefault()}
          onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}
          data-testid={`${testId}-suggestions`}
        >
          <AirportResults
            rows={open ? rows : NO_ROWS} answered={answered}
            onAirport={airport => pick(airport.ident, airport)} onWaypoint={ident => pick(ident)}
          />
        </PopoverContent>
      </Popover>
    </CommandPrimitive>
  );
}
