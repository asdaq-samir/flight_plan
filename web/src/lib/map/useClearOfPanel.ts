import { useContext, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { MapInsetsContext, SHEET_SECONDS } from "../../components/mapChrome";
import { centreClear } from "./clear";

/** `point` kept in the middle of what the panel leaves of the map as the
 *  panel settles at another height -- for whatever holds the map: a
 *  picked point, own ship followed. */
export function useClearOfPanel(point: { lat: number; lon: number } | null) {
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
    map.panTo(centreClear(map, [at.lat, at.lon], map.getZoom()), { animate: true, duration: SHEET_SECONDS });
  }, [map, insets]);
}
