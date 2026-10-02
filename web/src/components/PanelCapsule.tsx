import { History, Search, X } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { useAirportSearch } from "../lib/useAirportSearch";
import { usePreferences, type RecentAirport } from "../lib/preferences";
import { ListGroup, ListRow } from "./GroupedList";
import IconButton from "./IconButton";

/**
 * The panel at rest, as Maps' is on an iPhone: a capsule floating over
 * the chart (MapPanel's `compact`), the route in it and no more -- a
 * button either side, as Maps' Directions has its share and its close,
 * and under the route a chip that opens the panel to what it stands
 * for (the aeroplane and the time, the rating's progress), as Maps'
 * Options does. Drag it or its grabber and it opens into the sheet.
 */
export function RouteCapsule({ title, detail, onDetail, leading, trailing }: {
  title: string;
  /** The chip's words, and what a tap on it does. */
  detail?: string;
  onDetail?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    // The two sides' buttons, or room as wide, so the route is centred.
    <div className="flex w-full items-center gap-3">
      <div className="flex w-9 shrink-0 justify-start">{leading}</div>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
        {/* Not a target of its own: the chip's hit area (index.css)
            reaches up under it, as Maps' Options takes a tap on its title. */}
        <span className={cn("pointer-events-none max-w-full truncate font-semibold", TEXT.row)} data-testid="capsule-title">{title}</span>
        {detail && (
          // The tint's own words on a wash of it, as Maps' Options chip.
          <button
            type="button" onClick={onDetail} data-testid="capsule-detail"
            className={cn("max-w-full rounded-full bg-tint/12 px-3 py-0.5 font-medium text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.detail)}
          >
            {/* Cut short inside, not on the button: its overflow hidden
                would clip its 44-point hit area (index.css) to its box. */}
            <span className="block truncate">{detail}</span>
          </button>
        )}
      </div>
      <div className="flex w-9 shrink-0 justify-end">{trailing}</div>
    </div>
  );
}

/**
 * The search bar, as Maps' is: the capsule's while there is no route,
 * and the same field at the top of the sheet once it is out -- one
 * element in both (MapPanel keeps it in place), so a tap that opens
 * the sheet leaves the keyboard up and the field taking what is typed.
 * Focused, the sheet comes all the way up (`onFocus`); the close beside
 * it, while the sheet is out or something is typed, empties it and puts
 * the sheet away. Enter picks the first airport that answers, or the
 * ident typed.
 */
export function SearchField({ value, onChange, onFocus, onCancel, onSubmit, open, placeholder = "Search airports", inputRef }: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  /** The sheet is out: the close shows. */
  open: boolean;
  /** What it asks for: an airport to open, or the one to keep as Home. */
  placeholder?: string;
  /** For a tap elsewhere (Favorites' Add) to focus it within the tap, which
   *  is when iOS brings the keyboard up. */
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  return (
    <form
      role="search" className="flex w-full items-center gap-2"
      onSubmit={e => { e.preventDefault(); onSubmit(); }}
    >
      <label className={cn("flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-foreground/8 px-4 text-muted-foreground", TEXT.row)}>
        <Search className="size-5 shrink-0" aria-hidden="true" />
        <input
          ref={input} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          value={value} onChange={e => onChange(e.target.value)} onFocus={onFocus}
          placeholder={placeholder} aria-label={placeholder} data-testid="search-airports"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      {(open || value) && (
        <IconButton
          label="Close the search" variant="secondary" className="rounded-full"
          onClick={() => { input.current?.blur(); onCancel(); }} data-testid="search-close"
        >
          <X />
        </IconButton>
      )}
    </form>
  );
}

/**
 * Under the search bar with the sheet out: the airports last picked
 * before anything is typed, as Maps' Recents, then the airports that
 * answer what is typed -- ident, name and town, a tap opening the
 * field's card.
 */
export function SearchResults({ query, onPick, places }: {
  query: string;
  onPick: (airport: RecentAirport) => void;
  /** Over the recents before anything is typed: Favorites. */
  places?: ReactNode;
}) {
  const { typed, rows, answered } = useAirportSearch(query);
  const recents = usePreferences(s => s.recentAirports);
  if (!typed) {
    return (
      <div className="space-y-6">
        {places}
        {recents.length > 0 ? (
      <ListGroup title="Recents">
        {recents.map(a => (
          <ListRow
            key={a.ident} media={<History className="size-5 text-muted-foreground" />}
            title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
            description={a.municipality ?? undefined}
            onClick={() => onPick(a)}
          />
        ))}
      </ListGroup>
        ) : (
          <p className={cn("px-1 text-muted-foreground", TEXT.note)}>Search by an airport's ident, its name or its town.</p>
        )}
      </div>
    );
  }
  return (
    <ListGroup title="Airports" className={cn(!answered && "opacity-60")}>
      {rows.length === 0 && answered && <ListRow title={<span className="text-muted-foreground">No airport matches; Enter keeps what you typed.</span>} />}
      {rows.map(a => (
        <ListRow
          key={a.ident} media={<Search className="size-5 text-muted-foreground" />}
          title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
          description={a.municipality ?? undefined}
          onClick={() => onPick({ ident: a.ident, name: a.name, municipality: a.municipality })}
          data-testid="search-result"
        />
      ))}
    </ListGroup>
  );
}
