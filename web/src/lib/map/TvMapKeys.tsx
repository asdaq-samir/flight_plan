import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { zoomInKey, zoomOutKey } from "../tv";

/** On a TV (lib/tv), the map zoomed from the remote while it is on the
 *  map: OK and a channel up in, a channel down out -- a remote has no +
 *  and -, and Leaflet's own keys (on, MapShell) pan it with the arrows. */
export default function TvMapKeys() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const onKey = (event: KeyboardEvent) => {
      // Only the map itself: OK on its zoom buttons or a marker is theirs.
      if (event.target !== container) return;
      if (zoomInKey(event)) map.zoomIn();
      else if (zoomOutKey(event)) map.zoomOut();
      else return;
      event.preventDefault();
    };
    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [map]);
  return null;
}
