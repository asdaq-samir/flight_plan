import L from "leaflet";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleMarker, Marker, Pane, useMap, useMapEvents } from "react-leaflet";
import { api } from "../api/client";
import { usePreferences } from "../preferences";
import type { AirportPin } from "../api/types";
import { colourOf } from "./flightCategory";
import { airportMarkIcon, selectionIcon } from "./icons";
import { MapTooltip } from "./MapTooltip";
import { boxOf, hovers } from "./view";

/** From this zoom in a sectional draws its airports big enough to aim a
 *  finger at; further out the targets would be a field of overlapping
 *  circles over half a state. */
const FROM_ZOOM = 8;

/** A zoom further out the fields that report wear their marks already,
 *  the rest nothing: the weather across a region at a glance, the chart
 *  under it still readable. */
const REPORTING_FROM_ZOOM = 7;

/** From this zoom the fields with no report wear a mark too, its dot in the
 *  grey of no report: the sectional's own scale, where they are a
 *  handful on the screen rather than every strip in half a state.
 *  Further out they keep an invisible target. */
const NO_REPORT_FROM_ZOOM = 10;

/** A finger's width round each airport symbol, 44 points across. */
const TARGET_RADIUS = 22;
/** How far off a field's mark a tap on the chart is still the field's:
 *  half a finger's 44 points. */
const NEAR_MISS_PX = 22;

// Each style one object for good: react-leaflet restyles a path whenever
// its pathOptions is a new object, and a literal is one at every render.
const TARGET_STYLE: L.PathOptions = { stroke: false, fill: true, fillOpacity: 0 };

/** One field on the chart, its mark or its invisible target, drawn again
 *  only when it changes (memo): react-leaflet moves a mark whose position
 *  is a new array, as a literal is at every render, and restyles one whose
 *  style is -- every field on the map was moved and restyled each time the
 *  page drew, 0.4 s of a phone's as the Brief first opened (measured at a
 *  quarter of a laptop's speed, 2026-10-07). */
const AirportMark = memo(function AirportMark({ airport: a, chip, onSelect }: {
  airport: AirportPin;
  chip: boolean;
  onSelect: (ident: string) => void;
}) {
  const events = { click: (e: L.LeafletMouseEvent) => { L.DomEvent.stopPropagation(e); onSelect(a.ident); } };
  return chip ? (
    <Marker
      position={[a.lat, a.lon]} eventHandlers={events}
      icon={airportMarkIcon(a.ident, a.airspace_class ?? null, colourOf(a.flight_category), a.military === "military" ? "military" : a.private ? "private" : null)}
    >
      {hovers && <MapTooltip>{a.ident} · {a.name} · {a.flight_category ?? "no report"}</MapTooltip>}
    </Marker>
  ) : (
    <CircleMarker
      center={[a.lat, a.lon]} radius={TARGET_RADIUS}
      // The class at creation (Leaflet takes it only then), the rest as style.
      className="leaflet-airport-target"
      pathOptions={TARGET_STYLE}
      eventHandlers={events}
    >
      {hovers && <MapTooltip>{a.ident} · {a.name}</MapTooltip>}
    </CircleMarker>
  );
});

/**
 * The chart's own airports, made tappable, from zoom 8 in -- the ones
 * that report from zoom 7: each one that reports its weather wears its
 * mark (airportMarkIcon), the symbol of its class of airspace -- or the
 * M of a military field, the R of a private one -- with a dot in its METAR's flight category's
 * colour and its ident beside it, as the route's own airports and the
 * Class B ones do; from zoom 10 every other landing field one, its dot
 * the grey of no report, and further out an invisible target, since the
 * chart already draws it. Either opens the field's card (PlaceCard),
 * with Fly Here -- the chart is a picture, and the map cannot otherwise
 * know an airport was tapped on it. A pointer turns to a hand over one
 * and names it. Under the route's own markers, which keep their taps,
 * and not for a field something else draws a mark for already
 * (`exclude`: the route's two, the Class B ones). The selected one
 * wears the ring a picked point wears on the map, round its mark
 * (selectionIcon) and over all of them.
 *
 * A tap anywhere else on the chart puts the card away, as it does in Maps.
 */
