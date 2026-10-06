import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CircleMinus, GripVertical, House, Plane, Plus } from "lucide-react";
import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "cn";
import { api } from "../lib/api/client";
import { distanceNm, type LatLon } from "../lib/geo";
import { usePreferences, type AirspaceClass, type RecentAirport } from "../lib/preferences";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import { ListGroup, ListRow } from "./GroupedList";
import IconButton from "./IconButton";

type Space = AirspaceClass;

/** The sectional's blue and magenta, a shade lighter so a glyph in them
 *  reads on the panel's dark material too. */
const BLUE = "#2465b8";
const MAGENTA = "#b02e7c";

/**
 * A field's airspace as the sectional draws it, on its tile: Class B a
 * solid blue line, C solid magenta, D dashed blue, an E surface area
 * dashed magenta, and G no line at all -- the field under the shaded
 * magenta edge of the Class E above it, here a ring of the same shading.
 * Solid as a fill, dashed as a dashed ring on a wash of the colour.
 */
const AIRSPACE: Record<Space, { name: string; style: CSSProperties }> = {
  B: { name: "Class B", style: { backgroundColor: BLUE, color: "#ffffff" } },
  C: { name: "Class C", style: { backgroundColor: MAGENTA, color: "#ffffff" } },
  D: { name: "Class D", style: { border: `2.5px dashed ${BLUE}`, backgroundColor: `${BLUE}1f`, color: BLUE } },
  E: { name: "Class E", style: { border: `2.5px dashed ${MAGENTA}`, backgroundColor: `${MAGENTA}1f`, color: MAGENTA } },
  G: { name: "Class G", style: { background: `radial-gradient(circle closest-side, ${MAGENTA}00 58%, ${MAGENTA}70 82%, ${MAGENTA}10 100%)`, color: MAGENTA } },
};

/** A kept airport's airspace class: the one remembered with it, so the
 *  tile is drawn right as the sheet opens, and its card's own answer,
 *  asked for once and kept a while. Until either is known, a plain grey
 *  tile: it was drawn as Class G, magenta, and turned blue a moment after
 *  every fresh load where the field was Class B or D. The answer is
 *  remembered with the airport for the next load. */
function useAirspace(airport: RecentAirport): { name: string; style?: CSSProperties; className?: string } {
  const { data } = useQuery({
    queryKey: ["airport", airport.ident], queryFn: () => api.airport(airport.ident), staleTime: 60 * 60_000, meta: { silent: true },
  });
  const answered = data?.airspace_class ?? undefined;
  useEffect(() => {
    if (answered && answered !== airport.airspace) usePreferences.getState().rememberAirspace(airport.ident, answered);
  }, [answered, airport.ident, airport.airspace]);
  const known = answered ?? airport.airspace;
  return known ? AIRSPACE[known] : { name: "Airport", className: "bg-foreground/8 text-muted-foreground" };
}

/**
 * Maps' Favorites, first under the search bar: Home, the airports kept (a
 * star on an airport's card adds one), and Add -- a row of round tiles
 * that scrolls sideways, each with how far it is from own ship when
 * that is known, else its town, a kept one drawn as the chart draws its
 * airspace. Home not set yet reads Add in the tint, and a tap on it asks
 * the search bar for the field. "Favorites ›" opens the list where
 * they are changed (FavoritesList).
 */
export function Favorites({ home, favorites, from, onOpen, onAddHome, onAddFavorite, onShowAll }: {
  home: RecentAirport | null;
  favorites: RecentAirport[];
  /** Own ship, when its position is known. */
  from: LatLon | null;
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
        home={home} favorites={favorites} from={from} onOpen={onOpen} onAddHome={onAddHome}
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
export function FavoriteTiles({ home, favorites, from, onOpen, onAddHome, trailing }: {
  home: RecentAirport | null;
  favorites: RecentAirport[];
  from: LatLon | null;
  onOpen: (airport: RecentAirport) => void;
  onAddHome?: () => void;
  trailing?: ReactNode;
}) {
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
  return (
    <PlaceTile
      icon={<Plane />} title={airport.ident} detail={detail} onClick={onClick}
      label={`${airport.ident}, ${space.name}`} style={space.style} className={space.className}
    />
  );
}

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
function Mark({ icon, className, style }: { icon: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={cn("grid size-8 place-items-center rounded-full [&_svg]:size-4", className)} style={style} aria-hidden="true">{icon}</span>;
}

function KeptMark({ airport }: { airport: RecentAirport }) {
  const space = useAirspace(airport);
  return <Mark icon={<Plane />} style={space.style} className={space.className} />;
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
