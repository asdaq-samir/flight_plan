import { ChevronLeft, ChevronRight, CircleMinus, GripVertical, House, ListFilter, Plus } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { distanceNm } from "../lib/geo";
import { airportMarkSvg } from "../lib/map/airportMark";
import { colourOf } from "../lib/map/flightCategory";
import { useOwnShip } from "../lib/map/ownShip";
import type { AirspaceClass, RecentAirport } from "../lib/preferences";
import { useAirspace } from "../lib/useAirspace";
import { holdOpenCard } from "../lib/openCards";
import { SwipeToDelete } from "./SwipeToDelete";
import { useSwipeRow } from "./swipeRow";
import { useAway } from "../lib/useAway";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ListGroup, ListRow } from "./GroupedList";
import IconButton from "./IconButton";
import { airportQuery } from "../lib/queryClient";

/**
 * The row of round tiles itself -- Home, then the favorites -- shared by
 * the search bar's Favorites and the route form's pickers
 * (AirportPicker), which offer the same airports before anything is
 * typed. Without `onAddHome`, a Home not set yet is left out.
 */
export function FavoriteTiles({ home, favorites, onOpen, onAddHome, trailing }: {
  home: RecentAirport | null;
  favorites: RecentAirport[];
  onOpen: (airport: RecentAirport) => void;
  onAddHome?: () => void;
  trailing?: ReactNode;
}) {
  // How far, from own ship's fix as it is: the tiles' own, drawn again at
  // each, where the page round them is not (useOwnShipNear).
  const from = useOwnShip(o => (o.enabled ? o.fix : null));
  const away = (a: RecentAirport) =>
    from && a.lat !== undefined && a.lon !== undefined
      ? `${Math.round(distanceNm(from, { lat: a.lat, lon: a.lon }))} nm`
      : a.municipality ?? a.name;
  return (
    // Out to the sheet's edges as it scrolls, its margin kept inside.
    <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" data-testid="favorites">
      {(home || onAddHome) && (
        <PlaceTile
          icon={<House />} className="bg-teal-600 text-white" title="Home"
          detail={home ? away(home) : "Add"} tinted={!home}
          onClick={home ? () => onOpen(home) : onAddHome!} testId="favorite-home"
        />
      )}
      {favorites.map(a => <AirspaceTile key={a.ident} airport={a} detail={away(a)} onClick={() => onOpen(a)} />)}
      {trailing}
    </div>
  );
}

function AirspaceTile({ airport, detail, onClick }: { airport: RecentAirport; detail: string; onClick: () => void }) {
  const space = useAirspace(airport);
  // Its chart symbol on the tile, as Nearest's fields wear theirs, at the
  // owner's ask, where it was a plane on the airspace's colour.
  return (
    <PlaceTile
      icon={<KeptChartMark airport={airport} size={32} />} title={airport.ident} detail={detail} onClick={onClick}
      label={`${airport.ident}, ${space.name}`} className="bg-foreground/8 [&_svg]:size-8"
    />
  );
}

/** A round tile and its words under it, as Maps' Favorites: the
 *  airports' here, and the Aircraft card's own (AircraftCard). */
function PlaceTile({ icon, className, style, title, label, detail, tinted, onClick, testId }: {
  icon: ReactNode;
  className?: string;
  style?: CSSProperties;
  title: string;
  /** What a screen reader hears, where the tile's look says more than its words. */
  label?: string;
  detail?: string;
  tinted?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId} aria-label={label}
      className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cn("grid size-14 place-items-center rounded-full [&_svg]:size-6", className)} style={style} aria-hidden="true">{icon}</span>
      <span className={cn("w-full truncate text-center font-medium text-foreground", TEXT.detail)}>{title}</span>
      {detail && <span className={cn("-mt-1.5 w-full truncate text-center", TEXT.note, tinted ? "text-tint" : "text-muted-foreground")}>{detail}</span>}
    </button>
  );
}

