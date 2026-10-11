import type { PathOptions } from "leaflet";
import { useMemo } from "react";
import { Polyline } from "react-leaflet";
import { useOwnShip } from "./ownShip";
import { useOwnTrail } from "./ownTrail";

// Constants, not literals: react-leaflet restyles a path whenever its
// pathOptions is a new object.
const CASING: PathOptions = { color: "#ffffff", weight: 6, opacity: 0.85, interactive: false };
const LINE: PathOptions = { color: "#2563eb", weight: 3, opacity: 1, interactive: false };

/**
 * Where own ship has flown (lib/map/ownTrail), in own ship's blue over a
 * white casing, from the path's start to the airplane itself -- the last
 * point the arrow's own, so the line reaches it.
 */
export function OwnTrailLayer() {
  const path = useOwnTrail(s => s.path);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const line = useMemo(() => path.map(p => [p.lat, p.lon] as [number, number]), [path]);
  if (line.length < 2) return null;
  const whole: [number, number][] = fix ? [...line, [fix.lat, fix.lon]] : line;
  return (
    <>
      <Polyline positions={whole} pathOptions={CASING} />
      {/* Named by a class from when it is made, not its style. */}
      <Polyline positions={whole} pathOptions={LINE} className="own-trail" />
    </>
  );
}
