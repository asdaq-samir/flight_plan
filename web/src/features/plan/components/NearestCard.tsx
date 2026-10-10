import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LocateFixed, MapPin, Navigation2, X } from "lucide-react";
import { cn } from "cn";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { api } from "../../../lib/api/client";
import type { NearestAirport, PlaceFound } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { colourOf } from "../../../lib/map/flightCategory";
import { glideRangeNm } from "../../../lib/map/glide";
import { airportMarkSvg } from "../../../lib/map/airportMark";
import { positionNow, useOwnShip } from "../../../lib/map/ownShip";
import { nearestQuery } from "../../../lib/queryClient";
import { inkOn } from "../../../lib/scoreScale";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";

export interface NearFrom {
  label: string;
  lat: number;
  lon: number;
}

/** What is typed waits this long for the next letter before it is asked
 *  about: the Census geocoder is a request a word, not a letter. */
const TYPING_MS = 250;

/**
 * Where Nearest is from: the pilot's position until a place is typed --
 * a town, a street address, an airport -- at the pilot's ask, as Maps'
 * search asks where. The field reads "Current position" until then;
 * what answers comes up under it, and its clear goes back to the
 * position.
 */
function NearField({ from, onFrom }: { from: NearFrom | null; onFrom: (from: NearFrom | null) => void }) {
  const [typed, setTyped] = useState(from?.label ?? "");
  const [asked, setAsked] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const later = window.setTimeout(() => setAsked(typed.trim()), TYPING_MS);
    return () => window.clearTimeout(later);
  }, [typed]);
  const searching = asked.length >= 2 && asked !== from?.label && typed.trim() !== from?.label;
  const { data: answered, isFetching, isError } = useQuery({
    queryKey: ["places", asked], queryFn: () => api.placesSearch(asked), enabled: searching, staleTime: 60 * 60_000,
    meta: { silent: true },
  });
  // What answers belongs to what was asked, which trails what is typed by
  // TYPING_MS: until they meet, nothing is offered or picked, so Return
  // cannot take the first result of an earlier text.
  const current = typed.trim() === asked;
  const found = current ? answered : undefined;
  const pick = (place: PlaceFound | null) => {
    onFrom(place && { label: place.label, lat: place.lat, lon: place.lon });
    setTyped(place?.label ?? "");
    input.current?.blur();
  };
  return (
    <div className="pt-3">
      {/* The search bar's field (PanelCapsule's SearchField), a pin for
          the magnifier: where from, not what. */}
      <label className={cn("flex h-[2.5625rem] items-center gap-2 rounded-full bg-foreground/8 px-3.5 text-muted-foreground", TEXT.row)}>
        <MapPin className="size-5 shrink-0 text-foreground" strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={input} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          value={typed} onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && found?.[0]) pick(found[0]); }}
          placeholder="Current position" aria-label="Nearest to: a town, an address or an airport" data-testid="nearest-from"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {(typed || from) && (
          <button
            type="button" aria-label="Nearest to your position" data-testid="nearest-from-clear"
            onClick={() => pick(null)}
            className="relative grid size-5 shrink-0 place-items-center rounded-full bg-muted-foreground/50 text-background outline-none after:absolute after:-inset-3 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" strokeWidth={3} />
          </button>
        )}
      </label>
      {searching && (
        <div className="pt-3">
          <ListGroup>
            {(found ?? []).map(place => (
              <ListRow
                key={`${place.kind}-${place.label}`} media={<MapPin className="size-5 text-muted-foreground" />}
                title={place.label} description={place.kind === "airport" ? "Airport" : place.kind === "town" ? "Town" : "Address"}
                onClick={() => pick(place)} data-testid="nearest-from-option"
              />
            ))}
            {found && !found.length && !isFetching && (
              <ListRow title={<span className="text-muted-foreground">Nothing by that name</span>} />
            )}
            {current && isError && (
              <ListRow title={<span className={cn("text-destructive", TEXT.detail)}>Couldn't search. Try again.</span>} />
            )}
            {!found && !(current && isError) && <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)}>Looking…</span>} />}
            {from && (
              <ListRow
                media={<LocateFixed className="size-5 text-tint" />} title="Current position"
                onClick={() => pick(null)} data-testid="nearest-from-position"
              />
            )}
          </ListGroup>
        </div>
      )}
    </div>
  );
}

