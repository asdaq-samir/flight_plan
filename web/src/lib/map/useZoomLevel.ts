import { useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";

/** The map's zoom level as React state, for whatever is drawn only from
 *  a zoom in: zoomed out to a whole region, a route's twenty checkpoint
 *  markers pile into one blob and a corridor's few hundred detections
 *  hide the chart, so at those zooms the course line and the two
 *  endpoints are the route. */
export function useZoomLevel(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  return zoom;
}

/** Where the checkpoint markers appear (the planner's selected
 *  checkpoints, and one level further in the scored candidates and
 *  the labeling page's detections, which are many more). Low on
 *  purpose: a phone fits a 300 nm route at zoom 6, and a pilot who
 *  opens a route expects to see its checkpoints. */
export const MARKERS_FROM_ZOOM = 5;
export const CROWD_FROM_ZOOM = 6;
