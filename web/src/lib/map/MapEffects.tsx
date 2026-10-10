import { useContext, useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { MapInsetsContext, SHEET_SECONDS } from "../../components/mapChrome";
import { centreClear } from "./clear";
import { useOwnShip } from "./ownShip";
import { useClearOfPanel } from "./useClearOfPanel";

/**
 * Small pieces every map on this app is built from, each a react-leaflet
 * child of the `MapContainer` that reads the map through `useMap` and
 * draws nothing itself.
 */

/** Leaflet measures its container once at init and never again on its
 *  own, so a resize the map didn't cause itself -- the sidebar opening,
 *  a window resize -- leaves it drawing into its old dimensions until
 *  something calls `invalidateSize()`. A ResizeObserver on the
 *  container catches all of those in one place. */
export function ResizeAware() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Brings the map to `point` whenever it changes, zooming in to
 *  `zoom` at least -- the selection ring's own follow -- clear of the
 *  panel over the map; and keeps it there, in the sheet's own time, as
 *  the panel settles at another height (MapShell leaves the route alone
 *  while a point holds the map). */
/** Fits the map to `points` -- the fields Nearest lists, round own ship --
 *  clear of the panel over it, flown there in the sheet's time as a route
 *  is fitted (MapShell), when `fitKey` changes and again as the panel
 *  settles at another height while they are up. Not past `maxZoom`, so
 *  one field near the position is not the whole screen. */
export function FitTo({ points, fitKey, maxZoom = 11 }: {
  points: { lat: number; lon: number }[]; fitKey: string | null; maxZoom?: number;
}) {
  const map = useMap();
  const { top, bottom, left } = useContext(MapInsetsContext);
  useEffect(() => {
    if (!fitKey || points.length === 0) return;
    // The map gone to them: own ship stops pulling it back to the
    // position, as a route's fit stops it (MapShell).
    const ownShip = useOwnShip.getState();
    if (ownShip.enabled && ownShip.follow) ownShip.setFollow(false);
    map.flyToBounds(L.latLngBounds(points.map(p => [p.lat, p.lon] as [number, number])), {
      paddingTopLeft: L.point(40 + left, 40 + top), paddingBottomRight: L.point(40, 40 + bottom),
      maxZoom, duration: SHEET_SECONDS,
    });
    // On the set of points and the panel's height, not on each new array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, top, bottom, left, maxZoom]);
  return null;
}

export function FocusOn({ point, zoom }: { point: { lat: number; lon: number } | null; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    // The map gone to the place: own ship stops pulling it back to the
    // position, as a route's fit and Nearest's stop it (MapShell, FitTo),
    // until the location arrow is tapped -- an airport's card went back
    // to own ship at the GPS's next fix, the field out of sight under it.
    const ownShip = useOwnShip.getState();
    if (ownShip.enabled && ownShip.follow) ownShip.setFollow(false);
    const to = Math.max(map.getZoom(), zoom);
    // Flown there in the sheet's time, as Maps moves to a place picked:
    // set at once, the chart jumped under the pilot's finger.
    map.flyTo(centreClear(map, [point.lat, point.lon], to), to, { duration: SHEET_SECONDS });
  }, [map, point, zoom]);
  useClearOfPanel(point);
  return null;
}
