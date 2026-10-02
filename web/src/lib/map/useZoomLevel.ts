import { useMemo, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";

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
 * Where the crowd starts drawing -- the planner's scored landmarks, the
 * training page's detections, a few hundred over a corridor -- as a
 * Leaflet zoom: further out they hide the chart. The route's own
 * checkpoints, twenty or so, draw at every zoom (the settings' Show
 * checkpoints); they had a floor of their own, picked from a menu, and
 * a 2,500 nm route that fits at zoom 3 opened on a course line and two
 * airports.
 */
export const CROWD_ZOOM = 7;
