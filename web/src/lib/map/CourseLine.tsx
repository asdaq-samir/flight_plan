import L from "leaflet";
import { Polyline } from "react-leaflet";
import { COURSE_MAGENTA } from "./chartColors";
import { MapTooltip } from "./MapTooltip";

interface Props {
  line: [number, number][];
  tooltip?: string;
  /** A click on the line itself, for adding a point on the course. */
  onClick?: (latlng: L.LatLng) => void;
}

/**
 * The course: a white casing under a solid magenta core, plus a wide
 * invisible line to hover and click.
 *
 * Magenta and solid, the course line every moving map and glass cockpit
 * draws, at the owner's ask ("draw the course line as magenta as done in
 * all aviation apps"), where it was a dashed orange-red. A brighter
 * magenta than the chart's own (#c0309f, its airspace and waypoints), and
 * the casing is what makes it read over them, the same way the chart
 * draws its own linework. The hit line exists
 * because an SVG stroke is hoverable only where it is painted, and a
 * 3.5 px dashed line is mostly not painted.
 */
// Constants, not literals: react-leaflet restyles a path whenever its
// pathOptions is a new object.
// Their classes for the night's colours over a dimmed chart (index.css).
const CASING: L.PathOptions = { color: "#ffffff", weight: 5.5, opacity: 0.85, interactive: false, className: "course-casing" };
const CORE: L.PathOptions = { color: COURSE_MAGENTA, weight: 2.5, opacity: 1, interactive: false, className: "course-core" };
const HIT: L.PathOptions = { color: "#000", weight: 18, opacity: 0, lineCap: "butt", bubblingMouseEvents: false };
const HIT_PASSING: L.PathOptions = { ...HIT, bubblingMouseEvents: true };

export function CourseLine({ line, tooltip, onClick }: Props) {
  return (
    <>
      <Polyline positions={line} pathOptions={CASING} />
      <Polyline positions={line} pathOptions={CORE} />
      <Polyline
        positions={line}
        pathOptions={onClick ? HIT : HIT_PASSING}
        eventHandlers={onClick ? { click: e => { L.DomEvent.stopPropagation(e); onClick(e.latlng); } } : undefined}
      >
        {tooltip && <MapTooltip>{tooltip}</MapTooltip>}
      </Polyline>
    </>
  );
}
