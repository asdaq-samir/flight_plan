import { useEffect, useMemo } from "react";
import { Polyline } from "react-leaflet";
import type { Course } from "../api/types";
import { useLegHighlight } from "./legHighlight";
import { FitTo } from "./MapEffects";

/** The highlight's amber, the caution colour of a hazard's row, wide and
 *  under the course's magenta so the course still reads through it. */
const HIGHLIGHT = { color: "#ff9500", weight: 12, opacity: 0.55, lineCap: "round", interactive: false } as const;

/**
 * The legs of the route a hazard in the Brief is on, as the pilot tapped
 * it (lib/map/legHighlight): drawn wide in amber under the course, and
 * the map brought to them clear of the panel. Put away when the route
 * changes, its legs then another route's.
 */
export function LegHighlightLayer({ course }: { course: Course }) {
  const shown = useLegHighlight(s => s.shown);
  const clear = useLegHighlight(s => s.clear);
  const route = `${course.departure.ident}-${(course.stops ?? []).map(s => s.ident).join("-")}-${course.destination.ident}`;
  useEffect(() => clear, [route, clear]);
  const points = useMemo(() => shown?.lines.flat() ?? [], [shown]);
  if (!shown) return null;
  return (
    <>
      {shown.lines.map((line, i) => (
        <Polyline key={`${shown.key}-${i}`} positions={line.map(p => [p.lat, p.lon] as [number, number])} pathOptions={HIGHLIGHT} />
      ))}
      <FitTo points={points} fitKey={shown.key} maxZoom={11} />
    </>
  );
}
