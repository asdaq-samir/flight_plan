import { memo, useEffect, useRef } from "react";
import L from "leaflet";
import { CircleMarker, Pane, Polyline, useMap } from "react-leaflet";
import { distanceNm, type LatLon } from "../geo";
import { prefersReducedMotion } from "../motion";
import { MAP_BLUE } from "./chartColors";
import { panClear } from "./clear";
import { trafficIcon } from "./icons";
import { useLessonMap } from "./lessonMap";

/** The part of the approach a step is about, over its indigo line: the
 *  tint, wide and pale, so the line and its fixes read through it. */
const SEGMENT: L.PathOptions = { color: MAP_BLUE, weight: 10, opacity: 0.35, lineCap: "round", lineJoin: "round" };
/** The fix a step is about: a ring in the tint round its diamond. */
const RING: L.PathOptions = { color: MAP_BLUE, weight: 3, opacity: 1, fill: true, fillColor: MAP_BLUE, fillOpacity: 0.12 };
/** How long the airplane takes from one fix to the next, ms: long enough
 *  to follow, short enough not to wait on. */
const FLIGHT_MS = 1600;

/**
 * The approach lesson on the chart (ApproachLesson, lib/map/lessonMap): the
 * fix the step is about ringed and the part of the approach drawn over in
 * the tint, over the procedure's own line (ProcedureLayer), and its
 * airplane flown along the line from the last fix to this one -- straight
 * there with Reduce Motion on. Each brought into sight clear of the panel.
 */
export default memo(function LessonLayer() {
  const drawing = useLessonMap(s => s.drawing);
  const focus = useLessonMap(s => s.focus);
  const map = useMap();
  const fix = drawing && focus.fix ? drawing.fixes.find(f => f.ident === focus.fix) ?? null : null;
  const lines = drawing && focus.segment ? drawing.lines.filter(l => l.role === focus.segment) : [];
  // The fix brought into sight where the step's ringing it is out of it.
  useEffect(() => {
    if (!fix) return;
    if (!map.getBounds().pad(-0.15).contains([fix.lat, fix.lon])) panClear(map, [fix.lat, fix.lon]);
  }, [map, fix]);
  if (!drawing) return null;
  return (
    <Pane name="lesson" style={{ zIndex: 433 }}>
      {lines.map((line, i) => <Polyline key={`${focus.segment}-${i}`} positions={line.points} pathOptions={SEGMENT} interactive={false} />)}
      {fix && <CircleMarker center={[fix.lat, fix.lon]} radius={17} pathOptions={RING} interactive={false} />}
      <LessonAirplane />
    </Pane>
  );
});

/** The point `f` of the way along `path` by distance. */
function along(path: LatLon[], f: number): LatLon {
  const legs = path.slice(1).map((p, i) => distanceNm(path[i]!, p));
  const total = legs.reduce((a, b) => a + b, 0);
  let left = Math.min(1, Math.max(0, f)) * total;
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i]! || i === legs.length - 1) {
      const k = legs[i]! > 0 ? Math.min(1, left / legs[i]!) : 1;
      const a = path[i]!, b = path[i + 1]!;
      return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k };
    }
    left -= legs[i]!;
  }
  return path.at(-1)!;
}

/** The lesson's airplane: put by hand a frame at a time, as the replays'
 *  is (useReplayMarker), not drawn again by React each frame. */
function LessonAirplane() {
  const map = useMap();
  const flight = useLessonMap(s => s.flight);
  const marker = useRef<L.Marker | null>(null);
  useEffect(() => {
    if (!flight || flight.path.length === 0) return;
    const icon = trafficIcon(flight.track, MAP_BLUE, "", null, 0, false);
    const start = flight.path[0]!;
    if (!marker.current) marker.current = L.marker([start.lat, start.lon], { icon, interactive: false, keyboard: false, pane: "lesson" }).addTo(map);
    else marker.current.setIcon(icon);
    const end = flight.path.at(-1)!;
    const done = () => {
      marker.current?.setLatLng([end.lat, end.lon]);
      if (!map.getBounds().pad(-0.15).contains([end.lat, end.lon])) panClear(map, [end.lat, end.lon]);
    };
    if (prefersReducedMotion() || flight.path.length < 2) {
      done();
      return;
    }
    const began = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const f = (now - began) / FLIGHT_MS;
      if (f >= 1) return done();
      const at = along(flight.path, f);
      marker.current?.setLatLng([at.lat, at.lon]);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [map, flight]);
  // Off the chart with the lesson, or once its flight is taken away.
  useEffect(() => {
    if (flight) return;
    marker.current?.remove();
    marker.current = null;
  }, [flight]);
  useEffect(() => () => { marker.current?.remove(); marker.current = null; }, []);
  return null;
}
