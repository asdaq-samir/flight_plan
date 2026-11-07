import { ChevronRight, CircleMinus, House, ListFilter, Plane, Plus } from "lucide-react";
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AircraftKind } from "../lib/aircraftKind";
import { cn } from "cn";
import { airportMarkSvg } from "../lib/map/airportMark";
import { colourOf } from "../lib/map/flightCategory";
import type { AirspaceClass, RecentAirport } from "../lib/preferences";
import { useAirspace } from "../lib/useAirspace";
import { holdOpenCard } from "../lib/openCards";
import { useSwipeRow } from "./swipeRow";
import { useAway } from "../lib/useAway";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import PullDown from "./PullDown";
import IconButton from "./IconButton";
import CloseButton from "./CloseButton";
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
  const away = useAway();
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
/** A strip's tile: its round mark over its name, a detail under it --
 *  Favorites' places. */
export function PlaceTile({ icon, className, style, title, label, detail, tinted, onClick, disabled, testId }: {
  icon: ReactNode;
  className?: string;
  style?: CSSProperties;
  title: string;
  /** What a screen reader hears, where the tile's look says more than its words. */
  label?: string;
  detail?: string;
  tinted?: boolean;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId} aria-label={label} disabled={disabled}
      className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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

/** A kept airport's mark in a list's row: its chart symbol, as Favorites'
 *  and Nearest's rows draw it. */
export function KeptMark({ airport }: { airport: RecentAirport }) {
  return <KeptChartMark airport={airport} size={26} />;
}

/** An airplane's mark, in a row (`small`, the Mark's 32) or a strip's tile
 *  (SmallMark's 56): the Favorites' sky disc with a white airplane, turned
 *  to its track where it is heard, red in an emergency -- one mark for
 *  every list of airplanes, where the heard ones were a grey disc with a
 *  sky airplane and Recents and the found ones a bare grey airplane (the
 *  owner, 2026-10-28: "How come nearest airports and aircraft icons look
 *  different than favorites"). */
export function PlaneMark({ trackDeg, emergency = false, small = false, kind }: {
  trackDeg?: number | null;
  emergency?: boolean;
  small?: boolean;
  /** A kept airplane's shape (lib/aircraftKind), nose up; the ones heard,
   *  turned to their track, keep lucide's airplane as the map's traffic
   *  does (the owner: "Keep traffic as is", 2026-11-04). */
  kind?: AircraftKind;
}) {
  const fill = emergency ? "bg-destructive text-white" : "bg-sky-600 text-white";
  if (kind) {
    // The shapes fill their square, so drawn larger than a glyph: 34 in
    // the tile's 56, 22 in the row's 32.
    const icon = <KindGlyph kind={kind} />;
    return small
      ? <Mark icon={icon} className={cn(fill, "[&_svg]:size-[22px]")} />
      : <SmallMark icon={icon} className={cn(fill, "[&_svg]:size-[34px]")} />;
  }
  // lucide's airplane points north-east: turned to its track.
  const icon = <Plane fill="currentColor" style={trackDeg != null ? { transform: `rotate(${trackDeg - 45}deg)` } : undefined} />;
  return small ? <Mark icon={icon} className={fill} /> : <SmallMark icon={icon} className={fill} />;
}

/** An airplane's shape alone, sized by its container's svg rule. */
export function KindGlyph({ kind }: { kind: AircraftKind }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <KindShapes kind={kind} strokeWidth={1.5} />
    </svg>
  );
}

/**
 * The seven shapes, seen from above, nose up, on a 64 square, from the
 * owner's sheet of designs (2026-11-04): high wing, low wing (tapered,
 * its canopy cut out), twin, jet, helicopter, glider, and a balloon from
 * the side, as from above it would be a disc. In currentColor, outlined
 * a little so they hold at a row's size.
 */
