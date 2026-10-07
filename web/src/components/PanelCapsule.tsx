import { CircleAlert, History, Search, X } from "lucide-react";
import { useCallback, useContext, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "cn";
import { routeNameWithin } from "../lib/identSchema";
import { TEXT } from "../lib/text";
import { textWidth } from "../lib/textWidth";
import { useAirportSearch } from "../lib/useAirportSearch";
import { usePreferences, type RecentAirport } from "../lib/preferences";
import { ListGroup, ListRow } from "./GroupedList";
import { ConsoleButtonContext } from "./mapChrome";

/**
 * The panel at rest, as Maps' is on an iPhone: a capsule floating over
 * the chart (MapPanel's `compact`). The planner's is one line, as the
 * search bar is: Share at its start (`leading`), the route, a tap on it
 * opening the panel, and the console's button at its end
 * (ConsoleButtonContext) -- what is wrong with the route a red mark
 * beside it. The training page's has a chip under
 * the route that opens the panel to what it stands for (the rating's
 * progress), as Maps' Options does, and a button either side. Drag it or
 * its grabber and it opens into the sheet.
 */
export function RouteCapsule({ title, detail, warning, onDetail, leading }: {
  title: string;
  /** A chip's words under the route, and what a tap on it does. */
  detail?: string;
  /** One line's: what is wrong with the route, a red mark beside it. */
  warning?: string;
  onDetail?: () => void;
  leading?: ReactNode;
}) {
  const consoleButton = useContext(ConsoleButtonContext);
  if (!detail) {
    return (
      <div className="flex w-full items-center gap-2">
        {leading && <div className="flex shrink-0">{leading}</div>}
        {/* The route, a tap on it the panel: no sideways slide -- cut
            in its middle, the panel shows it whole. */}
        <button
          type="button" onClick={onDetail} data-testid="capsule-detail" data-tone={warning ? "destructive" : "default"}
          aria-label={warning ? `${title}, ${warning}` : title}
          // Over the grabber's hit area (index.css), which reached down
          // across its top: the route is what a tap there means, the
          // grabber's own the drag.
          className="z-10 flex h-[2.5625rem] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {warning && <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />}
          <FittedRoute title={title} marked={!!warning} />
        </button>
        <div className="flex shrink-0 justify-end">{consoleButton}</div>
      </div>
    );
  }
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
        {/* The tint's own words on a wash of it, as Maps' Options chip. */}
        <button
          type="button" onClick={onDetail} data-testid="capsule-detail"
          className={cn(
            // A note's size, the capsule a line thinner, as Maps' Options;
            // over the title, so its 44-point hit area (index.css) is its
            // own where it reaches up across the route's line.
            "relative z-10 max-w-full rounded-full px-2.5 py-px font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.note,
            "bg-tint/12 text-tint",
          )}
        >
          {/* Cut short inside, not on the button: its overflow hidden
              would clip its 44-point hit area (index.css) to its box. */}
          <span className="block truncate">{detail}</span>
        </button>
      </div>
      <div className="flex w-9 shrink-0 justify-end">{consoleButton}</div>
    </div>
  );
}

/**
 * The one-line capsule's route, cut in its middle to fit (routeNameWithin)
 * so the destination is always at its end: measured in the title's own
 * font against the room its button has, less the warning's mark (a rem
 * and its gap), again whenever the button's width changes and once the
 * font has loaded. The button's label says the route whole.
 */
function FittedRoute({ title, marked }: { title: string; marked: boolean }) {
  const [room, setRoom] = useState<{ width: number; font: string; rem: number } | null>(null);
  // At commit, so the first frame drawn is already cut to fit.
  const watch = useCallback((span: HTMLSpanElement | null) => {
    const button = span?.parentElement;
    if (!span || !button) return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const box = getComputedStyle(button), text = getComputedStyle(span);
      const next = {
        width: button.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight),
        font: `${text.fontWeight} ${text.fontSize} ${text.fontFamily}`,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      };
      setRoom(was => was && was.width === next.width && was.font === next.font && was.rem === next.rem ? was : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    void document.fonts?.ready.then(measure);
    return () => { live = false; observer.disconnect(); };
  }, []);
  const shown = room
    ? routeNameWithin(title, name => (textWidth(name, room.font) ?? 0) <= room.width - (marked ? room.rem * 1.375 : 0) - 1)
    : title;
  return (
    <span ref={watch} className={cn("truncate font-semibold", TEXT.row, marked && "text-destructive")} data-testid="capsule-title">{shown}</span>
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
export function SearchField({ value, onChange, onFocus, onCancel, onSubmit, placeholder = "Search airports", inputRef }: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onCancel: () => void;
  onSubmit: () => void;
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
          // Escape puts the search away, as the close beside it did.
          onKeyDown={e => { if (e.key === "Escape") { input.current?.blur(); onCancel(); } }}
          placeholder={placeholder} aria-label={placeholder} data-testid="search-airports"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {/* What is typed cleared inside the field, as iOS's search field
            clears it. */}
        {value && (
          <button
            type="button" aria-label="Clear the search" data-testid="search-clear"
            onClick={() => { onChange(""); input.current?.focus(); }}
            className="grid size-5 shrink-0 place-items-center rounded-full bg-muted-foreground/50 text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" strokeWidth={3} />
          </button>
        )}
      </label>
      {/* The console's button beside it however far out the sheet is, as
          Maps keeps the account's beside its search: it was a close with
          the sheet out, at the pilot's ask the console's button. The sheet
          comes down by its grabber, a drag, or Escape. */}
      {accessory}
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
