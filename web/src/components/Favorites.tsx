import { ChevronLeft, ChevronRight, CircleMinus, GripVertical, House, Plus } from "lucide-react";
import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { api } from "../lib/api/client";
import { distanceNm } from "../lib/geo";
import { airportMarkSvg } from "../lib/map/airportMark";
import { colourOf } from "../lib/map/flightCategory";
import { useOwnShip } from "../lib/map/ownShip";
import type { AirspaceClass, RecentAirport } from "../lib/preferences";
import { useAirspace } from "../lib/useAirspace";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import { ListGroup, ListRow } from "./GroupedList";
import IconButton from "./IconButton";

/**
 * Maps' Favorites, first under the search bar: Home, the airports kept (a
 * star on an airport's card adds one), and Add -- a row of round tiles
 * that scrolls sideways, each with how far it is from own ship when
 * that is known, else its town, a kept one drawn as the chart draws its
 * airspace. Home not set yet reads Add in the tint, and a tap on it asks
 * the search bar for the field. "Favorites ›" opens the list where
 * they are changed (FavoritesList).
 */
export function Favorites({ home, favorites, onOpen, onAddHome, onAddFavorite, onShowAll }: {
  home: RecentAirport | null;
  favorites: RecentAirport[];
  onOpen: (airport: RecentAirport) => void;
  onAddHome: () => void;
  onAddFavorite: () => void;
  onShowAll: () => void;
}) {
  return (
    <section aria-labelledby="favorites-heading">
      <h3 id="favorites-heading" className="pb-3">
        <button
          type="button" onClick={onShowAll} data-testid="favorites-all"
          className={cn("flex items-center gap-0.5 rounded-md px-1 font-bold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.title)}
        >
          Favorites <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
        </button>
      </h3>
      <FavoriteTiles
        home={home} favorites={favorites} onOpen={onOpen} onAddHome={onAddHome}
        trailing={<PlaceTile icon={<Plus />} className="bg-foreground/8 text-tint" title="Add" onClick={onAddFavorite} testId="favorite-add" />}
      />
    </section>
  );
}

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
  // Its chart symbol on the tile, as NRST's fields wear theirs, at the
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
export function PlaceTile({ icon, className, style, title, label, detail, tinted, onClick, testId }: {
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
function Mark({ icon, className, style }: { icon: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={cn("grid size-8 place-items-center rounded-full [&_svg]:size-4", className)} style={style} aria-hidden="true">{icon}</span>;
}

function KeptMark({ airport }: { airport: RecentAirport }) {
  return <KeptChartMark airport={airport} size={26} />;
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
  // A drag on a handle moves its row a place each time the finger passes
  // half a row, the list re-ordering under it as it goes.
  const drag = (index: number) => (start: ReactPointerEvent<HTMLButtonElement>) => {
    const handle = start.currentTarget;
    const row = handle.closest("[data-slot=item]") as HTMLElement | null;
    const height = row?.offsetHeight ?? 52;
    handle.setPointerCapture(start.pointerId);
    let at = index, anchor = start.clientY;
    const move = (event: PointerEvent) => {
      const dy = event.clientY - anchor;
      if (dy > height / 2 && at < favorites.length - 1) { onMove(at, at + 1); at += 1; anchor += height; }
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
  const minus = (label: string, onClick: () => void, testId?: string) => (
    <IconButton label={label} className="-ml-1.5 text-destructive" onClick={onClick} data-testid={testId}>
      <CircleMinus className="size-5 fill-destructive text-white dark:text-background" />
    </IconButton>
  );
  return (
    <div className="space-y-6" data-testid="favorites-list">
      <div className="flex items-center gap-1">
        <IconButton label="Back to the search" onClick={onBack} className="-ml-2" data-testid="favorites-back">
          <ChevronLeft className="size-5" />
        </IconButton>
        <h3 className={cn("flex-1 font-bold", TEXT.title)}>Favorites</h3>
        <Button
          type="button" variant="ghost" size="sm"
          className={cn("-mr-1 h-auto px-1 py-0.5 font-normal text-tint", TEXT.row, editing && "font-semibold")}
          onClick={() => setEditing(e => !e)} data-testid="favorites-edit"
        >
          {editing ? "Done" : "Edit"}
        </Button>
      </div>
      <ListGroup title="Home" footer={home && !editing ? "A tap changes it." : undefined}>
        {!home ? (
          <ListRow media={<Plus className="size-5" />} title="Add Home" onClick={onChangeHome} data-testid="favorites-home" />
        ) : editing ? (
          <ListRow
            media={minus(`Remove ${home.ident} as Home`, onRemoveHome, "favorites-home-remove")}
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
      </ListGroup>
      <ListGroup title="Airports" footer={favorites.length === 0 ? "A star on an airport's card adds it here." : editing ? "Drag a handle to order them." : undefined}>
        {favorites.map((a, index) => (editing ? (
          <ListRow
            key={a.ident} media={minus(`Remove ${a.ident} from Favorites`, () => onRemove(a))}
            title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
            description={a.municipality ?? undefined}
          >
            <IconButton
              label={`Move ${a.ident}`} className="touch-none" onPointerDown={drag(index)}
              onKeyDown={e => {
                if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); onMove(index, index - 1); }
                if (e.key === "ArrowDown" && index < favorites.length - 1) { e.preventDefault(); onMove(index, index + 1); }
              }}
            >
              <GripVertical className="size-5 text-muted-foreground" />
            </IconButton>
          </ListRow>
        ) : (
          <ListRow
            key={a.ident} media={<KeptMark airport={a} />} chevron
            title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
            description={a.municipality ?? undefined} onClick={() => onOpen(a)}
          />
        )))}
        <ListRow media={<Plus className="size-5" />} title="Add a Favorite" onClick={onAdd} data-testid="favorites-add" />
      </ListGroup>
    </div>
  );
}

/**
 * A small tile for a pill's strip (PillStrip): a round mark, a name and a
 * line under it, at the size the pill has room for -- at the owner's ask,
 * the Airport and Aircraft tabs' pills show their Favorites, NRST's its
 * nearest fields, as small icons. 44 points at the least to a finger.
 */
export function SmallTile({ mark, title, detail, label, onClick, testId }: {
  mark: ReactNode;
  title: string;
  detail?: string;
  label?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId} aria-label={label}
      className="flex min-h-11 w-14 shrink-0 flex-col items-center gap-0.5 rounded-lg py-0.5 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:active:bg-muted"
    >
      {mark}
      <span className={cn("w-full truncate text-center font-semibold leading-tight text-foreground", TEXT.note)}>{title}</span>
      {/* 4.5:1 on the pill's glass, as the tab bar's words are. */}
      {detail && <span className={cn("w-full truncate text-center leading-tight text-foreground/65 tabular-nums", TEXT.note)}>{detail}</span>}
    </button>
  );
}

/** A pill's row of small tiles, along it, sliding sideways where more
 *  than fit. */
export function PillStrip({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]" data-testid={testId}>{children}</div>
  );
}

/** A small tile's round mark: the Favorites tile's at a third of its size. */
export function SmallMark({ icon, className, style }: { icon: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={cn("grid size-7 place-items-center rounded-full [&_svg]:size-3.5", className)} style={style} aria-hidden="true">{icon}</span>;
}

/** An airport's own chart symbol, small, as the map draws it
 *  (lib/map/airportMark): its airspace's ring and colour, its METAR's
 *  dot, a military or private field's letter -- one mark for the pills'
 *  airports, Favorites' as NRST's, at the owner's ask ("Airports should
 *  have the same symbols as nearest"). */
export function ChartMark({ space, category, use, size = 22 }: {
  space: AirspaceClass | null;
  category: string | null | undefined;
  use: "military" | "private" | null;
  /** Its width in points: the pills' 22, a list row's 26 (NRST's). */
  size?: number;
}) {
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center" style={{ width: Math.max(28, size), height: Math.max(28, size) }}>
      <span className="block" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: airportMarkSvg(space, colourOf(category), use, "overflow-visible") }} />
    </span>
  );
}

/** A kept airport's chart symbol (ChartMark), from the field as the
 *  planner has it -- the query useAirspace asks, so none more -- its
 *  weather and whose it is with its airspace. */
function KeptChartMark({ airport, size }: { airport: RecentAirport; size?: number }) {
  const { data } = useQuery({
    queryKey: ["airport", airport.ident], queryFn: () => api.airport(airport.ident), staleTime: 60 * 60_000, meta: { silent: true },
  });
  const use = data?.military === "military" ? "military" : data?.private ? "private" : null;
  return <ChartMark space={data?.airspace_class ?? airport.airspace ?? null} category={data?.metar?.flight_category} use={use} size={size} />;
}

function SmallAirportTile({ airport, detail, onClick }: { airport: RecentAirport; detail: string; onClick: () => void }) {
  const space = useAirspace(airport);
  return (
    <SmallTile
      mark={<KeptChartMark airport={airport} />}
      title={airport.ident} detail={detail} label={`${airport.ident}, ${space.name}`} onClick={onClick} testId="pill-favorite"
    />
  );
}

/** The Airport tab's pill: Home and the Favorites, small, each opening
 *  its field's card, how far each is from own ship under it. */
export function FavoriteStrip({ home, favorites, onOpen, onAddHome }: {
  home: RecentAirport | null;
  favorites: RecentAirport[];
  onOpen: (airport: RecentAirport) => void;
  /** Home's Add, where none is kept yet: listed all the same, as the
   *  search's Favorites list it (FavoriteTiles). */
  onAddHome: () => void;
}) {
  const from = useOwnShip(o => (o.enabled ? o.fix : null));
  const away = (a: RecentAirport) =>
    from && a.lat !== undefined && a.lon !== undefined ? `${Math.round(distanceNm(from, { lat: a.lat, lon: a.lon }))} nm` : undefined;
  return (
    <PillStrip testId="pill-favorites">
      <SmallTile
        mark={<SmallMark icon={<House />} className="bg-teal-600 text-white" />} title="Home"
        detail={home ? away(home) ?? home.ident : "Add"} label={home ? `Home, ${home.ident}` : "Add Home"}
        onClick={home ? () => onOpen(home) : onAddHome} testId="pill-home"
      />
      {favorites.map(a => <SmallAirportTile key={a.ident} airport={a} detail={away(a) ?? ""} onClick={() => onOpen(a)} />)}
    </PillStrip>
  );
}