function KindShapes({ kind, strokeWidth }: { kind: AircraftKind; strokeWidth: number }) {
  const cut = useId();
  const paint = { fill: "currentColor", stroke: "currentColor", strokeWidth, strokeLinejoin: "round" as const };
  switch (kind) {
    case "high":
      return (
        <g {...paint}>
          <path d="M32 12C34.2 12 35 14.5 35 18L34.2 44 33 51H31L29.8 44 29 18C29 14.5 29.8 12 32 12Z" />
          <rect x="9" y="23" width="46" height="6.5" rx="3" />
          <rect x="23" y="45" width="18" height="4.5" rx="2.2" />
        </g>
      );
    case "low":
      return (
        <>
          <mask id={cut}><rect width="64" height="64" fill="#fff" /><ellipse cx="32" cy="20.5" rx="1.9" ry="3.6" fill="#000" /></mask>
          <g {...paint} mask={`url(#${cut})`}>
            <path d="M32 12C34.2 12 35 14.5 35 18L34.2 44 33 51H31L29.8 44 29 18C29 14.5 29.8 12 32 12Z" />
            <path d="M30 26 9.5 28C8 28.2 7.5 29 7.5 30.2S8 32.2 9.5 32.2L30 34.5Z" />
            <path d="M34 26 54.5 28C56 28.2 56.5 29 56.5 30.2S56 32.2 54.5 32.2L34 34.5Z" />
            <rect x="24" y="46" width="16" height="4.5" rx="2.2" />
          </g>
        </>
      );
    case "twin":
      return (
        <>
          <mask id={cut}><rect width="64" height="64" fill="#fff" /><ellipse cx="32" cy="19" rx="1.9" ry="3.4" fill="#000" /></mask>
          <g {...paint} mask={`url(#${cut})`}>
            <path d="M32 11C34.2 11 35 13.5 35 17L34.2 45 33 52H31L29.8 45 29 17C29 13.5 29.8 11 32 11Z" />
            <path d="M30 25 7.5 27.5C6 27.7 5.5 28.5 5.5 29.7S6 31.7 7.5 31.7L30 34Z" />
            <path d="M34 25 56.5 27.5C58 27.7 58.5 28.5 58.5 29.7S58 31.7 56.5 31.7L34 34Z" />
            <rect x="16" y="17.5" width="5.6" height="19" rx="2.8" />
            <rect x="42.4" y="17.5" width="5.6" height="19" rx="2.8" />
            <rect x="22.5" y="47" width="19" height="4.5" rx="2.2" />
          </g>
        </>
      );
    case "jet":
      return (
        <g {...paint}>
          <path d="M32 5C34.3 5 35.5 9 35.5 15V46L33 56H31L28.5 46V15C28.5 9 29.7 5 32 5Z" />
          <path d="M29 24 7 37V40.5L29 34Z" />
          <path d="M35 24 57 37V40.5L35 34Z" />
          <rect x="23" y="39" width="4.6" height="9.5" rx="2.2" />
          <rect x="36.4" y="39" width="4.6" height="9.5" rx="2.2" />
          <path d="M32 49 21 55.5V58L32 55.5 43 58V55.5Z" />
        </g>
      );
    case "helicopter":
      return (
        <g {...paint}>
          <ellipse cx="32" cy="29" rx="6.5" ry="9.5" />
          <rect x="30.8" y="35" width="2.4" height="21" rx="1.2" />
          <rect x="26.5" y="47" width="11" height="2.6" rx="1.3" />
          <rect x="33.2" y="51" width="5" height="2.2" rx="1.1" />
          <rect x="5" y="26.7" width="54" height="2.6" rx="1.3" transform="rotate(32 32 28)" />
          <rect x="5" y="26.7" width="54" height="2.6" rx="1.3" transform="rotate(-32 32 28)" />
        </g>
      );
    case "glider":
      return (
        <g {...paint}>
          <path d="M32 13C33.6 13 34.2 15.5 34.2 19L33.4 47 32.6 56H31.4L30.6 47 29.8 19C29.8 15.5 30.4 13 32 13Z" />
          <path d="M30.5 24 3.5 25.8C2.4 25.9 2 26.4 2 27.2S2.4 28.5 3.5 28.5L30.5 29.5Z" />
          <path d="M33.5 24 60.5 25.8C61.6 25.9 62 26.4 62 27.2S61.6 28.5 60.5 28.5L33.5 29.5Z" />
          <rect x="25.5" y="53" width="13" height="3.2" rx="1.6" />
        </g>
      );
    case "balloon":
      return (
        <>
          <mask id={cut}>
            <rect width="64" height="64" fill="#fff" />
            <path d="M32 8V46M24 10C21 20 23 36 28.5 46M40 10C43 20 41 36 35.5 46" fill="none" stroke="#000" strokeWidth={1.8} />
          </mask>
          <g {...paint}>
            <path d="M32 7C44 7 50.5 15 50.5 24.5 50.5 34 42 40 37.5 46.5H26.5C22 40 13.5 34 13.5 24.5 13.5 15 20 7 32 7Z" mask={`url(#${cut})`} />
            <path d="M27.5 47 29.5 51M36.5 47 34.5 51" fill="none" />
            <rect x="28.5" y="51" width="7" height="6" rx="1.2" />
          </g>
        </>
      );
  }
}

/** A field's chart symbol in a strip's tile: 44 in the tile's 56, as wide
 *  as Home's disc reads (FavoriteStrip's, at the owner's "Airport icons
 *  too big"), Nearest's as Favorites'. */
