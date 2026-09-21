import L from "leaflet";
import { Polyline, Tooltip } from "react-leaflet";

interface Props {
  line: [number, number][];
  tooltip?: string;
  /** A click on the line itself, for adding a point on the course. */
  onClick?: (latlng: L.LatLng) => void;
}

/**
 * The course: a white casing under an orange-red core, plus a wide
 * invisible line to hover and click.
 *
 * A sectional already uses blue, magenta, black, brown, yellow and green,
 * so no single stroke wins on colour -- the casing is what makes it read,
 * the same way the chart draws its own linework. The hit line exists
 * because an SVG stroke is hoverable only where it is painted, and a
 * 3.5 px dashed line is mostly not painted.
 */
export function CourseLine({ line, tooltip, onClick }: Props) {
  return (
    <>
      <Polyline positions={line} pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.85, interactive: false }} />
      <Polyline
        positions={line}
        pathOptions={{ color: "#ff3b00", weight: 3.5, opacity: 1, dashArray: "11,7", interactive: false }}
      />
      <Polyline
        positions={line}
        pathOptions={{ color: "#000", weight: 18, opacity: 0, lineCap: "butt", bubblingMouseEvents: !onClick }}
        eventHandlers={onClick ? { click: e => { L.DomEvent.stopPropagation(e); onClick(e.latlng); } } : undefined}
      >
        {tooltip && <Tooltip sticky>{tooltip}</Tooltip>}
      </Polyline>
    </>
  );
}
