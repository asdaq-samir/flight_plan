import { Fragment, memo, useMemo, useState } from "react";
import L from "leaflet";
import { Marker, Pane, Polyline, useMap, useMapEvents } from "react-leaflet";
import { bearingDeg, type LatLon } from "../geo";
import type { TrafficPattern } from "../trafficPattern";
import { altFt } from "../units";

/**
 * The traffic patterns the pilot picked (the route's Procedures), on the
 * chart round their runways: each leg in teal over a white casing, as a
 * procedure is drawn apart from the route's orange (ForeFlight draws its
 * in a cyan, at the pilot's showing), an arrow along each leg the way it
 * is flown, the downwind named with its altitude, and the 45° entry dashed
 * into it. Not tappable: a picture of the pattern, the chart under it.
 */
const TEAL = "#0e8f8a";
// A path's class and whether it takes taps are read as it is made, so
// they are its own props below, not these styles.
const CASING: L.PathOptions = { color: "#ffffff", weight: 7, opacity: 0.9, lineJoin: "round" };
const LEG: L.PathOptions = { color: TEAL, weight: 3.5, opacity: 1, lineJoin: "round" };
const ENTRY: L.PathOptions = { color: TEAL, weight: 3, opacity: 1, dashArray: "7,6" };
/** From this zoom in, the legs' arrows and names: further out the pattern
 *  is a few pixels round its field, and its words would cover the field's
 *  mark. */
const WORDS_FROM_ZOOM = 11;

const pair = (p: LatLon): [number, number] => [p.lat, p.lon];
/** A point `f` of the way from `a` to `b`. */
const along = (a: LatLon, b: LatLon, f: number): LatLon => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });

/** An arrowhead the way a leg is flown, at its middle. */
function arrowIcon(bearing: number) {
  return L.divIcon({
    className: "", iconSize: [16, 16], iconAnchor: [8, 8],
    html: `<svg viewBox="-8 -8 16 16" width="16" height="16" style="transform:rotate(${Math.round(bearing)}deg)" aria-hidden="true">` +
      `<path d="M0 -6 L5 4 L0 1.5 L-5 4 Z" fill="${TEAL}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  });
}

/** A leg's name on the chart, white words on teal. */
function labelIcon(words: string) {
  const width = Math.ceil(words.length * 6.6) + 12;
  return L.divIcon({
    className: "", iconSize: [width, 18], iconAnchor: [width / 2, 9],
    html: `<span class="absolute inset-0 grid place-items-center whitespace-nowrap rounded-md text-[11px] leading-none font-bold text-white shadow-sm" style="background:${TEAL}">${words.replace(/[<>&]/g, "")}</span>`,
  });
}

export const PatternLayer = memo(function PatternLayer({ patterns }: { patterns: TrafficPattern[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents(useMemo(() => ({ zoomend: () => setZoom(map.getZoom()) }), [map]));
  if (patterns.length === 0) return null;
  const words = zoom >= WORDS_FROM_ZOOM;
  return (
    <Pane name="patterns" style={{ zIndex: 430 }}>
      {patterns.map(p => {
        const circuit = [p.legs[0]!.from, ...p.legs.map(l => l.to)].map(pair);
        const downwind = p.legs.find(l => l.name === "Downwind")!;
        return (
          <Fragment key={`${p.ident}-${p.runway}`}>
            <Polyline positions={circuit} pathOptions={CASING} interactive={false} />
            <Polyline positions={[pair(p.entry.from), pair(p.entry.to)]} pathOptions={CASING} interactive={false} />
            <Polyline positions={circuit} pathOptions={LEG} interactive={false} className="traffic-pattern" />
            <Polyline positions={[pair(p.entry.from), pair(p.entry.to)]} pathOptions={ENTRY} interactive={false} className="traffic-pattern-entry" />
            {words && p.legs.map(l => (
              <Marker
                // A third of the way along, clear of the downwind's name at
                // its middle.
                key={l.name} position={pair(along(l.from, l.to, 0.3))} icon={arrowIcon(bearingDeg(l.from, l.to))}
                interactive={false} keyboard={false} pane="patterns"
              />
            ))}
            {words && <Marker
              position={pair(along(downwind.from, downwind.to, 0.5))} interactive={false} keyboard={false} pane="patterns"
              icon={labelIcon(`${p.traffic === "right" ? "Right" : "Left"} downwind ${p.runway}${p.altitudeFt != null ? ` · ${altFt(p.altitudeFt)} ft` : ""}`)}
            />}
            {words && <Marker position={pair(p.entry.from)} interactive={false} keyboard={false} pane="patterns" icon={labelIcon("45° entry")} />}
          </Fragment>
        );
      })}
    </Pane>
  );
});