export function TileChartMark({ children }: { children: ReactNode }) {
  return <SmallMark icon={children} className="[&_svg]:size-11" />;
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

/** A list in full's head, every list's: its name, what acts on the whole
 *  list (Edit, Clear), and at its right the close, which goes back to the
 *  section it came from -- no Back on the left, at the owner's ask
 *  ("remove the back buttons, because close button should behave as the
 *  back button", 2026-10-22). It is a device's Back too (lib/openCards,
 *  lib/back), as a card's close is: Android's Back put the sheet down and
 *  left the list open. */
export function ListPageHead({ title, backLabel, onBack, action, testId }: {
  title: string;
  /** The close's name to a screen reader: where it goes back to. */
  backLabel: string;
  onBack: () => void;
  action?: ReactNode;
  testId?: string;
}) {
  const back = useRef(onBack);
  useEffect(() => { back.current = onBack; });
  useEffect(() => holdOpenCard({ close: () => back.current(), inBar: false }), []);
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <h3 className={cn("flex-1 font-bold", TEXT.title)}>{title}</h3>
      {action}
      <CloseButton label={backLabel} onClick={onBack} className="-mr-1" data-testid={testId && `${testId}-close`} />
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
export function StripSection<V extends string>({ lists, shows, onShow, menuTestId, menuClassName, menuTop, beside, right, children }: {
  /** What it can show, in the menu's order, the first the one at first. */
  lists: StripList<V>[];
  shows: V;
  onShow: (value: V) => void;
  menuTestId?: string;
  menuClassName?: string;
  /** At the menu's top, a line under it: Aircraft's Show on map, at the
   *  owner's ask ("Can the aircraft map toggle be part of the filter,
   *  maybe on top?", 2026-10-23). */
  menuTop?: ReactNode;
  beside?: ReactNode;
  /** After the menu, at the row's right. */
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
            label={`Showing ${list.label}`} value={list.value} onChange={onShow} testId={menuTestId} className={menuClassName} top={menuTop}
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
export function PillMenu<V extends string>({ label, value, options, onChange, testId, className, top }: {
  /** Its name, to a screen reader and a long press: what it shows now. */
  label: string;
  value: V;
  options: { value: V; label: string; testId?: string; apart?: boolean }[];
  onChange: (value: V) => void;
  testId?: string;
  className?: string;
  /** Before the choices, a line under it (StripSection's menuTop). */
  top?: ReactNode;
}) {
  return (
    <PullDown
      label={label} value={value} onChange={onChange} options={options} top={top}
      contentClassName={cn("min-w-44", className)}
      trigger={(
        // The app's one icon-only button, 36 with a 20 glyph (the iOS
        // audit's P18), the heading's height kept round it.
        <IconButton label={label} className="-my-2 text-tint" data-testid={testId}>
          <ListFilter className="size-5" />
        </IconButton>
      )}
    />
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
  // With no report of its own, the weather modelled at it, else a station's
  // within ten miles, as its card's chip and FPL's symbols have it.
  const category = data?.metar?.flight_category ?? data?.modelled_weather?.flight_category
    ?? (data?.nearby_metar?.near ? data.nearby_metar.metar.flight_category : null);
  return <ChartMark space={data?.airspace_class ?? airport.airspace ?? null} category={category} use={use} size={size} />;
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
      // The chart's mark on its own, no grey round it, at the owner's ask
      // ("make fav airport icons fill the grey space around it"), at 44 in
      // the tile's 56, as wide as Home's disc reads: at 56 its ticks ran
      // past the tile and it stood larger than Home and Add beside it (the
      // owner's "Airport icons too big").
      mark={<SmallMark icon={<KeptChartMark airport={airport} size={44} />} className="[&_svg]:size-11" />}
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
        detail={home ? away(home) : "Add"} label={home ? `Home, ${home.ident}` : "Add Home"}
        onClick={home ? () => onOpen(home) : onAddHome} testId="pill-home"
      />
      {favorites.map(a => <SmallAirportTile key={a.ident} airport={a} detail={away(a)} onClick={() => onOpen(a)} />)}
      <SmallTile
        mark={<SmallMark icon={<Plus />} className="bg-foreground/8 text-tint" />} title="Add" label="Add a Favorite"
        onClick={onAddFavorite} testId="pill-favorite-add"
      />
    </PillStrip>
  );
}

/**
 * The pilot's own airplane's glyph: the app icon in miniature, its
 * airplane seen from above in the dashed airspace ring -- the owner's
 * pick ("I like 3 for my plane", 2026-11-04, beside the icon's A), for
 * the Airplane tile that is to airplanes what Home is to airports; the
 * airplane in it the pilot's own one's shape (lib/aircraftKind). Drawn in
 * currentColor and sized by its container's svg rule, as a lucide glyph
 * is; the ring needs more room than a glyph, so its marks size it up
 * (PLANE_TILE, PLANE_ROW).
 */
export function HomePlane({ kind = "high" }: { kind?: AircraftKind }) {
  return (
    <svg viewBox="6 6 52 52" aria-hidden="true">
      {/* Twelve dashes, as the icon's ring: 2 pi 22 is 138.2, eleven and
          a half a dash. */}
      <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth={3.6} strokeDasharray="8 3.52" transform="rotate(-100.4 32 32)" />
      <g transform="translate(32 32) scale(0.6) translate(-32 -32)">
        <KindShapes kind={kind} strokeWidth={2} />
      </g>
    </svg>
  );
}

/** HomePlane's sizes: 40 in a strip tile's 56, 24 in a row's 32. */
export const PLANE_TILE = "bg-teal-600 text-white [&_svg]:size-10";
export const PLANE_ROW = "bg-teal-600 text-white [&_svg]:size-6";
