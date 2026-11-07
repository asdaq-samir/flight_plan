import { useQueries } from "@tanstack/react-query";
import type { CircleLayerSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Leg, ProcedureDrawing } from "../../../api/types";
import { bearingDeg, type LatLon } from "../../../geo";
import { pointName } from "../../../identSchema";
import { prefersReducedMotion } from "../../../motion";
import { usePreferences } from "../../../preferences";
import { airportQuery, plateQuery } from "../../../queryClient";
import { STOP_KINDS, type StopKind } from "../../../stopKinds";
import type { TrafficPattern } from "../../../trafficPattern";
import { altFt } from "../../../units";
import { COURSE_MAGENTA, MAP_BLUE } from "../../chartColors";
import { colourOf } from "../../flightCategory";
import { airportMarkIcon, fixMarkIcon, trafficIcon } from "../../icons";
import { useLessonMap } from "../../lessonMap";
import { PATTERN_WORDS_FROM_ZOOM, TEAL, arrowIcon, labelIcon } from "../../patternMarks";
import { PROCEDURE_INK, PROCEDURE_WORDS_FROM_ZOOM, STALE_INK, fixIcon } from "../../procedureMarks";
import { WAY_SHARES, wayAt, wayIcon, type RouteWay } from "../../routeWays";
import { BREAK_PIN, FUEL_PIN, stackedPin, type StopPin } from "../../stopPins";
import { useGlData, useGlLayer, useGlMap } from "../glLayer";
import { leafletZoomOf } from "../glStyle";
import { iconMarker } from "../htmlMarker";
import { useGlLines, type GlRun } from "../useGlLines";
import { useGlMarks, type GlMark } from "./MarksGl";

/** The level the map is at, Leaflet's, as it changes: what the words on
 *  the procedures and the patterns come in at. */
function useGlLevel(): number {
  const { map } = useGlMap();
  const read = () => Math.floor(leafletZoomOf(map.getZoom()) + 1e-9);
  const [level, setLevel] = useState(read);
  useEffect(() => {
    const zoomed = () => setLevel(read());
    map.on("zoomend", zoomed);
    return () => { map.off("zoomend", zoomed); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read is the map's
  }, [map]);
  return level;
}

/** FPL's Routes' other ways beside the route (RouteWaysLayer): each a wide
 *  faint magenta line, the one shown solid, with its chip a tap picks. */
export function WaysGl({ ways, shown, onPick }: { ways: RouteWay[]; shown: string | null; onPick: (key: string) => void }) {
  const runs = useMemo<GlRun[]>(() => ways.map(w => ({ points: w.path, colour: COURSE_MAGENTA, width: w.key === shown ? 7 : 6, opacity: w.key === shown ? 1 : 0.35 })), [ways, shown]);
  useGlLines("route-ways", "lines", runs, null);
  const marks = useMemo<GlMark[]>(() => ways.map((w, i) => {
    const [lat, lon] = wayAt(w.path, w.share ?? WAY_SHARES[i % WAY_SHARES.length]!);
    return { key: w.key, lat, lon, icon: wayIcon(w.key, w.label, w.name ?? "", w.key === shown), onTap: () => onPick(w.key) };
  }), [ways, shown, onPick]);
  useGlMarks(marks);
  return null;
}

const pair = (p: LatLon): [number, number] => [p.lat, p.lon];
const along = (a: LatLon, b: LatLon, f: number): LatLon => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });

/** The traffic patterns picked (PatternLayer): each circuit teal on a white
 *  casing, its entry dashed, arrows and words from zoom 11. */
export function PatternsGl({ patterns }: { patterns: TrafficPattern[] }) {
  const level = useGlLevel();
  const circuits = useMemo<GlRun[]>(() => patterns.map(p => ({ points: [p.legs[0]!.from, ...p.legs.map(l => l.to)].map(pair), colour: TEAL, width: 3.5, name: `${p.kind === "departure" ? "departure" : "pattern"}-at-${p.ident}` })), [patterns]);
  const entries = useMemo<GlRun[]>(() => patterns.map(p => ({ points: [pair(p.entry.from), pair(p.entry.to)], colour: TEAL, width: 3 })), [patterns]);
  useGlLines("patterns", "route", circuits, { colour: "#ffffff", width: 7, opacity: 0.9 });
  useGlLines("pattern-entries", "route", entries, { colour: "#ffffff", width: 7, opacity: 0.9 }, [7 / 3, 2]);
  const marks = useMemo<GlMark[]>(() => (level < PATTERN_WORDS_FROM_ZOOM ? [] : patterns.flatMap(p => {
    const downwind = p.legs.find(l => l.name === "Downwind");
    const downwindAt = downwind && along(downwind.from, downwind.to, 0.5);
    const downwindWords = `${p.traffic === "right" ? "Right" : "Left"} downwind ${p.runway}${p.altitudeFt != null ? ` · ${altFt(p.altitudeFt)} ft` : ""}`;
    const entryAt = p.kind === "departure" ? p.entry.to : p.entry.from;
    const entryWords = p.kind === "departure" ? `${p.entry.name} · ${p.runway}` : p.entry.name;
    const at = (point: LatLon, key: string) => ({ key: `${p.ident}-${p.runway}-${key}`, lat: point.lat, lon: point.lon });
    return [
      ...p.legs.map(l => ({ ...at(along(l.from, l.to, 0.3), l.name), icon: arrowIcon(bearingDeg(l.from, l.to)) })),
      ...(downwindAt ? [{ ...at(downwindAt, "downwind"), icon: labelIcon(downwindWords) }] : []),
      { ...at(entryAt, "entry"), icon: labelIcon(entryWords) },
    ];
  })), [patterns, level]);
  useGlMarks(marks);
  return null;
}