/** A frequency as pilots write it: 120.7, 122.95, 124.475. */
const mhz = (value: number) => value.toFixed(3).replace(/0{1,2}$/, "");

/** Faster than this over the ground, the airplane is going somewhere and
 *  its GPS track is steady enough to point the rows' arrows from. */
const MOVING_KT = 30;

/**
 * One field of Nearest's, at the pilot's ask for a list that reads as an
 * EFB's: the map's own mark for it (its airspace, its weather's dot), the
 * ident and the name, then its weather, longest runway and the frequency
 * listed for it; at the right how far, with an arrow the way to it -- from
 * the airplane's track when it is moving, north up otherwise -- and the
 * compass point. A row that opens the field's card, so its words are the
 * text's and it ends in a chevron, as iOS's do.
 */
const COMPASS_WORDS: Record<string, string> = {
  N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest",
};

function NearestRow({ field, ahead, reach, onOpen }: {
  field: NearestAirport;
  /** The airplane's track, true, when it is moving; else null. */
  ahead: number | null;
  /** Within a still-air glide. */
  reach: boolean;
  onOpen: () => void;
}) {
  const category = field.flight_category;
  const use = field.military === "military" ? "military" : field.private ? "private" : null;
  const parts = [
    field.longest_runway_ft ? `${altFt(field.longest_runway_ft)} ft` : null,
    field.radio ? `${field.radio.kind} ${mhz(field.radio.mhz)}` : null,
    // Listed whoever owns it, and said: in an emergency the pilot in
    // command lands where the emergency needs (14 CFR 91.3(b)), and a
    // military or a private field may be it.
    field.military === "military" ? "military" : field.military === "joint" ? "joint use" : field.private ? "private" : null,
  ].filter(Boolean);
  const point = compassPoint(field.bearing_deg);
  return (
    <ListRow
      media={<span className="block size-[26px]" dangerouslySetInnerHTML={{ __html: airportMarkSvg(field.airspace_class ?? null, colourOf(category), use, "overflow-visible") }} />}
      title={<span className="line-clamp-2"><span className="font-semibold">{field.ident}</span> {field.name}</span>}
      // One run of words, the weather's chip at its head, wrapping between
      // its parts and never inside one ("TWR 123.675" kept whole).
      description={
        <>
          {category && (
            <span
              className={cn("mr-1.5 inline-block rounded-[5px] px-1.5 align-[0.05em] font-bold tracking-wide", TEXT.note)}
              style={{ backgroundColor: colourOf(category), color: inkOn(colourOf(category)) }}
            >
              {category}
            </span>
          )}
          {parts.map((part, i) => (
            <span key={part}>{i > 0 && " · "}<span className="whitespace-nowrap">{part}</span></span>
          ))}
          {reach && <>{parts.length > 0 && " · "}<span className="font-semibold whitespace-nowrap text-green-700 dark:text-green-400">within glide</span></>}
        </>
      }
      chevron onClick={onOpen} data-testid="nearest-airport"
    >
      <span className="flex items-center gap-2">
        <Navigation2
          aria-hidden="true" strokeWidth={0} data-testid="nearest-arrow"
          className="size-5 shrink-0 fill-current text-foreground"
          style={{ transform: `rotate(${field.bearing_deg - (ahead ?? 0)}deg)` }}
        />
        {/* A label on a plain span has no role and is not spoken, so the
            spoken form is text in the row: VoiceOver would spell out "nm"
            and the compass letters. The bearing is true (the footer says so). */}
        <span className="flex flex-col items-end" aria-hidden="true">
          <span className={cn("font-semibold text-foreground tabular-nums", TEXT.row)}>{field.distance_nm} nm</span>
          <span className={cn("text-muted-foreground", TEXT.note)}>{point}</span>
        </span>
        <span className="sr-only">{field.distance_nm} nautical miles, true bearing {COMPASS_WORDS[point] ?? point}</span>
      </span>
    </ListRow>
  );
}

