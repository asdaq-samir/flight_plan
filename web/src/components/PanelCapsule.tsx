import { History, Search, X } from "lucide-react";
import { useContext, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { useAirportSearch } from "../lib/useAirportSearch";
import { usePreferences, type RecentAirport } from "../lib/preferences";
import { ListGroup, ListRow } from "./GroupedList";
import IconButton from "./IconButton";
import { ConsoleButtonContext } from "./mapChrome";

/**
 * The panel at rest, as Maps' is on an iPhone: a capsule floating over
 * the chart (MapPanel's `compact`), the route in it and no more -- a
 * button either side, as Maps' Directions has its share and its close,
 * and under the route a chip that opens the panel to what it stands
 * for (the aeroplane and the time, the rating's progress), as Maps'
 * Options does. Drag it or its grabber and it opens into the sheet.
 * With no `trailing` of its own, the page's console button is there
 * (ConsoleButtonContext): the training page's.
 */
export function RouteCapsule({ title, detail, tone = "default", onDetail, leading, trailing }: {
  title: string;
  /** The chip's words, and what a tap on it does. */
  detail?: string;
  /** Destructive: the chip says what is wrong with the route, in red. */
  tone?: "default" | "destructive";
  onDetail?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const consoleButton = useContext(ConsoleButtonContext);
  return (
    // The two sides' buttons, or room as wide, so the route is centred.
    <div className="flex w-full items-center gap-3">
      <div className="flex w-9 shrink-0 justify-start">{leading}</div>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
        {/* A route too long for the capsule slides sideways under a
            finger, where it was cut short ("KDLH → VPBNG → ..."); one that
            fits sits in the middle, as before. Its own scroller, so the
            panel's drag, which takes no pan, does not take this one. */}
        <div className="max-w-full touch-pan-x overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="capsule-title-slide" data-slides="">
          <span className={cn("whitespace-nowrap font-semibold", TEXT.row)} data-testid="capsule-title">{title}</span>
        </div>
        {detail && (
          // The tint's own words on a wash of it, as Maps' Options chip.
          <button
            type="button" onClick={onDetail} data-testid="capsule-detail" data-tone={tone}
            className={cn(
              // A note's size, the capsule a line thinner, as Maps' Options;
              // over the title, so its 44-point hit area (index.css) is its
              // own where it reaches up across the route's line.
              "relative z-10 max-w-full rounded-full px-2.5 py-px font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.note,
              tone === "destructive" ? "bg-destructive/12 text-destructive" : "bg-tint/12 text-tint",
            )}
          >
            {/* Cut short inside, not on the button: its overflow hidden
                would clip its 44-point hit area (index.css) to its box. */}
            <span className="block truncate">{detail}</span>
          </button>
        )}
      </div>
      <div className="flex w-9 shrink-0 justify-end">{trailing ?? consoleButton}</div>
    </div>
  );
}

/**
 * The search bar, as Maps' is: the capsule's while there is no route,
 * and the same field at the top of the sheet once it is out -- one
 * element in both (MapPanel keeps it in place), so a tap that opens
 * the sheet leaves the keyboard up and the field taking what is typed.
 * Focused, the sheet comes all the way up (`onFocus`); the close beside
 * it, while the sheet is all the way out or something is typed, empties
 * it and puts the sheet away; otherwise -- on the capsule, and half way
 * up as a fresh load opens it -- the console's button is there
 * (ConsoleButtonContext), as Maps keeps the account beside
 * its search bar. Enter picks the first airport that answers, or the
 * ident typed.
 */
export function SearchField({ value, onChange, onFocus, onCancel, onSubmit, open, placeholder = "Search airports", inputRef }: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  /** The sheet is all the way out: the close shows. */
  open: boolean;
  /** What it asks for: an airport to open, or the one to keep as Home. */
  placeholder?: string;
  /** For a tap elsewhere (Favorites' Add) to focus it within the tap, which
   *  is when iOS brings the keyboard up. */
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const accessory = useContext(ConsoleButtonContext);
  return (
    <form
      role="search" className="flex w-full items-center gap-2"
      onSubmit={e => { e.preventDefault(); onSubmit(); }}
    >
      {/* 41 tall, as Maps' field is: on the sheet the grey of iOS's
          search field, on the glass capsule a lighter pane of the glass,
          no line round it. The magnifier drawn fine, as SF Symbols'. */}
      <label className={cn(
        "flex h-[2.5625rem] min-w-0 flex-1 items-center gap-2 rounded-full bg-foreground/8 px-3.5 text-muted-foreground",
        "in-data-capsule:bg-white/50 dark:in-data-capsule:bg-white/10",
        TEXT.row,
      )}>
        <Search className="size-5 shrink-0 text-foreground" strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={input} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          value={value} onChange={e => onChange(e.target.value)} onFocus={onFocus}
          placeholder={placeholder} aria-label={placeholder} data-testid="search-airports"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      {open || value ? (
        <IconButton
          label="Close the search" variant="secondary" className="rounded-full"
          onClick={() => { input.current?.blur(); onCancel(); }} data-testid="search-close"
        >
          <X />
        </IconButton>
      ) : accessory}
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
