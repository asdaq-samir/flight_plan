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
import { PANNING_MS, useAhead, useLiveZoom } from "./useView";

/** From this zoom in a sectional draws its airports big enough to aim a
 *  finger at; further out the targets would be a field of overlapping
 *  circles over half a state. */
const FROM_ZOOM = 8;

/** A zoom further out the fields that report wear their marks already,
 *  the rest nothing: the weather across a region at a glance, the chart
 *  under it still readable. */
const REPORTING_FROM_ZOOM = 7;

/** Further out than REPORTING_FROM_ZOOM, the biggest fields that report
 *  still wear their marks, fewer at each zoom out, as Maps keeps the big
 *  cities' names (the owner's ask, "show bigger airports gradually as we
 *  zoom out"): from this zoom, the whole country on a phone at 4. */
const FARTHEST_ZOOM = 4;
/** Out there, a field's mark only where no bigger one's is this near on
 *  the screen, px: a mark and its ident, so none sit on each other. */
const OUT_APART_PX = 80;
/** And at 4 and 5 the large and medium fields alone: the airline
 *  airports and the regional ones a pilot steers by. */
const BIG_ONLY_BELOW_ZOOM = 6;
/** Which kind first, out there, where only some fit. */
const KIND_RANK: Record<AirportPin["kind"], number> = { large: 0, medium: 1, small: 2, other: 3 };
/** What is drawn round the view, a share of it on each side: a pan
 *  shows marks already there as it starts. */
const PAD = 0.3;

/** From this zoom the fields with no report wear a mark too, its dot in the
 *  grey of no report: the sectional's own scale, where they are a
 *  handful on the screen rather than every strip in half a state.
 *  Further out they keep an invisible target. */
const NO_REPORT_FROM_ZOOM = 10;

/** The most fields the planner answers with at once. */
const AIRPORTS_LIMIT = 1000;

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
  const events = useMemo(() => ({
    click: (e: L.LeafletMouseEvent) => { L.DomEvent.stopPropagation(e); onSelect(a.ident); },
  }), [onSelect, a.ident]);
  const at = useMemo((): L.LatLngTuple => [a.lat, a.lon], [a.lat, a.lon]);
  return chip ? (
    <Marker
      position={at} eventHandlers={events}
      icon={airportMarkIcon(a.ident, a.airspace_class ?? null, colourOf(a.flight_category), a.military === "military" ? "military" : a.private ? "private" : null)}
    >
      {hovers && <MapTooltip>{a.ident} · {a.name} · {a.flight_category ?? "no report"}</MapTooltip>}
    </Marker>
  ) : (
    <CircleMarker
      center={at} radius={TARGET_RADIUS}
      // The class at creation (Leaflet takes it only then), the rest as style.
      className="leaflet-airport-target"
      pathOptions={TARGET_STYLE}
      eventHandlers={events}
    >
      {hovers && <MapTooltip>{a.ident} · {a.name}</MapTooltip>}
    </CircleMarker>
  );
// The same field as it was drawn, whatever its object: each answer for a
// new view is new objects for the fields already on the map, and drawn
// again each one was moved, its handlers bound again -- every mark on
// every zoom and pan.
}, (was, now) => was.chip === now.chip && was.onSelect === now.onSelect && samePin(was.airport, now.airport));

/** What a field's mark is drawn from (AirportMark): its place, its
 *  report's category, its airspace and its use, and its name (the hover's). */
