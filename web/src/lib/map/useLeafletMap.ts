import L from "leaflet";
import { useEffect, useRef } from "react";
import { observeResize } from "./leaflet";

/**
 * The map-creation boilerplate both maps in this app needed identically
 * (this used to be copy-pasted between `ChartMap` and `RouteMap`, down
 * to the same comments): create once, guarded against StrictMode's
 * double effect -- without it Leaflet initialises two maps into the
 * same element and the second one throws -- drop Leaflet's own
 * "Leaflet" self-credit (the FAA attribution beside it stays), and
 * keep it sized to its container via `observeResize`. Everything
 * after creation -- the chart layers, the route, the halo -- is
 * specific to what each map draws and stays in its own component.
 */
export function useLeafletMap(onReady?: (map: L.Map) => void) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  // The latest onReady, read once when the map is created -- a ref
  // rather than a dependency, so a caller passing a fresh arrow every
  // render (ChartMap does) never tears the map down to rebuild it.
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });

  useEffect(() => {
    if (map.current || !el.current) return;
    // zoomControl: false drops the +/- buttons, not zooming itself --
    // scroll/pinch/double-click zoom are all untouched, and the top-left
    // corner they used to sit in is prime real estate now that the map
    // is edge to edge under the toolbar. minZoom 3 is where the whole
    // country fits a phone screen, and as far out as the chart layer
    // has tiles (VFR_SECTIONAL_MIN_ZOOM in src/vfr/config.py).
    map.current = L.map(el.current, { zoomControl: false, minZoom: 3, keyboard: false });
    map.current.attributionControl.setPrefix(false);
    // Deliberately no setView here. A generic default (say, a CONUS
    // view) sounds like it would give a pilot something to look at
    // immediately, but Leaflet can't reuse those tiles once the real
    // course arrives and fits to it -- a different center *and* a
    // different zoom means a completely different tile set, so it
    // doubles real tile-fetch traffic (measured: 24 wasted requests
    // for the placeholder view, then 24 more once the actual route
    // fit ran) rather than showing the real map any sooner. Left with
    // no view at all, Leaflet fetches nothing until a view exists --
    // so the very first tiles the chart layer (added with the course,
    // see createBasemaps) ever requests are the real route's own, the
    // moment course data's own fit() sets one. The container's own
    // background (see RouteMap/ChartMap) covers the cosmetic gap until
    // then, at zero network cost.
    ready.current?.(map.current);
    const stopObserving = observeResize(map.current, el.current);
    return () => { stopObserving(); map.current?.remove(); map.current = null; };
  }, []);

  return { el, map };
}