/** The instrument procedures picked (ProcedureLayer): their lines in the
 *  approach's ink on a white casing, the missed dashed, holds, and each
 *  fix a diamond with its altitudes and speed from zoom 9; a tap a fix's
 *  card. */
export function ProceduresGl({ drawings, crossings, directs, onFix }: {
  drawings: ProcedureDrawing[];
  crossings: Record<string, number>;
  directs: string;
  onFix?: (field: string, kind: ProcedureDrawing["kind"], fix: string) => void;
}) {
  const level = useGlLevel();
  const words = level >= PROCEDURE_WORDS_FROM_ZOOM;
  const inkOf = (d: ProcedureDrawing) => (d.stale ? STALE_INK : PROCEDURE_INK);
  const lines = useMemo<GlRun[]>(() => drawings.flatMap(d => [
    ...d.lines.filter(l => l.role !== "missed").map(l => ({ points: l.points as [number, number][], colour: inkOf(d), width: 3.5 })),
    ...d.holds.filter(h => !h.missed).map(h => ({ points: h.points as [number, number][], colour: inkOf(d), width: 2.5 })),
  ]), [drawings]);
  const missed = useMemo<GlRun[]>(() => drawings.flatMap(d => [
    ...d.lines.filter(l => l.role === "missed").map(l => ({ points: l.points as [number, number][], colour: inkOf(d), width: 3 })),
    ...d.holds.filter(h => h.missed).map(h => ({ points: h.points as [number, number][], colour: inkOf(d), width: 2.5 })),
  ]), [drawings]);
  useGlLines("procedures", "route", lines, { colour: "#ffffff", width: 7, opacity: 0.9 });
  useGlLines("procedures-missed", "route", missed, { colour: "#ffffff", width: 6, opacity: 0.9 }, [8 / 3, 7 / 3]);
  const marks = useMemo<GlMark[]>(() => drawings.flatMap(d => d.fixes.map(fix => {
    const tappable = !!onFix && !fix.missed && !/^RW\d/.test(fix.ident);
    return {
      key: `${d.airport}-${d.id}-${d.transition ?? ""}-${fix.ident}`, lat: fix.lat, lon: fix.lon,
      icon: fixIcon(fix, words, !!d.stale, fix.missed ? null : crossings[fix.ident] ?? null, directs.split(",").includes(`${d.airport}:${d.id}:${fix.ident}`)),
      onTap: tappable ? () => onFix!(d.airport, d.kind, fix.ident) : undefined,
    };
  })), [drawings, words, crossings, directs, onFix]);
  useGlMarks(marks);
  return null;
}

/** Each approach's plate under its lines where it could be placed
 *  (PlateLayer): an image source on its four corners over a white sheet. */
export function PlatesGl({ drawings }: { drawings: ProcedureDrawing[] }) {
  const shown = usePreferences(s => s.plates);
  const approaches = shown ? drawings.filter(d => d.kind === "approach") : [];
  const plates = useQueries({ queries: approaches.map(d => plateQuery(d.airport, d.id)) });
  return (
    <>
      {plates.map((q, i) => {
        const p = q.data, d = approaches[i]!;
        if (!p || ![p.south, p.west, p.north, p.east].every(Number.isFinite)) return null;
        const url = `/api/planner/approach-plate/${encodeURIComponent(p.cycle)}/${encodeURIComponent(d.airport)}/${encodeURIComponent(d.id)}.png`;
        return <Plate key={`${d.airport}-${d.id}`} id={`plate-${d.airport}-${d.id}`} url={`${window.location.origin}${url}`} box={[p.west, p.south, p.east, p.north]} />;
      })}
    </>
  );
}