function samePin(a: AirportPin, b: AirportPin): boolean {
  return a === b || (a.ident === b.ident && a.lat === b.lat && a.lon === b.lon && a.flight_category === b.flight_category
    && a.airspace_class === b.airspace_class && a.military === b.military && a.private === b.private && a.name === b.name);
}

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
 * (`others`: the route's own, the Class B ones). The selected one
 * wears the ring a picked point wears on the map, round its mark
 * (selectionIcon) and over all of them.
 *
 * A tap anywhere else on the chart puts the card away, as it does in Maps.
 */
export function AirportsLayer({ selected, onSelect, others, route }: {
  selected: { ident: string; lat: number; lon: number } | null;
  onSelect: (ident: string | null) => void;
  /** The fields another layer draws a mark for, left to it: a tap a
   *  little off one of those is that field's all the same. */
  others: { ident: string; lat: number; lon: number }[];
  /** The route's box: its reporting fields asked for once, ahead. */
  route: { south: number; west: number; north: number; east: number } | null;
}) {
  // The fields the armed services keep to themselves, only when asked
  // for (the map's Military setting): a civil airplane lands there only
  // with the service's permission.
  const showMilitary = usePreferences(s => s.military);
  const map = useMap();
  // The view as it rests, what the planner is asked by; and as it is
  // now, a few times a second while it moves, what the marks are drawn for.
  const [view, setView] = useState(() => boxOf(map));
  const [seen, setSeen] = useState(() => map.getBounds());
  const panned = useRef(0);
  // The zoom a zoom is going to, as it starts, and each whole level a
  // pinch passes: the route's chips draw while the map is still easing in,
  // and a pinch's marks as it goes, not after the fingers lift.
  const zoom = useLiveZoom();
  // The box asked for, the view and a screen round it (useAhead). The
  // marks waited for the map to stop, its glide after a finger lifts too,
  // and then for the planner (0.35 to 0.5 s from a drag's end on a laptop,
  // 2026-10-09); a pan or a zoom in inside the box now has its answer
  // already, and the marks are drawn as they come into sight. Drawn for
  // the view alone (below), not the whole box: a mark costs a phone over a
  // millisecond to make, and the box's 885 round Minneapolis held the map
  // up seconds.
  const asked = useAhead();
  // Memoized, not an object literal. react-leaflet lists the handlers
  // object in its effect's own dependencies, so a fresh one on every
  // render detaches the listener and re-attaches it on every commit --
  // and an event fired inside that same commit, by an earlier sibling's
  // effect (a `FocusOn` zoom), lands in the gap with nothing listening.
  // A tap on the chart a little off a field's mark -- within a finger's
  // half-width of it, the 44 points Apple asks for -- is that field's, the
  // nearest's where there are two, at the pilot's ask for a kinder map: a
  // mark is only 26 across, and a box grown to 44 covered its neighbours'.
  // Every field's mark, the route's and the Class B ones' too (`others`):
  // a tap a little off those put the card away, where off any other field
  // it opened one. Anywhere else, the card is put away.
  const drawn = useRef<AirportPin[]>([]);
  const elsewhere = useRef(others);
  const handlers = useMemo(() => ({
    // Drawn again only as the view nears the edge of what is drawn, not
    // at every step of a move: a draw a few times a second under a finger
    // held a busy phone's pan up.
    move: () => {
      const now = performance.now();
      if (now - panned.current < PANNING_MS) return;
      panned.current = now;
      const bounds = map.getBounds();
      setSeen(was => (was.pad(PAD).contains(bounds) ? was : bounds));
    },
    moveend: () => { setView(boxOf(map)); setSeen(map.getBounds()); },
    click: (e: L.LeafletMouseEvent) => {
      let best: { ident: string; px: number } | null = null;
      for (const a of [...drawn.current, ...elsewhere.current]) {
        const px = map.latLngToContainerPoint([a.lat, a.lon]).distanceTo(e.containerPoint);
        if (px <= NEAR_MISS_PX && (!best || px < best.px)) best = { ident: a.ident, px };
      }
      onSelect(best?.ident ?? null);
    },
  }), [map, onSelect]);
  useMapEvents(handlers);
  const near = zoom >= FROM_ZOOM;
  const reports = zoom >= FARTHEST_ZOOM;
  // At zoom 7 the view asks for the fields that report alone -- at the
  // zoom a zoom is going to, so the question goes as it starts.
  const reportingOnly = zoom < FROM_ZOOM;
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
  // Up to a thousand, the box being some nine views: the planner's most,
  // 270 in two degrees by two and a half round Chicago in 0.14 s.
  const { data: inView } = useQuery({
    queryKey: ["airportsInView", asked.key, reportingOnly],
    queryFn: () => api.airportsInView({ ...asked.box, reporting: reportingOnly, limit: AIRPORTS_LIMIT }),
    enabled: zoom >= FARTHEST_ZOOM,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  // The planner keeps the biggest fields when the box holds more than the
  // limit, cut from the whole box and not from the view, so a full answer
  // may lack a small field the pilot is looking at. Then the view alone is
  // asked for too (the old question, with a thousand to spare for one view).
  const full = (inView?.length ?? 0) >= AIRPORTS_LIMIT;
  const { data: inViewAlone } = useQuery({
    queryKey: ["airportsInView", view.key, reportingOnly],
    queryFn: () => api.airportsInView({ ...view.box, reporting: reportingOnly, limit: AIRPORTS_LIMIT }),
    enabled: full && zoom >= REPORTING_FROM_ZOOM,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  const data = useMemo(() => {
    // The view as it rested, on its half-degree grid, and as it is now
    // with some of it again round it (PAD), so a pan under way has marks.
    const padded = seen.pad(PAD);
    const { south, west, north, east } = view.box;
    const inside = (a: AirportPin) => (a.lat >= south && a.lat <= north && a.lon >= west && a.lon <= east) || padded.contains([a.lat, a.lon]);
    const byIdent = new Map<string, AirportPin>();
    for (const list of [alongRoute, inView, full ? inViewAlone : undefined]) {
      for (const a of list ?? []) {
        if (inside(a)) byIdent.set(a.ident, a);
      }
    }
    return [...byIdent.values()];
  }, [alongRoute, inView, inViewAlone, full, seen, view.box]);
  const exclude = useMemo(() => new Set(others.map(a => a.ident)), [others]);
  const shown = useMemo(() => {
    if (!reports) return [];
    const kept = data.filter(a => !exclude.has(a.ident) && (near || a.flight_category) && (showMilitary || a.military !== "military"));
    if (zoom >= REPORTING_FROM_ZOOM) return kept;
    // Out past the sectional's scale: the biggest first, each only where
    // no bigger one's mark is on it -- fewer and bigger at each zoom out.
    const room: L.Point[] = [];
    const out: AirportPin[] = [];
    for (const a of [...kept].sort((x, y) => KIND_RANK[x.kind] - KIND_RANK[y.kind])) {
      if (zoom < BIG_ONLY_BELOW_ZOOM && KIND_RANK[a.kind] > KIND_RANK.medium) break;
      const at = map.project([a.lat, a.lon], zoom);
      if (room.some(p => p.distanceTo(at) < OUT_APART_PX)) continue;
      room.push(at);
      out.push(a);
    }
    return out;
  }, [reports, data, exclude, near, showMilitary, zoom, map]);
  useEffect(() => { drawn.current = shown; }, [shown]);
  useEffect(() => { elsewhere.current = others; }, [others]);
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
