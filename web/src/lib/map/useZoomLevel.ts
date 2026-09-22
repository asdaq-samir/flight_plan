import { useMemo, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { usePreferences } from "../preferences";

/** The map's zoom level as React state, for whatever is drawn only from
 *  a zoom in: zoomed out to a whole region, a route's twenty checkpoint
 *  markers pile into one blob and a corridor's few hundred detections
 *  hide the chart, so at those zooms the course line and the two
 *  endpoints are the route. */
export function useZoomLevel(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  // Memoized, not an object literal. react-leaflet lists the handlers
  // object in its effect's own dependencies, so a fresh one on every render
  // detaches the listener and re-attaches it on every single commit --
  // and an event fired inside that same commit, by an earlier sibling's
  // effect, lands in the gap with nothing listening. That is not
  // hypothetical: `FocusOn` zooms the map from an effect, and it is
  // rendered before this, so every zoom the map's own button caused was
  // missed and the button reported the wrong state from then on.
  const handlers = useMemo(() => ({ zoomend: () => setZoom(map.getZoom()) }), [map]);
  useMapEvents(handlers);
  return zoom;
}

/**
 * Where the markers start drawing: the chosen checkpoints at the zoom
 * the pilot picked (the layers popover, remembered per browser), and
 * the crowd -- the scored candidates, the training page's detections,
 * which are many more -- one level further in.
 *
 * It used to be two constants. A 2,500 nm route fits at zoom 3, well
 * under the old floor of 6, so opening one showed a course line and
 * two airports and nothing else, with no way to ask for more short of
 * zooming in. The floor is still there and still defaults to what it
 * always was; it is just no longer the map's decision alone.
 */
export function useMarkerZooms(): { markers: number; crowd: number } {
  const from = usePreferences(s => s.markerZoom);
  return { markers: from, crowd: from === 0 ? 0 : from + 1 };
}