function Plate({ id, url, box: [w, s, e, n] }: { id: string; url: string; box: [number, number, number, number] }) {
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [[w, n], [e, n], [e, s], [w, s]];
  useGlLayer("areas", {
    [`${id}-sheet`]: { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] } } },
    [id]: { type: "image", url, coordinates },
  }, [
    { id: `${id}-sheet`, type: "fill", source: `${id}-sheet`, paint: { "fill-color": "#ffffff", "fill-opacity": 0.8 } },
    { id, type: "raster", source: id, paint: { "raster-fade-duration": 0 } },
  ]);
  return null;
}

/** Each hold the pilot put on the route (the legs' `hold`): its racetrack
 *  dashed in the course's magenta. */
export function HoldTracksGl({ legs }: { legs: Leg[] }) {
  const runs = useMemo<GlRun[]>(() => legs.flatMap(l => (l.hold ? [{ points: l.hold.path as [number, number][], colour: COURSE_MAGENTA, width: 2.5 }] : [])), [legs]);
  useGlLines("hold-tracks", "route", runs, null, [6 / 2.5, 5 / 2.5]);
  return null;
}

/** Each leg's top of climb and of descent (RouteMap's LegPoints): a pill on
 *  the course, a tap brings the map to it. MapLibre's markers keep no
 *  room of their own, so a pill too near the last is left off. */
export function LegPointsGl({ legs, onSelectPoint }: { legs: Leg[]; onSelectPoint: (lat: number, lon: number) => void }) {
  const marks = useMemo<GlMark[]>(() => legs.flatMap((leg, i) => [
    ...(leg.toc ? [{ key: `toc-${i}`, lat: leg.toc.lat, lon: leg.toc.lon, icon: fixMarkIcon("TOC"), title: `Top of climb`, onTap: () => onSelectPoint(leg.toc!.lat, leg.toc!.lon) }] : []),
    ...(leg.tod ? [{ key: `tod-${i}`, lat: leg.tod.lat, lon: leg.tod.lon, icon: fixMarkIcon("TOD"), title: `Top of descent`, onTap: () => onSelectPoint(leg.tod!.lat, leg.tod!.lon) }] : []),
  ]), [legs, onSelectPoint]);
  useGlMarks(marks);
  return null;
}

/** The planner's suggested fuel stops and breaks (FuelStopPins): each
 *  field's own mark under its pin, a tap its card. */
export function FuelStopsGl({ stops, onSelect }: { stops: StopPin[]; onSelect: (ident: string) => void }) {
  const places = useQueries({ queries: stops.map(s => airportQuery(s.ident)) });
  const marks = useMemo<GlMark[]>(() => stops.flatMap((s, i) => {
    const place = places[i]?.data;
    const use = place?.military === "military" ? "military" as const : null;
    return [
      { key: `${s.ident}-field`, lat: s.lat, lon: s.lon, icon: airportMarkIcon(pointName(s.ident), place?.airspace_class ?? null, colourOf(place?.metar?.flight_category), use), onTap: () => onSelect(s.ident) },
      { key: `${s.ident}-pin`, lat: s.lat, lon: s.lon, icon: s.reason === "break" ? BREAK_PIN : FUEL_PIN, title: `Suggested ${s.reason === "break" ? "stop" : "fuel stop"} ${s.ident}`, onTap: () => onSelect(s.ident) },
    ];
  }), [stops, places, onSelect]);
  useGlMarks(marks);
  return null;
}

/** The map's Stops while their sheet is open (StopFieldMark): each field's
 *  mark under its stacked pins, a tap its row. */
export function StopFieldsGl({ fields, onSelect }: { fields: { ident: string; lat: number; lon: number; kinds: StopKind[] }[]; onSelect: (ident: string) => void }) {
  const marks = useMemo<GlMark[]>(() => fields.flatMap(f => [
    { key: `${f.ident}-field`, lat: f.lat, lon: f.lon, icon: airportMarkIcon(pointName(f.ident), null, colourOf(undefined)), onTap: () => onSelect(f.ident) },
    { key: `${f.ident}-pins-${f.kinds.join(",")}`, lat: f.lat, lon: f.lon, icon: stackedPin(f.kinds), title: `${f.ident}: ${f.kinds.map(k => STOP_KINDS[k].name).join(", ")}`, onTap: () => onSelect(f.ident) },
  ]), [fields, onSelect]);
  useGlMarks(marks);
  return null;
}

const RING_SOURCE = "picked-ring";
/** The ring round a picked point (Halo: cased both sides), and the held
 *  point's blue dot. */
