import { useEffect } from "react";
import { useMap } from "react-leaflet";

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
 *  `zoom` at least -- the selection ring's own follow. */
export function FocusOn({ point, zoom }: { point: { lat: number; lon: number } | null; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView([point.lat, point.lon], Math.max(map.getZoom(), zoom));
  }, [map, point, zoom]);
  return null;
}
