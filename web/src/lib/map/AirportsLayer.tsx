import L from "leaflet";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleMarker, Marker, Pane, useMap, useMapEvents } from "react-leaflet";
import { api } from "../api/client";
import type { AirportPin } from "../api/types";
import { colourOf } from "./flightCategory";
import { airportIcon } from "./icons";
import { MapTooltip } from "./MapTooltip";

/** From this zoom in a sectional draws its airports big enough to aim a
 *  finger at; further out the targets would be a field of overlapping
 *  circles over half a state. */
const FROM_ZOOM = 8;

/** From this zoom the fields with no report wear a chip too, in the
 *  grey of no report: the sectional's own scale, where they are a
 *  handful on the screen rather than every strip in half a state.
 *  Further out they keep an invisible target. */
const NO_REPORT_FROM_ZOOM = 10;

/** A finger's width round each airport symbol, 44 points across. */
const TARGET_RADIUS = 22;

/** A pointer that hovers: a name shows under it. A finger's tap is the
 *  card's, not a tooltip's. */
const hovers = typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

/** The view as a box on a half-degree grid, rounded outward: a pan of a
 *  few miles asks the planner for the same box again, which is cached. */
function boxOf(map: L.Map) {
  const b = map.getBounds();
  const out = (v: number, up: boolean) => (up ? Math.ceil(v * 2) : Math.floor(v * 2)) / 2;
  const box = { south: out(b.getSouth(), false), west: out(b.getWest(), false), north: out(b.getNorth(), true), east: out(b.getEast(), true) };
  return { box, zoom: map.getZoom(), key: `${box.south},${box.west},${box.north},${box.east}` };
}

/**
 * The chart's own airports, made tappable, from zoom 8 in: each one that
 * reports its weather wears a chip, its ident in its METAR's flight
 * category's colour, as the route's own airports and the Class B ones
 * do; from zoom 10 every other landing field one in the grey of no
 * report, and further out an invisible target, since the chart already
 * draws it. Either opens the field's card (PlaceCard),
 * with Fly Here -- the chart is a picture, and the map cannot otherwise
 * know an airport was tapped on it. A pointer turns to a hand over one
 * and names it. Under the route's own markers, which keep their taps,
 * and not for a field something else draws a chip for already
 * (`exclude`: the route's two, the Class B ones). The selected one
 * wears the taxiway-yellow halo the brand gives a chosen place.
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
  const map = useMap();
  const [view, setView] = useState(() => boxOf(map));
  // The zoom a zoom is going to, as it starts: the route's chips draw
  // while the map is still easing in, not after it settles. The view's
  // own question waits for it to settle, where its box is known.
  const [easingTo, setEasingTo] = useState<number | null>(null);
  // Memoized, not an object literal: see useZoomLevel.
  const handlers = useMemo(() => ({
    zoomanim: (e: L.ZoomAnimEvent) => setEasingTo(e.zoom),
    moveend: () => { setView(boxOf(map)); setEasingTo(null); },
    click: () => onSelect(null),
  }), [map, onSelect]);
  useMapEvents(handlers);
  const zoom = easingTo ?? view.zoom;
  const near = zoom >= FROM_ZOOM;
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
    queryKey: ["airportsInView", view.key],
    queryFn: () => api.airportsInView(view.box),
    enabled: view.zoom >= FROM_ZOOM,
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
  return (
    <Pane name="airports" style={{ zIndex: 450 }}>
      {near && data.filter(a => !exclude.has(a.ident)).map((a: AirportPin) => (a.flight_category || zoom >= NO_REPORT_FROM_ZOOM ? (
        <Marker
          key={a.ident} position={[a.lat, a.lon]} icon={airportIcon(colourOf(a.flight_category), a.ident)}
          eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelect(a.ident); } }}
        >
          {hovers && <MapTooltip>{a.ident} · {a.name} · {a.flight_category ?? "no report"}</MapTooltip>}
        </Marker>
      ) : (
        <CircleMarker
          key={a.ident} center={[a.lat, a.lon]} radius={TARGET_RADIUS}
          // The class at creation (Leaflet takes it only then), the rest as style.
          className="leaflet-airport-target"
          pathOptions={{ stroke: false, fill: true, fillOpacity: 0 }}
          eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelect(a.ident); } }}
        >
          {hovers && <MapTooltip>{a.ident} · {a.name}</MapTooltip>}
        </CircleMarker>
      )))}
      {selected && (
        <CircleMarker
          center={[selected.lat, selected.lon]} radius={16} interactive={false}
          pathOptions={{ color: "#F2B600", weight: 4, opacity: 0.95, fill: false }}
        />
      )}
    </Pane>
  );
}