/**
 * Nearest, as an EFB's, a card in the panel at the pilot's ask -- half
 * way up with the map fitted to the fields above it (RouteMap's FitTo),
 * where it was a sheet of its own over the panel: the ten fields nearest
 * own ship, how far and which way, the longest runway, and -- in the
 * air, with the GPS's altitude -- which are within a still-air glide
 * (lib/map/glide), the ring the map draws round own ship. Or nearest a
 * place typed in its field (NearField), at the pilot's ask: a town, an
 * address, an airport. A tap on one opens its card over this one, and
 * its close comes back here. With no position yet, it offers to show it.
 */
export default function NearestCard({ onOpen, onClose, from, onFrom }: {
  onOpen: (ident: string) => void;
  onClose: () => void;
  /** The place typed, where it is from one (the page's, in its address). */
  from: NearFrom | null;
  onFrom: (from: NearFrom | null) => void;
}) {
  const enabled = useOwnShip(s => s.enabled);
  const setEnabled = useOwnShip(s => s.setEnabled);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const origin = from ?? fix;
  const { data } = useQuery({ ...nearestQuery(origin?.lat ?? 0, origin?.lon ?? 0), enabled: !!origin });
  // Asked for the nearest fields, the position is wanted: own ship turned
  // on quietly where the browser already lets it be read (positionNow),
  // as Fly Here does; else the card offers to show it.
  useEffect(() => {
    void positionNow(0);
  }, []);
  // A glide only from where the airplane is, with its altitude.
  const glide = !from && fix ? glideRangeNm(fix, data?.[0]?.elevation_ft) : null;
  // The arrows from the airplane's track, where it is moving and the list
  // is from where it is.
  const ahead = !from && fix?.headingDeg != null && (fix.speedKt ?? 0) >= MOVING_KT ? fix.headingDeg : null;
  return (
    <PanelCard testId="nearest-card">
      <CardHead
        name="Nearest Airports"
        line={from ? `Near ${from.label}` : !fix ? "From your position" : glide != null ? `Within a glide: about ${Math.round(glide)} nm` : "From your position now"}
        onClose={onClose} closeTestId="nearest-close"
      />
      <NearField from={from} onFrom={onFrom} />
      <div className="pt-4">
        {!origin ? (
          <ListGroup footer="The nearest fields are found from your position, which stays on this device, or from a place typed above.">
            {enabled
              ? <ListRow title={<span className="text-muted-foreground">Finding your position…</span>} />
              : <ListRow title="Show my position" onClick={() => setEnabled(true)} data-testid="nearest-show-position" />}
          </ListGroup>
        ) : (
          <ListGroup
            footer={[
              from
                ? `From ${from.label}. Clear the field for the nearest to your position.`
                : glide != null
                  ? `Within a still-air glide: about ${Math.round(glide)} nm from here, at 1.5 nm for every 1,000 ft over the nearest field -- the dashed ring.`
                  : "In the air, the ones within a glide are marked.",
              ahead != null ? "The arrows point the way from your track." : null,
              "Each field's longest runway and its listed tower, CTAF or UNICOM frequency. Check the Chart Supplement for the tower's hours. Bearings are true.",
            ].filter(Boolean).join(" ")}
          >
            {(data ?? []).map(a => (
              <NearestRow key={a.ident} field={a} ahead={ahead} reach={glide != null && a.distance_nm <= glide} onOpen={() => onOpen(a.ident)} />
            ))}
            {!data && <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)}>Looking…</span>} />}
          </ListGroup>
        )}
      </div>
    </PanelCard>
  );
}
