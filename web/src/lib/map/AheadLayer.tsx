import type { PathOptions } from "leaflet";
import { Fragment } from "react";
import { CircleMarker, Polyline } from "react-leaflet";
import { useAhead } from "./ahead";
import { useOwnShip } from "./ownShip";

// Constants, not literals: react-leaflet restyles a path whenever its
// pathOptions is a new object, and own ship draws at every fix.
const STYLE: Record<"warning" | "caution", { line: PathOptions; mark: PathOptions }> = {
  warning: {
    line: { color: "#dc2626", weight: 2, dashArray: "6 6", interactive: false },
    mark: { color: "#dc2626", weight: 3, fillColor: "#dc2626", fillOpacity: 0.25, interactive: false },
  },
  caution: {
    line: { color: "#d97706", weight: 2, dashArray: "6 6", interactive: false },
    mark: { color: "#d97706", weight: 3, fillColor: "#f59e0b", fillOpacity: 0.25, interactive: false },
  },
};

/**
 * Where each alert ahead is (lib/map/ahead): a ring in its colour where
 * the track meets it -- the airspace's edge, the obstacle, the ground's
 * highest point -- and a dashed line out to it from own ship, so the
 * banner's words have a place on the chart. Nothing to tap: the banner
 * says what it is.
 */
export function AheadLayer() {
  const ahead = useAhead();
  const fix = useOwnShip(s => s.fix);
  if (!ahead || !fix) return null;
  return (
    <>
      {ahead.alerts.map(a => (
        <Fragment key={a.id}>
          {/* Named by a class of their own, the TFRs being drawn in the
              same red: a class is the path's from when it is made, not
              its style. */}
          {!a.inside && (
            <Polyline positions={[[fix.lat, fix.lon], [a.lat, a.lon]]} pathOptions={STYLE[a.level].line} className={`ahead-${a.level}`} />
          )}
          <CircleMarker center={[a.lat, a.lon]} radius={8} pathOptions={STYLE[a.level].mark} className={`ahead-${a.level}`} />
        </Fragment>
      ))}
    </>
  );
}
