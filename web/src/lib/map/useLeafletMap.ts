import L from "leaflet";
import { useEffect, useRef } from "react";
import { observeResize } from "./leaflet";

/**
 * The map-creation boilerplate both maps in this app needed identically
 * (this used to be copy-pasted between `ChartMap` and `RouteMap`, down
 * to the same comments): create once, guarded against StrictMode's
 * double effect -- without it Leaflet initialises two maps into the
 * same element and the second one throws -- drop Leaflet's own
 * "Leaflet" self-credit (the OSM/FAA attributions beside it are a real
 * requirement of OSM's tile usage policy, not decoration, and stay),
 * and keep it sized to its container via `observeResize`. Everything
 * after creation -- basemaps, layers, the halo -- is specific to what
 * each map draws and stays in its own component.
 */
export function useLeafletMap(onReady?: (map: L.Map) => void) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);

  useEffect(() => {
    if (map.current || !el.current) return;
    // zoomControl: false drops the +/- buttons, not zooming itself --
    // scroll/pinch/double-click zoom are all untouched, and the top-left
    // corner they used to sit in is prime real estate now that the map
    // is edge to edge under the toolbar.
    map.current = L.map(el.current, { zoomControl: false, minZoom: 4, keyboard: false });
    map.current.attributionControl.setPrefix(false);
    onReady?.(map.current);
    const stopObserving = observeResize(map.current, el.current);
    return () => { stopObserving(); map.current?.remove(); map.current = null; };
    // Deliberately []: this runs once, the same as it did inline in
    // each component before -- onReady is read at creation time only.
  }, []);

  return { el, map };
}
