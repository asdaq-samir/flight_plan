import { useRef, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { CloudSun, Lightbulb, Radio, RouteIcon, Star } from "lucide-react";
import DirectToIcon from "../../../components/DirectToIcon";
import { cn } from "cn";
import { usePreferences } from "../../../lib/preferences";
import RoundButton from "../../../components/RoundButton";
import { FILLS_HALF, GLASS_BUTTON } from "../../../components/mapChrome";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Button } from "../../../components/ui/button";
import { ApiError, api } from "../../../lib/api/client";
import type { AirportPin, AirportPlace, ClassBAirport } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { bearingDeg, distanceNm, type LatLon } from "../../../lib/geo";
import { chipColourOf } from "../../../lib/map/flightCategory";
import { inkOn } from "../../../lib/scoreScale";
import { feet, miles } from "../../../lib/units";
import { RunwayRow } from "./RunwayRow";
import { PublicationRows } from "./PublicationRows";
import { TEXT } from "../../../lib/text";

/** "18 nm NE", from wherever the card is measured from. */
function away(from: LatLon, to: LatLon): string {
  const nm = distanceNm(from, to);
  return nm < 0.5 ? "here" : `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm ${compassPoint(bearingDeg(from, to))}`;
}

/** The line under the name: the ident, the airspace, the tower or its
 *  CTAF, and how far it is -- "KDLH · Class C · 18 nm NE". */
function subtitleOf(place: AirportPlace, from: { point: LatLon; name: string | null } | null): string {
  const ctaf = place.frequencies.find(f => f.type === "CTAF" || f.type === "UNIC");
  return [
    place.ident,
    // A field the armed services own (the FAA's airport file): one most
    // pilots may not land at without the service's permission, or a civil
    // airport sharing it.
    place.military === "military" ? "Military, permission required" : place.military === "joint" ? "Joint use" : null,
    place.airspace_class ? `Class ${place.airspace_class}` : null,
    place.towered ? "Towered" : ctaf?.frequency_mhz ? `CTAF ${ctaf.frequency_mhz.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}` : "Non-towered",
    from ? (from.name ? `${away(from.point, place)} of ${from.name}` : away(from.point, place)) : null,
  ].filter(Boolean).join(" · ");
}

/** An airport's name and weather from whatever the map has already
 *  asked for it in: the fields in view, the route's, the Class B ones. */
function knownOf(queryClient: QueryClient, ident: string): { name: string; category: string | null } | null {
  for (const key of ["airportsInView", "airportsReporting", "classB"]) {
    for (const [, pins] of queryClient.getQueriesData<(AirportPin | ClassBAirport)[]>({ queryKey: [key] })) {
      const hit = pins?.find(p => p.ident === ident);
      if (hit) return { name: hit.name, category: hit.flight_category ?? null };
    }
  }
  return null;
}

/** A tile of the card's action row: its glyph over its word, as Maps
 *  draws its own -- Fly Here filled in the tint, the rest panes of glass
 *  in the text's colour, as the gear and the route's close are, at the
 *  pilot's ask (they were the tint on grey). Maps' size, a 24-point glyph
 *  in a tile 70 tall: the card fills more of the panel's one half height. */
function Action({ icon, label, spoken, filled, onClick, testId }: {
  icon: ReactNode; label: string; filled?: boolean; onClick: () => void; testId: string;
  /** The whole word, where the tile shows it cut short. */
  spoken?: string;
}) {
  return (
    <Button
      type="button" variant={filled ? "default" : "secondary"} onClick={onClick} data-testid={testId} aria-label={spoken}
      className={cn("h-auto flex-col gap-1 rounded-xl py-3 whitespace-normal [&_svg:not([class*='size-'])]:size-6", !filled && GLASS_BUTTON)}
    >
      {icon}
      {/* On two lines where it needs them ("Add to / Route"), at the
          pilot's ask, rather than past the tile's edge. */}
      <span className={cn("text-center leading-tight font-semibold", TEXT.note)}>{label}</span>
    </Button>
  );
}

/**
 * An airport's card in the panel, as a place's is in Maps: its name and
 * what kind of field it is, the weather there now as the colour pilots
 * read it in, and three things to do -- fly there, the weather, the
 * radio, and with a route open a fourth, land there on the way -- over
 * the details: the report itself, the frequencies, the
 * runways. Opened by a tap on the airport on the chart (AirportsLayer),
 * and held in the address (`?place=KDLH`), so a link lands on it.
 *
 * How far it is is from the pilot's own position when it is known, and
 * from the route's departure otherwise.
 */