/** A row's small round mark, the tile's at a list row's size. */
export function Mark({ icon, className, style }: { icon: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={cn("grid size-8 place-items-center rounded-full [&_svg]:size-4", className)} style={style} aria-hidden="true">{icon}</span>;
}

function KeptMark({ airport }: { airport: RecentAirport }) {
  return <KeptChartMark airport={airport} size={26} />;
}

/** A list's Edit, Done while it is being edited (the Favorites' in full). */
export function EditToggle({ editing, onToggle, testId }: { editing: boolean; onToggle: () => void; testId?: string }) {
  return (
    <Button
      type="button" variant="ghost" size="sm"
      className={cn("-mr-1 h-auto px-1 py-0.5 font-normal text-tint", TEXT.row, editing && "font-semibold")}
      onClick={onToggle} data-testid={testId}
    >
      {editing ? "Done" : "Edit"}
    </Button>
  );
}

/** The minus before a row being edited. In a row with a Delete behind it
 *  (SwipeToDelete) it brings the Delete out, as iOS's minus does, the
 *  Delete then taking it away: one way to remove from every kept list, at
 *  the owner's pick ("Yes to both"), where a tap on it took the row away
 *  at once on some lists. Elsewhere -- a form's segments -- it takes the
 *  row away itself (`onClick`). */
export function RemoveMinus({ label, onClick, testId }: { label: string; onClick?: () => void; testId?: string }) {
  const row = useSwipeRow();
  return (
    <IconButton label={label} className="-ml-1.5 text-destructive" onClick={row ? row.reveal : onClick} data-testid={testId}>
      <CircleMinus className="size-5 fill-destructive text-white dark:text-background" />
    </IconButton>
  );
}

/** The handle after a row being edited: a drag moves its row a place
 *  each time the finger passes half a row, the list re-ordering under it
 *  as it goes, and the arrow keys a place at a time. */
export function MoveHandle({ label, index, count, onMove }: {
  label: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const drag = (start: ReactPointerEvent<HTMLButtonElement>) => {
    const handle = start.currentTarget;
    const row = handle.closest("[data-slot=item]") as HTMLElement | null;
    const height = row?.offsetHeight ?? 52;
    handle.setPointerCapture(start.pointerId);
    let at = index, anchor = start.clientY;
    const move = (event: PointerEvent) => {
      const dy = event.clientY - anchor;
      if (dy > height / 2 && at < count - 1) { onMove(at, at + 1); at += 1; anchor += height; }
      else if (dy < -height / 2 && at > 0) { onMove(at, at - 1); at -= 1; anchor -= height; }
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  return (
    <IconButton
      label={label} className="touch-none" onPointerDown={drag}
      onKeyDown={e => {
        if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); onMove(index, index - 1); }
        if (e.key === "ArrowDown" && index < count - 1) { e.preventDefault(); onMove(index, index + 1); }
      }}
    >
      <GripVertical className="size-5 text-muted-foreground" />
    </IconButton>
  );
}

/**
 * Favorites in full, as Maps' own list: Home, which a tap changes
 * through the search bar, and the kept airports, which a tap opens --
 * and with Edit, a minus before each to let it go and a handle after
 * each to drag it up or down the list (or move it with the arrow keys).
 * Add a Favorite asks the search bar for one more.
 */
export function FavoritesList({ home, favorites, onBack, onOpen, onChangeHome, onRemoveHome, onRemove, onMove, onAdd }: {
  home: RecentAirport | null;
  favorites: RecentAirport[];
  onBack: () => void;
  onOpen: (airport: RecentAirport) => void;
  onChangeHome: () => void;
  onRemoveHome: () => void;
  onRemove: (airport: RecentAirport) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-6" data-testid="favorites-list">
      {/* Every list's head (ListPageHead), where this was a copy of it. */}
      <ListPageHead
        title="Favorites" backLabel="Back to the search" onBack={onBack} testId="favorites-page"
        action={<EditToggle editing={editing} onToggle={() => setEditing(e => !e)} testId="favorites-edit" />}
      />
      <ListGroup title="Home">
        {!home ? (
          <ListRow media={<Plus className="size-5" />} title="Add Home" onClick={onChangeHome} data-testid="favorites-home" />
        ) : (
          // Taken off as every kept list's rows are: a swipe to the left, or
          // Edit's minus bringing out the Delete (SwipeToDelete).
          <SwipeToDelete label={`Remove ${home.ident} as Home`} onDelete={onRemoveHome}>
            {editing ? (
              <ListRow
                media={<RemoveMinus label={`Remove ${home.ident} as Home…`} testId="favorites-home-remove" />}
                title={<><span className="font-mono font-semibold">{home.ident}</span> · {home.name}</>}
                description={home.municipality ?? undefined}
              />
            ) : (
              <ListRow
                media={<Mark icon={<House />} className="bg-teal-600 text-white" />} chevron
                title={<><span className="font-mono font-semibold">{home.ident}</span> · {home.name}</>}
                description={home.municipality ?? undefined} onClick={onChangeHome} data-testid="favorites-home"
              />
            )}
          </SwipeToDelete>
        )}
      </ListGroup>
      <ListGroup title="Airports">
        {favorites.length === 0 && <ListRow title={<span className="text-muted-foreground">A star on an airport's card adds it here</span>} />}
        {favorites.map((a, index) => (
          <SwipeToDelete key={a.ident} label={`Remove ${a.ident} from Favorites`} onDelete={() => onRemove(a)}>
            {editing ? (
              <ListRow
                media={<RemoveMinus label={`Remove ${a.ident} from Favorites…`} />}
                title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
                description={a.municipality ?? undefined}
              >
                <MoveHandle label={`Move ${a.ident}`} index={index} count={favorites.length} onMove={onMove} />
              </ListRow>
            ) : (
              <ListRow
                media={<KeptMark airport={a} />} chevron
                title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
                description={a.municipality ?? undefined} onClick={() => onOpen(a)}
              />
            )}
          </SwipeToDelete>
        ))}
        <ListRow media={<Plus className="size-5" />} title="Add a Favorite" onClick={onAdd} data-testid="favorites-add" />
      </ListGroup>
    </div>
  );
}

/**
 * A tile for a pill's strip (PillStrip): a round mark, a name and a line
 * under it -- the Airport and Aircraft tabs' Favorites, Airport's nearest
 * fields -- at the full card's Favorites' size (PlaceTile), at the owner's
 * ask ("make the fav icons the same size as the full card").
 */
export function SmallTile({ mark, title, detail, label, onClick, testId, wide = false }: {
  mark: ReactNode;
  title: string;
  detail?: string;
  label?: string;
  onClick: () => void;
  testId?: string;
  /** Room for a route's two idents (SavedStrip), not one's. */
  wide?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId} aria-label={label}
      className={cn(wide ? "w-24" : "w-[4.5rem]", "flex shrink-0 flex-col items-center gap-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {mark}
      <span className={cn("w-full truncate text-center font-medium text-foreground", TEXT.detail)}>{title}</span>
      {/* 4.5:1 on the pill's glass, as the tab bar's words are. */}
      {detail && <span className={cn("-mt-1.5 w-full truncate text-center text-foreground/65 tabular-nums", TEXT.note)}>{detail}</span>}
    </button>
  );
}

/**
 * One of a pill's labelled rows, the redesign's pattern at the owner's ask
 * ("make the minimal layout this big, and then design all the tabs"): a
 * title over its strip of tiles -- Saved, Favorites, Recents, Nearest --
 * and anything that acts on the row at its right (`right`: what the strip
 * shows, Aircraft's Map switch).
 */
export function PillSection({ title, onMore, beside, right, children, testId }: {
  title: string;
  /** The list in full, the title the way to it, in the tint with its
   *  chevron -- every section's alike, the tabs' Saved, Favorites and
   *  Recents as the cards' are -- at the owner's ask ("make saved,
   *  favorites and recents into links, when clicked shows what See All
   *  does"), where the tabs' had a See All at the row's right. */
  onMore?: () => void;
  /** Beside the title: what the strip is of, to change there (Aircraft's
   *  airport asked of). */
  beside?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  // The full card's Favorites' size, which the owner liked ("I liked the
  // font style of Favorites from the full card earlier"), the title's 17
  // -- not bold, not capitals ("Section labels don't need to be bold or
  // all caps") -- in the text's own colour, or the tint where it opens
  // more ("for clickable sections you can make them blue").
  const heading = cn("font-medium text-foreground", TEXT.title);
  return (
    // Eight under the title, so its 44-point hit area (index.css) stays
    // its own over the tiles' (the iOS audit's P1).
    <section className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <div className="flex min-h-7 items-center gap-2">
        {onMore ? (
          <button
            type="button" onClick={onMore} data-testid={testId && `${testId}-more`}
            className={cn("relative flex items-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-2", heading, "text-tint")}
          >
            {title}
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        ) : <h3 className={heading}>{title}</h3>}
        {beside}
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** A list in full's head, every list's: Back to the section it came from,
 *  its name, and what acts on the whole list at its right (Edit, Clear).
 *  Its Back is a device's Back too (lib/openCards, lib/back), as a card's
 *  close is: Android's Back put the sheet down and left the list open. */
export function ListPageHead({ title, backLabel, onBack, action, testId }: {
  title: string;
  /** Back's name to a screen reader: where it goes. */
  backLabel: string;
  onBack: () => void;
  action?: ReactNode;
  testId?: string;
}) {
  const back = useRef(onBack);
  useEffect(() => { back.current = onBack; });
  useEffect(() => holdOpenCard({ close: () => back.current(), inBar: false }), []);
  return (
    <div className="flex items-center gap-1" data-testid={testId}>
      <IconButton label={backLabel} onClick={onBack} className="-ml-2" data-testid={testId && `${testId}-back`}>
        <ChevronLeft className="size-5" />
      </IconButton>
      <h3 className={cn("flex-1 font-bold", TEXT.title)}>{title}</h3>
      {action}
    </div>
  );
}

/**
 * A tab's one strip, the list it shows picked from the filter menu at its
 * heading's right, at the owner's asks ("for aircraft we can have the
 * selection and show map controls to the right"; "apply the filter to
 * other cards too so for example saved and recents in fpl can be filtered
 * or favorites and recents in airport/aircraft"): FPL's Saved and Recents,
 * Airport's Favorites, Recents and Nearest, Aircraft's Favorites, Recents
 * and its questions. The title names the list shown and is the way to it
 * in full, as every section's is.
 */
export function StripSection<V extends string>({ lists, shows, onShow, menuTestId, menuClassName, beside, right, children }: {
  /** What it can show, in the menu's order, the first the one at first. */
  lists: StripList<V>[];
  shows: V;
  onShow: (value: V) => void;
  menuTestId?: string;
  menuClassName?: string;
  beside?: ReactNode;
  /** After the menu, at the row's right (Aircraft's Map switch). */
  right?: ReactNode;
  children: ReactNode;
}) {
  const list = lists.find(l => l.value === shows) ?? lists[0]!;
  return (
    <PillSection
      title={list.label} onMore={list.onMore} beside={beside} testId={list.section}
      right={(
        <>
          <PillMenu
            label={`Showing ${list.label}`} value={list.value} onChange={onShow} testId={menuTestId} className={menuClassName}
            options={lists.map(l => ({ value: l.value, label: l.item ?? l.label, testId: l.testId, apart: l.apart }))}
          />
          {right}
        </>
      )}
    >
      {children}
    </PillSection>
  );
}

/** One of the lists a strip can show (StripSection): its name -- the
 *  heading's title and its item in the menu -- and the way to it in full. */
export interface StripList<V extends string> {
  value: V;
  label: string;
  /** Its item in the menu, where that says more ("Inbound…"). */
  item?: string;
  /** A line after it in the menu. */
  apart?: boolean;
  /** The list in full, the title the way to it. */
  onMore?: () => void;
  /** The section's test id while it shows this list. */
  section?: string;
  /** Its item's in the menu. */
  testId?: string;
}

/** What a strip shows, a menu behind iOS's filter glyph at its heading's
 *  right, as Mail's filter is, a line after any item `apart` says so
 *  (StripSection). */
export function PillMenu<V extends string>({ label, value, options, onChange, testId, className }: {
  /** Its name, to a screen reader and a long press: what it shows now. */
  label: string;
  value: V;
  options: { value: V; label: string; testId?: string; apart?: boolean }[];
  onChange: (value: V) => void;
  testId?: string;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* The app's one icon-only button, 36 with a 20 glyph (the iOS
            audit's P18), the heading's height kept round it. */}
        <IconButton label={label} className="-my-2 text-tint" data-testid={testId}>
          <ListFilter className="size-5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn("min-w-44", className)}>
        <DropdownMenuRadioGroup value={value} onValueChange={v => onChange(v as V)}>
          {options.map(o => (
            <Fragment key={o.value}>
              <DropdownMenuRadioItem value={o.value} data-testid={o.testId}>{o.label}</DropdownMenuRadioItem>
              {o.apart && <DropdownMenuSeparator />}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A word in place of a strip's tiles -- none yet, sign in, pick an
 *  airport -- where the tiles start, in their second line's grey: one
 *  look for every strip's, where each had its own (centred or not). */
export function StripNote({ children, status = false }: { children: ReactNode; status?: boolean }) {
  return <p className={cn("py-1 text-foreground/65", TEXT.note)} role={status ? "status" : undefined}>{children}</p>;
}

/** A pill's row of small tiles, along it, sliding sideways where more
 *  than fit. */
export function PillStrip({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 [scrollbar-width:none]" data-testid={testId}>{children}</div>
  );
}

/** A strip's tile's round mark, the Favorites tile's size (PlaceTile). */
export function SmallMark({ icon, className, style }: { icon: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={cn("grid size-14 place-items-center rounded-full [&_svg]:size-6", className)} style={style} aria-hidden="true">{icon}</span>;
}

/** An airport's own chart symbol, small, as the map draws it
 *  (lib/map/airportMark): its airspace's ring and colour, its METAR's
 *  dot, a military or private field's letter -- one mark for the pills'
 *  airports, Favorites' as Nearest's, at the owner's ask ("Airports should
 *  have the same symbols as nearest"). */
export function ChartMark({ space, category, use, size = 22 }: {
  space: AirspaceClass | null;
  category: string | null | undefined;
  use: "military" | "private" | null;
  /** Its width in points: the pills' 22, a list row's 26 (Nearest's). */
  size?: number;
}) {
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center" style={{ width: Math.max(28, size), height: Math.max(28, size) }}>
      <span className="block" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: airportMarkSvg(space, colourOf(category), use, "block size-full overflow-visible") }} />
    </span>
  );
}

/** A kept airport's chart symbol (ChartMark), from the field as the
 *  planner has it -- the query useAirspace asks, so none more -- its
 *  weather and whose it is with its airspace. */
function KeptChartMark({ airport, size }: { airport: RecentAirport; size?: number }) {
  const { data } = useQuery(airportQuery(airport.ident));
  const use = data?.military === "military" ? "military" : data?.private ? "private" : null;
  return <ChartMark space={data?.airspace_class ?? airport.airspace ?? null} category={data?.metar?.flight_category} use={use} size={size} />;
}

/** A kept airport -- a Favorite, a Recent -- as a pill's small tile: its
 *  chart symbol, its ident and `detail`, opening its card. */
export function SmallAirportTile({ airport, detail, onClick, testId = "pill-favorite" }: {
  airport: RecentAirport;
  detail: string;
  onClick: () => void;
  testId?: string;
}) {
  const space = useAirspace(airport);
  return (
    <SmallTile
      // The chart's mark the whole tile, no grey round it, at the owner's
      // ask ("make fav airport icons fill the grey space around it").
      mark={<SmallMark icon={<KeptChartMark airport={airport} size={56} />} className="[&_svg]:size-14" />}
      title={airport.ident} detail={detail} label={`${airport.ident}, ${space.name}`} onClick={onClick} testId={testId}
    />
  );
}

/** The Airport tab's pill: Home and the Favorites, small, each opening
 *  its field's card, how far each is from own ship under it. */
export function FavoriteStrip({ home, favorites, onOpen, onAddHome, onAddFavorite }: {
  home: RecentAirport | null;
  favorites: RecentAirport[];
  onOpen: (airport: RecentAirport) => void;
  /** Home's Add, where none is kept yet: listed all the same, as the
   *  search's Favorites list it (FavoriteTiles). */
  onAddHome: () => void;
  /** The Favorites' Add, at the strip's end, as the full card's. */
  onAddFavorite: () => void;
}) {
  const away = useAway();
  return (
    <PillStrip testId="pill-favorites">
      <SmallTile
        mark={<SmallMark icon={<House />} className="bg-teal-600 text-white" />} title="Home"
        detail={home ? away(home) ?? home.ident : "Add"} label={home ? `Home, ${home.ident}` : "Add Home"}
        onClick={home ? () => onOpen(home) : onAddHome} testId="pill-home"
      />
      {favorites.map(a => <SmallAirportTile key={a.ident} airport={a} detail={away(a) ?? ""} onClick={() => onOpen(a)} />)}
      <SmallTile
        mark={<SmallMark icon={<Plus />} className="bg-foreground/8 text-tint" />} title="Add" label="Add a Favorite"
        onClick={onAddFavorite} testId="pill-favorite-add"
      />
    </PillStrip>
  );
}

/**
 * The pilot's own airplane's glyph: lucide's airplane, as the map's
 * Traffic shows one, a little smaller, with a solid house at its bottom
 * right cut into its wing -- the owner's pick of a sheet of designs ("D
 * but add a home to the bottom right of it"), for the Plane tile that is
 * to airplanes what Home is to airports. Sized by its container's svg
 * rule, as a lucide glyph is; the cut a mask, so it shows whatever the
 * glyph sits on.
 */
export function HomePlane() {
  const cut = useId();
  const house = "M14.5 22.5v-4.2l3.75-3.2 3.75 3.2v4.2z";
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <mask id={cut}>
        <rect width="24" height="24" fill="#fff" />
        <path d={house} fill="#000" stroke="#000" strokeWidth={3.4} />
      </mask>
      {/* lucide's plane, at 0.85 with its stroke kept at 2. */}
      <g mask={`url(#${cut})`}>
        <path
          d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"
          transform="scale(0.85)" strokeWidth={2.35}
        />
      </g>
      <path d={house} fill="currentColor" strokeWidth={1} />
    </svg>
  );
}