const RINGS: CircleLayerSpecification[] = [
  { id: "picked-ring-outer", type: "circle", source: RING_SOURCE, paint: { "circle-radius": 19, "circle-opacity": 0, "circle-stroke-color": "rgba(10,20,28,.55)", "circle-stroke-width": 9 } },
  { id: "picked-ring-inner", type: "circle", source: RING_SOURCE, paint: { "circle-radius": 19, "circle-opacity": 0, "circle-stroke-color": "#ffffff", "circle-stroke-width": 6 } },
  { id: "picked-ring", type: "circle", source: RING_SOURCE, paint: { "circle-radius": 19, "circle-opacity": 0, "circle-stroke-color": "#ff3b00", "circle-stroke-width": 3 } },
  { id: "held-dot", type: "circle", source: RING_SOURCE, filter: ["get", "held"], paint: { "circle-radius": 6, "circle-color": MAP_BLUE, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
];

/** A point picked (a checkpoint's ring), and a point held on the chart --
 *  a finger held, a right-click -- for its airspace card (HeldPoint). */
export function PickedGl({ focus, held, onHold }: {
  focus: { lat: number; lon: number } | null;
  held: { lat: number; lon: number } | null;
  onHold: (point: { lat: number; lon: number }) => void;
}) {
  const { map } = useGlMap();
  useGlLayer("top", { [RING_SOURCE]: { type: "geojson", data: { type: "FeatureCollection", features: [] } } }, RINGS);
  const data = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: [...(focus ? [{ p: focus, held: false }] : []), ...(held ? [{ p: held, held: true }] : [])].map(({ p, held }) => ({
      type: "Feature", properties: { held }, geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  }), [focus, held]);
  useGlData(RING_SOURCE, data);
  const hold = useRef(onHold);
  useEffect(() => { hold.current = onHold; });
  useEffect(() => {
    const menu = (e: { lngLat: { lat: number; lng: number } }) => hold.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    map.on("contextmenu", menu);
    return () => { map.off("contextmenu", menu); };
  }, [map]);
  return null;
}

/** The approach lesson's step (LessonLayer): its part of the procedure
 *  in a wide blue band, its fix ringed, its airplane flown along. */
export function LessonGl() {
  const { map } = useGlMap();
  const drawing = useLessonMap(s => s.drawing);
  const focus = useLessonMap(s => s.focus);
  const flight = useLessonMap(s => s.flight);
  const fix = drawing && focus.fix ? drawing.fixes.find(f => f.ident === focus.fix) ?? null : null;
  const runs = useMemo<GlRun[] | null>(() => (drawing && focus.segment
    ? drawing.lines.filter(l => l.role === focus.segment).map(l => ({ points: l.points as [number, number][], colour: MAP_BLUE, width: 10, opacity: 0.35 }))
    : null), [drawing, focus.segment]);
  useGlLines("lesson", "route", runs, null);
  const ring = useMemo<GlMark[]>(() => (fix ? [{
    key: `lesson-${fix.ident}`, lat: fix.lat, lon: fix.lon,
    icon: { options: { className: "", iconSize: [34, 34], iconAnchor: [17, 17], html: `<span style="position:absolute;inset:0;border-radius:9999px;border:3px solid ${MAP_BLUE};background:rgba(0,122,255,.12)"></span>` } },
  }] : []), [fix]);
  useGlMarks(ring);
  useEffect(() => {
    if (fix) map.easeTo({ center: [fix.lon, fix.lat], duration: prefersReducedMotion() ? 0 : 400 });
  }, [map, fix]);
  // The airplane flown from the last fix to this one over a second and a half.
  useEffect(() => {
    if (!flight || flight.path.length === 0) return;
    const marker = iconMarker(trafficIcon(flight.track, MAP_BLUE, "", null, 0, false)).setLngLat([flight.path[0]!.lon, flight.path[0]!.lat]).addTo(map);
    const end = flight.path.at(-1)!;
    if (prefersReducedMotion() || flight.path.length < 2) {
      marker.setLngLat([end.lon, end.lat]);
      return () => { marker.remove(); };
    }
    const began = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const f = Math.min(1, (now - began) / 1600);
      const i = Math.min(flight.path.length - 2, Math.floor(f * (flight.path.length - 1)));
      const k = f * (flight.path.length - 1) - i;
      const a = flight.path[i]!, b = flight.path[i + 1]!;
      marker.setLngLat([a.lon + (b.lon - a.lon) * k, a.lat + (b.lat - a.lat) * k]);
      if (f < 1) frame = requestAnimationFrame(step);
    });
    return () => { cancelAnimationFrame(frame); marker.remove(); };
  }, [map, flight]);
  return null;
}

