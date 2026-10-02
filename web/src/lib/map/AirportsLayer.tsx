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
 * do; over every other landing field an invisible target, since the
 * chart already draws it. Either opens the field's card (PlaceCard),
 * with Fly Here -- the chart is a picture, and the map cannot otherwise
 * know an airport was tapped on it. A pointer turns to a hand over one
 * and names it. Under the route's own markers, which keep their taps,
 * and not for a field something else draws a chip for already
 * (`exclude`: the route's two, the Class B ones). The selected one
 * wears the taxiway-yellow halo the brand gives a chosen place.
 *
 * A tap anywhere else on the chart puts the card away, as it does in Maps.
 */
export function AirportsLayer({ selected, onSelect, exclude }: {
  selected: { ident: string; lat: number; lon: number } | null;
  onSelect: (ident: string | null) => void;
  exclude: Set<string>;
}) {
  const map = useMap();
  const [view, setView] = useState(() => boxOf(map));
  // Memoized, not an object literal: see useZoomLevel.
  const handlers = useMemo(() => ({
    moveend: () => setView(boxOf(map)),
    click: () => onSelect(null),
  }), [map, onSelect]);
  useMapEvents(handlers);
  const near = view.zoom >= FROM_ZOOM;
  const { data } = useQuery({
    queryKey: ["airportsInView", view.key],
    queryFn: () => api.airportsInView(view.box),
    enabled: near,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  return (
    <Pane name="airports" style={{ zIndex: 450 }}>
      {near && data?.filter(a => !exclude.has(a.ident)).map((a: AirportPin) => (a.flight_category ? (
        <Marker
          key={a.ident} position={[a.lat, a.lon]} icon={airportIcon(colourOf(a.flight_category), a.ident)}
          eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelect(a.ident); } }}
        >
          {hovers && <MapTooltip>{a.ident} · {a.name} · {a.flight_category}</MapTooltip>}
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