export function AirportsLayer({ selected, onSelect, exclude, route }: {
  selected: { ident: string; lat: number; lon: number } | null;
  onSelect: (ident: string | null) => void;
  exclude: Set<string>;
  /** The route's box: its reporting fields asked for once, ahead. */
  route: { south: number; west: number; north: number; east: number } | null;
}) {
  // The fields the armed services keep to themselves, only when asked
  // for (the map's Military setting): a civil airplane lands there only
  // with the service's permission.
  const showMilitary = usePreferences(s => s.military);
  const map = useMap();
  const [view, setView] = useState(() => boxOf(map));
  // The zoom a zoom is going to, as it starts: the route's chips draw
  // while the map is still easing in, not after it settles. The view's
  // own question waits for it to settle, where its box is known.
  const [easingTo, setEasingTo] = useState<number | null>(null);
  // Memoized, not an object literal. react-leaflet lists the handlers
  // object in its effect's own dependencies, so a fresh one on every
  // render detaches the listener and re-attaches it on every commit --
  // and an event fired inside that same commit, by an earlier sibling's
  // effect (a `FocusOn` zoom), lands in the gap with nothing listening.
  // A tap on the chart a little off a field's mark -- within a finger's
  // half-width of it, the 44 points Apple asks for -- is that field's, the
  // nearest's where there are two, at the pilot's ask for a kinder map: a
  // mark is only 26 across, and a box grown to 44 covered its neighbours'.
  // Anywhere else, the card is put away.
  const drawn = useRef<AirportPin[]>([]);
  const handlers = useMemo(() => ({
    zoomanim: (e: L.ZoomAnimEvent) => setEasingTo(e.zoom),
    moveend: () => { setView(boxOf(map)); setEasingTo(null); },
    click: (e: L.LeafletMouseEvent) => {
      let best: { ident: string; px: number } | null = null;
      for (const a of drawn.current) {
        const px = map.latLngToContainerPoint([a.lat, a.lon]).distanceTo(e.containerPoint);
        if (px <= NEAR_MISS_PX && (!best || px < best.px)) best = { ident: a.ident, px };
      }
      onSelect(best?.ident ?? null);
    },
  }), [map, onSelect]);
  useMapEvents(handlers);
  const zoom = easingTo ?? view.zoom;
  const near = zoom >= FROM_ZOOM;
  const reports = zoom >= REPORTING_FROM_ZOOM;
  // At zoom 7 the view asks for the fields that report alone.
  const reportingOnly = view.zoom < FROM_ZOOM;
  // The fields along the route that report, asked for once the route is
  // drawn: zoomed in anywhere on it, their chips are already here, where
  // they used to wait for the zoom to settle and then behind its tiles.
  // The view's own answer, every field with the targets too, follows.
  // Ten minutes, as a METAR's colour can change by the hour.
  const routeKey = route ? `${route.south},${route.west},${route.north},${route.east}` : null;
  const { data: alongRoute } = useQuery({
    queryKey: ["airportsReporting", routeKey],
    queryFn: () => api.airportsInView({ ...route!, limit: 1000, reporting: true }),
    enabled: !!route,
    staleTime: 10 * 60_000,
    meta: { silent: true },
  });
  const { data: inView } = useQuery({
    queryKey: ["airportsInView", view.key, reportingOnly],
    queryFn: () => api.airportsInView({ ...view.box, reporting: reportingOnly }),
    enabled: view.zoom >= REPORTING_FROM_ZOOM,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  const data = useMemo(() => {
    const { south, west, north, east } = view.box;
    const byIdent = new Map<string, AirportPin>();
    for (const a of alongRoute ?? []) {
      if (a.lat >= south && a.lat <= north && a.lon >= west && a.lon <= east) byIdent.set(a.ident, a);
    }
    for (const a of inView ?? []) byIdent.set(a.ident, a);
    return [...byIdent.values()];
  }, [alongRoute, inView, view.box]);
  const shown = useMemo(() => (reports
    ? data.filter(a => !exclude.has(a.ident) && (near || a.flight_category) && (showMilitary || a.military !== "military"))
    : []), [reports, data, exclude, near, showMilitary]);
  useEffect(() => { drawn.current = shown; }, [shown]);
  // One callback for every mark, so a new onSelect -- the page's, made
  // again as its state changes -- draws none of them again.
  const latest = useRef(onSelect);
  useEffect(() => { latest.current = onSelect; }, [onSelect]);
  const pick = useCallback((ident: string) => latest.current(ident), []);
  const chip = (a: AirportPin) => !!a.flight_category || zoom >= NO_REPORT_FROM_ZOOM;
  return (
    <>
      <Pane name="airports" style={{ zIndex: 450 }}>
        {shown.map((a: AirportPin) => (
          <AirportMark key={a.ident} airport={a} chip={chip(a)} onSelect={pick} />
        ))}
      </Pane>
      {/* Under the marks (the airports' pane, 450), round the field's
          own: over them, it hid the first letters of its ident beside its
          mark. Over the course line and the chart (the overlay pane, 400);
          the route's and the Class B fields' marks, in the marker pane
          (600), lie in it as these do. */}
      {selected && (
        <Pane name="selected-airport" style={{ zIndex: 445 }}>
          <Marker
            position={[selected.lat, selected.lon]} icon={selectionIcon()}
            interactive={false} keyboard={false}
          />
        </Pane>
      )}
    </>
  );
}
