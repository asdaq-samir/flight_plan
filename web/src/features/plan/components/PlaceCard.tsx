import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { CloudSun, Lightbulb, MapPinPlus, Navigation, Radio, Star, X } from "lucide-react";
import { cn } from "cn";
import { usePreferences } from "../../../lib/preferences";
import IconButton from "../../../components/IconButton";
import { PanelHalfContext } from "../../../components/mapChrome";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api/client";
import type { AirportPin, AirportPlace, ClassBAirport } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { bearingDeg, distanceNm, type LatLon } from "../../../lib/geo";
import { chipColourOf } from "../../../lib/map/flightCategory";
import { feet, miles } from "../../../lib/units";
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
 *  draws its own. The first is filled; the rest are the tint on grey. */
function Action({ icon, label, filled, onClick, testId }: { icon: ReactNode; label: string; filled?: boolean; onClick: () => void; testId: string }) {
  return (
    <Button
      type="button" variant={filled ? "default" : "secondary"} onClick={onClick} data-testid={testId}
      className="h-auto flex-col gap-1 rounded-[10px] py-2 [&_svg:not([class*='size-'])]:size-5"
    >
      {icon}
      <span className={cn("font-semibold", TEXT.note)}>{label}</span>
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
export default function PlaceCard({ ident, from, onClose, onFlyHere, onAddStop, onExpand }: {
  ident: string;
  /** What the distance is measured from: own ship, or the departure. */
  from: { point: LatLon; name: string | null } | null;
  onClose: () => void;
  onFlyHere: (place: AirportPlace) => void;
  /** With a route open, the field landed at on the way: Add Stop. */
  onAddStop?: (place: AirportPlace) => void;
  /** The panel all the way up, for a section scrolled to. */
  onExpand: () => void;
}) {
  const { data: place, isLoading, isError } = useQuery({
    queryKey: ["airport", ident], queryFn: () => api.airport(ident), staleTime: 5 * 60_000,
  });
  // What the map knows of it already -- its name and its weather's
  // colour, from the chip that was tapped (AirportsLayer, ClassBLayer) --
  // at once: the card read "Looking the airport up…" until its own
  // answer came, a second or more on a phone while the chart's tiles
  // loaded.
  const known = knownOf(useQueryClient(), ident);
  // The name and the actions whole at the panel's half height, however
  // many lines the name and the line under it take (PanelHalfContext):
  // measured from the card's top, its own padding with it, and a
  // little under the actions so they do not sit on the panel's edge.
  const needs = useContext(PanelHalfContext);
  const [summary, setSummary] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!summary || !needs) return;
    const observer = new ResizeObserver(() => needs(summary.offsetTop + summary.offsetHeight + 16));
    observer.observe(summary);
    return () => { observer.disconnect(); needs(null); };
  }, [summary, needs]);
  const weatherRef = useRef<HTMLDivElement>(null);
  const radioRef = useRef<HTMLDivElement>(null);
  const show = (section: HTMLElement | null) => {
    onExpand();
    // After the panel has started up, so the section is scrolled to in
    // the room it will have.
    window.setTimeout(() => section?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };
  const metar = place?.metar ?? null;
  const weather = place
    ? { status: place.weather_unavailable ? "unavailable" : metar ? "reported" : "no-report", category: metar?.flight_category ?? null }
    : known && { status: known.category ? "reported" : "no-report", category: known.category };
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] print:hidden" data-testid="place-card">
      <div ref={setSummary}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.375rem] leading-7 font-bold tracking-tight text-foreground" data-testid="place-name">
              {place?.name ?? known?.name ?? ident}
            </h2>
            {/* A note's 13 in grey under the name, as the line under a
                place's name is in Maps: what it is, not text to read. */}
            <p className={cn("text-muted-foreground", TEXT.note)}>
              {place ? subtitleOf(place, from) : isError ? `${ident} · not found` : `${ident} · …`}
            </p>
          </div>
          {weather && (
            <span
              className="mt-1 shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tracking-wide text-white"
              style={{ backgroundColor: chipColourOf(weather) }}
              data-testid="place-category"
            >
              {weather.category ?? (place?.weather_unavailable ? "Unavailable" : "No report")}
            </span>
          )}
          {place && <FavoriteButton place={place} />}
          <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2" data-testid="place-close">
            <X className="size-5" />
          </IconButton>
        </div>
        {place && (
          <div className={cn("mt-3 grid gap-2", onAddStop ? "grid-cols-4" : "grid-cols-3")}>
            <Action icon={<Navigation />} label="Fly Here" filled onClick={() => onFlyHere(place)} testId="fly-here" />
            {onAddStop && <Action icon={<MapPinPlus />} label="Add Stop" onClick={() => onAddStop(place)} testId="place-add-stop" />}
            <Action icon={<CloudSun />} label="Weather" onClick={() => show(weatherRef.current)} testId="place-weather" />
            <Action icon={<Radio />} label="Frequencies" onClick={() => show(radioRef.current)} testId="place-frequencies" />
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
              {place.runways.map((r, i) => (
                <ListRow
                  key={`${r.ends}-${i}`}
                  title={`Runway ${r.ends ?? "—"}`}
                  description={[r.surface, r.lighted ? "lighted" : null].filter(Boolean).join(" · ") || undefined}
                  value={r.length_ft ? `${r.length_ft.toLocaleString()} × ${r.width_ft ?? "—"} ft` : "—"}
                />
              ))}
            </ListGroup>
          </div>
        </>
      )}
      {isLoading && !known && <p className={cn("pt-4 text-muted-foreground", TEXT.prose)}>Looking the airport up…</p>}
    </div>
  );
}

/** The star that adds an airport to Favorites (components/Favorites),
 *  filled while it is one, as Maps' are. */
function FavoriteButton({ place }: { place: AirportPlace }) {
  const kept = usePreferences(s => s.favoriteAirports.some(a => a.ident === place.ident));
  const toggle = usePreferences(s => s.toggleFavoriteAirport);
  return (
    <IconButton
      label={kept ? "Remove from Favorites" : "Add to Favorites"} aria-pressed={kept} className="-mt-1"
      onClick={() => toggle({ ident: place.ident, name: place.name, municipality: place.municipality, lat: place.lat, lon: place.lon })}
      data-testid="place-favorite"
    >
      <Star className={cn("size-5", kept && "fill-current")} />
    </IconButton>
  );
}
