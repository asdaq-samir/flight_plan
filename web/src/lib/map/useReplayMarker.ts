import L from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { altFt } from "../units";
import { panClear } from "./clear";
import { TRAFFIC_COLOURS, trafficIcon } from "./icons";
import { SIMULATED_FIX_MS, endSimulation, simulateFix } from "./ownShip";
import { positionAt, stepPastFlight, usePastFlight } from "./pastFlight";

/**
 * A replay's airplane on the map (lib/map/pastFlight): its clock moved on
 * each frame while it plays, and the airplane put where it was then -- by
 * hand, not a render a frame -- the map following it where it would leave
 * what the panel leaves in sight. A past flight's (PastFlightPath) and the
 * planned flight's dry run (DryRunLayer).
 *
 * `asOwnShip`, the dry run's: no airplane of its own, but own ship flown
 * along the route (simulateFix), a few times a second as a GPS reports,
 * the map following it as it follows the pilot.
 */

export function useReplayMarker(asOwnShip = false) {
  const map = useMap();
  const marker = useRef<L.Marker | null>(null);
  useEffect(() => {
    let frame = 0, last = performance.now(), reported = -Infinity, reportedAt: number | null = null;
    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      stepPastFlight(now - last);
      last = now;
      const { at, points: flown } = usePastFlight.getState();
      const here = at === null ? null : positionAt(flown, at);
      if (asOwnShip) {
        if (!here) endSimulation();
        else if (at !== reportedAt && now - reported >= SIMULATED_FIX_MS) {
          simulateFix(here);
          reported = now;
          reportedAt = at;
        }
        return;
      }
      if (!here) {
        marker.current?.remove();
        marker.current = null;
        return;
      }
      // Its height to the hundred feet, so the icon is made again only as that changes.
      const height = here.alt_ft == null ? null : Math.round(here.alt_ft / 100) * 100;
      const icon = trafficIcon(here.track_deg ?? null, TRAFFIC_COLOURS.far, altFt(height), null, 0, true);
      if (!marker.current) marker.current = L.marker([here.lat, here.lon], { icon, interactive: false, keyboard: false }).addTo(map);
      else {
        marker.current.setLatLng([here.lat, here.lon]);
        if (marker.current.options.icon !== icon) marker.current.setIcon(icon);
      }
      // Kept in sight: brought back to the middle where it would leave it.
      const sight = map.getBounds().pad(-0.15);
      if (usePastFlight.getState().playing && !sight.contains([here.lat, here.lon])) {
        panClear(map, [here.lat, here.lon], { animate: false });
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      marker.current?.remove();
      marker.current = null;
      if (asOwnShip) endSimulation();
    };
  }, [map, asOwnShip]);

}
