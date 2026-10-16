import { History, Search } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { useAirportSearch } from "../lib/useAirportSearch";
import { usePreferences, type RecentAirport } from "../lib/preferences";
import { ListGroup, ListRow } from "./GroupedList";
import { ClearList, SwipeToDelete } from "./SwipeToDelete";
import { ListPageHead, PillSection, PillStrip, SmallAirportTile } from "./Favorites";
import { useAway } from "../lib/useAway";
import ClearButton from "./ClearButton";
import { PANEL_FIELD } from "./panelField";

/**
 * The search bar, as Maps' is, at the top of a tab's sheet the whole
 * width (Settings a tab of the bar, not a button beside it). Focused, the
 * sheet comes all the way up (`onFocus`); what is typed cleared inside it
 * (ClearButton); Escape puts the search away. Enter picks the first
 * airport that answers, or the ident typed.
 */
export function SearchField({
  value, onChange, onFocus, onCancel, onSubmit, placeholder = "Search airports", inputRef, label, testId = "search-airports",
  icon = Search, capitals = false, onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  /** What it asks for: an airport to open, or the one to keep as Home. */
  placeholder?: string;
  /** What a screen reader hears, where it says more than the placeholder. */
  label?: string;
  testId?: string;
  /** Its glyph: the magnifier, or a pin for where from (Nearest). */
  icon?: typeof Search;
  /** Typed in capitals, as callsigns and registrations are. */
  capitals?: boolean;
  /** Its clear, where clearing does more than empty it (Nearest's goes back
   *  to the position). */
  onClear?: () => void;
  /** For a tap elsewhere (Favorites' Add) to focus it within the tap, which
   *  is when iOS brings the keyboard up. */
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const Icon = icon;
  return (
    <form
      role="search" className="flex w-full items-center gap-2"
      onSubmit={e => { e.preventDefault(); onSubmit(); }}
    >
      {/* 41 tall, as Maps' field is: on the sheet the grey of iOS's
          search field, on the glass capsule a lighter pane of the glass,
          no line round it. The magnifier drawn fine, as SF Symbols'. */}
      {/* Its 44-point hit area its own, a point and a half past its 41
          above and below (CLAUDE.md: nothing grows to it), strips that
          leave the words to the field, where a tap places the caret. */}
      <label className={cn(
        "relative flex h-[2.5625rem] min-w-0 flex-1 items-center gap-2 rounded-full px-3.5 text-muted-foreground", PANEL_FIELD,
        "before:absolute before:inset-x-0 before:-top-0.5 before:h-0.5 before:content-[''] after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:content-['']",
        TEXT.row,
      )}>
        <Icon className="size-5 shrink-0 text-foreground" strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={input} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          autoCapitalize={capitals ? "characters" : undefined}
          value={value} onChange={e => onChange(e.target.value)} onFocus={onFocus}
          // Escape puts the search away, as the close beside it did.
          onKeyDown={e => { if (e.key === "Escape") { input.current?.blur(); onCancel(); } }}
          placeholder={placeholder} aria-label={label ?? placeholder} data-testid={testId}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {/* What is typed cleared inside the field, as iOS's search field
            clears it. */}
        {value && (
          <ClearButton
            label="Clear the search" testId="search-clear"
            onClear={() => { if (onClear) onClear(); else onChange(""); input.current?.focus(); }}
          />
        )}
      </label>
    </form>
  );
}

/**
 * Under the search bar with the sheet out: the airports last picked
 * before anything is typed, as Maps' Recents, then the airports that
 * answer what is typed -- ident, name and town, a tap opening the
 * field's card.
 */
export function SearchResults({ query, onPick, places, onAllRecents }: {
  query: string;
  onPick: (airport: RecentAirport) => void;
  /** Over the recents before anything is typed: Favorites. */
  places?: ReactNode;
  /** The Recents in full (AirportRecentsPage), from the section's title. */
  onAllRecents?: () => void;
}) {
  const { typed, rows, answered } = useAirportSearch(query);
  const recents = usePreferences(s => s.recentAirports);
  // Each a section of the tab's page (TabPage), headed as the Favorites
  // are: the airports opened last as the Favorites' tiles, their chart's
  // symbols, at the owner's ask ("Recents should also have symbols instead
  // of a list"); the title the list, where each is taken off and Clear.
  if (!typed) {
    return (
      <>
        {places}
        {recents.length > 0 ? (
          <PillSection title="Recents" testId="airport-recents" onMore={onAllRecents}>
            <RecentAirportStrip recents={recents} onPick={onPick} />
          </PillSection>
        ) : (
          <p className={cn("px-1 text-muted-foreground", TEXT.note)}>Search by an airport's ident, its name or its town.</p>
        )}
      </>
    );
  }
  return (
    <PillSection title="Airports" testId="airport-results">
      <ListGroup className={cn(!answered && "opacity-60")}>
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
    </PillSection>
  );
}

/** The airports picked last as tiles, newest first: each its chart symbol,
 *  its ident, and how far it is from own ship, else its town. */
function RecentAirportStrip({ recents, onPick }: { recents: RecentAirport[]; onPick: (airport: RecentAirport) => void }) {
  const away = useAway();
  return (
    <PillStrip testId="pill-airport-recents">
      {recents.map(a => (
        <SmallAirportTile key={a.ident} airport={a} detail={away(a) ?? a.municipality ?? ""} onClick={() => onPick(a)} testId="airport-recent" />
      ))}
    </PillStrip>
  );
}

/** The airports picked last, each taken off by a swipe to the left (or a
 *  long press), at the pilot's ask, as Maps' Recents are. */
function RecentAirportRows({ recents, onPick }: { recents: RecentAirport[]; onPick: (airport: RecentAirport) => void }) {
  const remove = usePreferences(s => s.removeRecentAirport);
  return (
    <ListGroup>
      {recents.map(a => (
        <SwipeToDelete key={a.ident} label={`Remove ${a.ident} from Recents`} onDelete={() => remove(a.ident)}>
          <ListRow
            media={<History className="size-5 text-muted-foreground" />}
            title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
            description={a.municipality ?? undefined}
            onClick={() => onPick(a)} data-testid="airport-recent"
          />
        </SwipeToDelete>
      ))}
    </ListGroup>
  );
}

/** The airports' Recents in full, from their section's title: every one,
 *  and Clear for all of them, asked first. */
export function AirportRecentsPage({ onBack, onPick }: { onBack: () => void; onPick: (airport: RecentAirport) => void }) {
  const recents = usePreferences(s => s.recentAirports);
  const clear = usePreferences(s => s.clearRecentAirports);
  return (
    <>
      <ListPageHead
        title="Recents" backLabel="Back to the search" onBack={onBack} testId="airport-recents-page"
        action={recents.length > 0 && <ClearList title="Clear the Recents?" description="The airports opened last are forgotten in this browser. Favorites stay." onClear={clear} testId="recents-clear" />}
      />
      {recents.length > 0
        ? <RecentAirportRows recents={recents} onPick={onPick} />
        : <p className={cn("px-1 text-muted-foreground", TEXT.note)}>None yet: the airports opened are kept here.</p>}
    </>
  );
}