export default function PlaceCard({ ident, from, onClose, onFlyHere, onAddToRoute, onExpand }: {
  ident: string;
  /** What the distance is measured from: own ship, or the departure. */
  from: { point: LatLon; name: string | null } | null;
  onClose: () => void;
  onFlyHere: (place: AirportPlace) => void;
  /** With a route open, the field landed at on the way: Add Stop. */
  /** The field on to the end of the route, the new destination (or the
   *  first of a new one); none where it is the destination already. */
  onAddToRoute?: (place: AirportPlace) => void;
  /** The panel all the way up, for a section scrolled to. */
  onExpand: () => void;
}) {
  const { data: place, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["airport", ident], queryFn: () => api.airport(ident), staleTime: 5 * 60_000,
  });
  // What the map knows of it already -- its name and its weather's
  // colour, from the chip that was tapped (AirportsLayer, ClassBLayer) --
  // at once: the card read "Looking the airport up…" until its own
  // answer came, a second or more on a phone while the chart's tiles
  // loaded.
  const known = knownOf(useQueryClient(), ident);
  const weatherRef = useRef<HTMLDivElement>(null);
  const radioRef = useRef<HTMLDivElement>(null);
  const show = (section: HTMLElement | null) => {
    // From half, once the panel is up and the name and actions have
    // closed up to their own height (below), so the section is scrolled
    // to where it ends up; all the way up already, after a frame.
    const up = section?.closest("[data-panel]")?.getAttribute("data-panel") === "full";
    onExpand();
    window.setTimeout(() => section?.scrollIntoView({ block: "start", behavior: "smooth" }), up ? 50 : 520);
  };
  const metar = place?.metar ?? null;
  const weather = place
    ? { status: place.weather_unavailable ? "unavailable" : metar ? "reported" : "no-report", category: metar?.flight_category ?? null }
    : known && { status: known.category ? "reported" : "no-report", category: known.category };
  return (
    <PanelCard testId="place-card">
      {/* The name and the actions the panel's half, less the card's own
          top: the weather starts under it, out of sight there (FILLS_HALF). */}
      <div className={cn("min-h-[calc(var(--half-body,0px)_-_var(--corner-inset,0.75rem))]", FILLS_HALF)}>
        <CardHead
          name={place?.name ?? known?.name ?? ident} nameTestId="place-name"
          // Not found only where the planner said so: a planner out of
          // reach for a moment (restarted) read "not found" for KBUR.
          line={place ? subtitleOf(place, from)
            : error ? `${ident} · ${error instanceof ApiError && error.status === 404 ? "not found" : "could not be looked up"}`
              : `${ident} · …`}
          onClose={onClose} closeTestId="place-close"
        >
          {weather && (
            <span
              // The words in whichever ink reads on the colour (inkOn), as
              // the map's chips are: white on a field's no-report grey was
              // 2.6:1.
              className="mt-1 shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tracking-wide"
              style={{ backgroundColor: chipColourOf(weather), color: inkOn(chipColourOf(weather)) }}
              data-testid="place-category"
            >
              {weather.category ?? (place?.weather_unavailable ? "Unavailable" : "No report")}
            </span>
          )}
          {place && <FavoriteButton place={place} />}
        </CardHead>
        {place && (
          <div className={cn("mt-3 grid gap-2", onAddToRoute ? "grid-cols-4" : "grid-cols-3")}>
            {/* Fly Here is the Direct-To, and wears its symbol; Add to
                Route beside it, at the pilot's ask, puts the field on the
                end of the route. */}
            <Action icon={<DirectToIcon />} label="Fly Here" filled onClick={() => onFlyHere(place)} testId="fly-here" />
            {onAddToRoute && <Action icon={<RouteIcon />} label="Add to Route" onClick={() => onAddToRoute(place)} testId="place-add-to-route" />}
            <Action icon={<CloudSun />} label="Weather" onClick={() => show(weatherRef.current)} testId="place-weather" />
            {/* "Freq." on the tile, at the pilot's ask: the whole word ran
                past a quarter of a phone's card with Add Stop beside it. */}
            <Action icon={<Radio />} label="Freq." spoken="Frequencies" onClick={() => show(radioRef.current)} testId="place-frequencies" />
          </div>
        )}
      </div>

      {place && (
        <>
          <div ref={weatherRef} className="scroll-mt-3 pt-5">
            <ListGroup title="Weather">
              {metar ? (
                <>
                  <ListRow title="Ceiling" value={metar.ceiling_ft == null ? "none" : feet(metar.ceiling_ft)} />
                  <ListRow title="Visibility" value={miles(metar.visibility_sm)} />
                  {metar.wind_speed_kt != null && (
                    <ListRow
                      title="Wind"
                      value={metar.wind_speed_kt === 0 ? "calm" : `${metar.wind_dir_true_deg == null ? "variable" : `${String(Math.round(metar.wind_dir_true_deg)).padStart(3, "0")}°`} at ${Math.round(metar.wind_speed_kt)} kt`}
                    />
                  )}
                  <ListRow title={<span className="font-mono break-words">{metar.raw}</span>} />
                </>
              ) : (
                <ListRow title={place.weather_unavailable ? "The weather service could not be reached" : "No weather station reports from this field"} />
              )}
            </ListGroup>
          </div>

          <div ref={radioRef} className="scroll-mt-3 pt-5">
            <ListGroup title="Frequencies">
              {place.frequencies.length ? place.frequencies.map((f, i) => (
                <ListRow
                  key={`${f.type}-${f.frequency_mhz}-${i}`}
                  title={f.type ?? "Frequency"} description={f.description ?? undefined}
                  value={f.frequency_mhz != null ? f.frequency_mhz.toFixed(3) : "—"}
                />
              )) : <ListRow title="None listed" />}
              {/* What some fields read out on so many clicks of the mic on
                  the CTAF: the weather, a radio check (vfr.remarks). */}
              {place.radio_notes.map(note => (
                <ListRow key={note} media={<Radio className="size-5 text-muted-foreground" />} title={note} />
              ))}
            </ListGroup>
          </div>

          {place.lighting.length > 0 && (
            // The field's lights, from its Chart Supplement remarks: the
            // ones a pilot turns on from the cockpit by keying the mic,
            // and with no count of clicks of their own, the standard one.
            <div className="pt-5">
              <ListGroup
                title="Lights"
                footer={place.standard_keying
                  ? "Key the mic on the frequency 7 times within 5 seconds for high intensity, 5 for medium, 3 for low."
                  : undefined}
              >
                {place.lighting.map(note => (
                  <ListRow key={note} media={<Lightbulb className="size-5 text-muted-foreground" />} title={note} data-testid="place-lighting" />
                ))}
              </ListGroup>
            </div>
          )}

          <div className="pt-5">
            <ListGroup title="Field">
              <ListRow title="Elevation" value={feet(place.elevation_ft)} />
              {place.pattern?.altitude_ft != null && (
                <ListRow
                  title="Pattern altitude"
                  description={place.pattern.published ? "As the FAA publishes it" : "1,000 ft above the field: none published"}
                  value={feet(place.pattern.altitude_ft)} data-testid="place-pattern"
                />
              )}
              {place.runways.map((r, i) => <RunwayRow key={`${r.ends}-${i}`} runway={r} />)}
            </ListGroup>
          </div>

          {(place.airport_diagram_url || place.chart_supplement_url) && (
            <div className="pt-5">
              <ListGroup title="FAA">
                <PublicationRows diagram={place.airport_diagram_url} supplement={place.chart_supplement_url} />
              </ListGroup>
            </div>
          )}
        </>
      )}
      {isLoading && !known && <p className={cn("pt-4 text-muted-foreground", TEXT.prose)}>Looking the airport up…</p>}
      {/* Where the planner could not be reached, the way to ask again, in
          the card that could not be had (lib/problems: errors where they
          happen); an airport not found has nothing to ask again. */}
      {error && !place && !(error instanceof ApiError && error.status === 404) && (
        <div className="pt-4">
          <ListGroup>
            <ListRow
              title={<span className="text-tint">{isFetching ? "Trying again…" : "Try again"}</span>}
              onClick={isFetching ? undefined : () => void refetch()} data-testid="place-retry"
            />
          </ListGroup>
        </div>
      )}
    </PanelCard>
  );
}

/** The star that adds an airport to Favorites (components/Favorites),
 *  filled while it is one, as Maps' are. */
function FavoriteButton({ place }: { place: AirportPlace }) {
  const kept = usePreferences(s => s.favoriteAirports.some(a => a.ident === place.ident));
  const toggle = usePreferences(s => s.toggleFavoriteAirport);
  return (
    // A round pane of glass, as the gear is; the star filled in the tint
    // while the airport is a favorite.
    <RoundButton
      label={kept ? "Remove from Favorites" : "Add to Favorites"} aria-pressed={kept}
      className={cn(kept && "text-tint hover:text-tint")}
      onClick={() => toggle({ ident: place.ident, name: place.name, municipality: place.municipality, lat: place.lat, lon: place.lon })}
      data-testid="place-favorite"
    >
      <Star className={cn("size-5", kept && "fill-current")} strokeWidth={2} />
    </RoundButton>
  );
}
