import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Polyline, useMap } from "react-leaflet";
import { api } from "../api/client";
import { altFt } from "../units";
import { centreClear, paddingClear } from "./clear";
import { TRAFFIC_COLOURS, trafficIcon } from "./icons";
import { positionAt, stepPastFlight, usePastFlight } from "./pastFlight";
import { colourRuns } from "./traffic";

// One style each, made once: react-leaflet restyles a path whose
// pathOptions is a new object.
const CASING: L.PathOptions = { color: "#ffffff", weight: 6, opacity: 0.85, interactive: false };
const styles = new Map<string, L.PathOptions>();
const styleOf = (colour: string) => {
  let style = styles.get(colour);
  if (!style) styles.set(colour, style = { color: colour, weight: 3, opacity: 1, interactive: false });
  return style;
};

/**
 * A past flight picked on its airplane's card (lib/map/pastFlight): its
 * path in its heights' colours, as the tracked flight's is, the map
 * fitted to it once, clear of the panel; and, while it is replayed, the
 * airplane flown along it -- moved each frame, its height beside it, the
 * map following it where it would leave what the panel leaves in sight.
 */
export default function PastFlightPath({ hex, id }: { hex: string; id: number }) {
  const map = useMap();
  // A past flight does not change: asked once.
  const { data } = useQuery({
    queryKey: ["pastFlight", hex, id], queryFn: () => api.trafficPastFlight(hex, id), staleTime: Infinity, meta: { silent: true },
  });
  useEffect(() => {
    if (data) usePastFlight.setState({ points: data.points });
  }, [data]);
  const points = useMemo(() => data?.points ?? [], [data]);
  const line = useMemo(() => points.map(p => [p.lat, p.lon] as [number, number]), [points]);
  const runs = useMemo(() => colourRuns(points.map(p => ({ lat: p.lat, lon: p.lon, altFt: p.alt_ft ?? null }))), [points]);
  useEffect(() => {
    if (line.length > 1) map.fitBounds(L.latLngBounds(line), paddingClear(map));
  }, [map, line]);

  // The replay: its clock moved on each frame while it plays, and the
  // airplane put where it was then -- by hand, not a render a frame.
  const marker = useRef<L.Marker | null>(null);
  useEffect(() => {
    let frame = 0, last = performance.now();
    const step = (now: number) => {
      frame = requestAnimationFrame(step);
      stepPastFlight(now - last);
      last = now;
      const { at, points: flown } = usePastFlight.getState();
      const here = at === null ? null : positionAt(flown, at);
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
        map.panTo(centreClear(map, [here.lat, here.lon], map.getZoom()), { animate: false });
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      marker.current?.remove();
      marker.current = null;
    };
  }, [map]);

  if (line.length < 2) return null;
  return (
    <>
      <Polyline positions={line} pathOptions={CASING} />
      {runs.map((run, i) => <Polyline key={i} positions={run.points} pathOptions={styleOf(run.colour)} className="past-flight-path" />)}
    </>
  );
}
