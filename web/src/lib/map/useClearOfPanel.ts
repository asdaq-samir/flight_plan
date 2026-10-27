import { useContext, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { MapInsetsContext, SHEET_SECONDS } from "../../components/mapChrome";
import { prefersReducedMotion } from "../motion";
import { centreClear } from "./clear";

/** `point` kept in the middle of what the panel leaves of the map as the
 *  panel settles at another height -- for whatever holds the map: a
 *  picked point, own ship followed. */
export function useClearOfPanel(point: { lat: number; lon: number } | null, zoom?: number) {
  const map = useMap();
  const insets = useContext(MapInsetsContext);
  const settled = useRef(insets);
  const pointRef = useRef(point);
  useEffect(() => { pointRef.current = point; }, [point]);
  useEffect(() => {
    const was = settled.current;
    settled.current = insets;
    const at = pointRef.current;
    // As MapShell's: on the panel going out or coming back to rest, not on
    // its size changing under a notice later.
    if (!at || insets.out === was.out) return;
    // Flown on to the zoom it was going to (FocusOn's), not panned at the
    // zoom of the moment: a point picked on a phone opens its card, the
    // sheet comes up for it, and a panTo here (setView, which stops any
    // flight) halted FocusOn's flight in at its first frame, the map left
    // at the route's zoom -- map.spec's checkpoint, mobile only, as the
    // desktop's card is no sheet (2026-10-27).
    const to = Math.max(map.getZoom(), zoom ?? map.getZoom());
    if (to !== map.getZoom()) map.flyTo(centreClear(map, [at.lat, at.lon], to), to, { duration: SHEET_SECONDS, animate: !prefersReducedMotion() });
    else map.panTo(centreClear(map, [at.lat, at.lon], to), { animate: !prefersReducedMotion(), duration: SHEET_SECONDS });
  }, [map, insets, zoom]);
}
