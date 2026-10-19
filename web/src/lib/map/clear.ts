import L from "leaflet";

/**
 * The map runs under the panel over it (MapPanel), so "the middle of the
 * map" is the middle of what the panel leaves of it: MapPage sets what
 * the panel covers at rest as CSS variables on the map's own ancestor,
 * and anything that moves the map in a script reads them here.
 */
function insetsOf(map: L.Map): { top: number; bottom: number; left: number } {
  // From the ancestor's own style attribute, where it set them, rather
  // than the container's computed style: that brought the whole page's
  // styles up to date, mid-move, at every pan -- a tenth of a second of
  // a phone's as a nav log row picked moved the map (measured
  // 2026-10-07).
  const holder = map.getContainer().closest<HTMLElement>("[style*='--map-inset-top']");
  const style = holder?.style ?? getComputedStyle(map.getContainer());
  const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
  return { top: px("--map-inset-top"), bottom: px("--map-inset-bottom"), left: px("--map-inset-left") };
}

/** Where to centre the map, at `zoom`, for `point` to sit in the middle
 *  of what the panel leaves of it -- for setView and flyTo. */
export function centreClear(map: L.Map, point: L.LatLngExpression, zoom: number): L.LatLng {
  return map.unproject(map.project(point, zoom).subtract(offsetOf(insetsOf(map))), zoom);
}

/** The map moved for `point` to sit in the middle of what the panel
 *  leaves of it, at the zoom it is at. Not panTo, which goes through
 *  setView and so rounds the zoom to the map's zoomSnap: a route fitted
 *  at a quarter level (MapShell) went to the whole level beside it as a
 *  dry run's airplane was followed, the chart drawn again from nothing,
 *  at the owner's notice ("When tapping play for a dry run, the map
 *  seems to reload"). */
export function panClear(map: L.Map, point: L.LatLngExpression, options?: L.PanOptions) {
  const middle = map.getSize().divideBy(2).add(offsetOf(insetsOf(map)));
  const offset = map.latLngToContainerPoint(point).subtract(middle);
  // Already there, to a couple of points: no pan. Leaflet ends even a
  // pan of nothing with a move, and every layer answers a move -- the
  // lines drawn again, a thousand airport marks merged, the chart's tiles
  // around asked for -- so own ship followed on the ground, or holding
  // still in the air, did all that at every GPS fix.
  if (Math.abs(offset.x) < 2 && Math.abs(offset.y) < 2) return;
  map.panBy(offset, options);
}

/** Before an animated zoom of more than a level: the map's lines and
 *  circles (the overlay pane) put out of sight until it lands. Leaflet
 *  scales them with the chart as it goes, and eight times over a dry
 *  run's start the route's checkpoints were orange blots filling the
 *  screen until the page drew them again. Its marks, which keep their
 *  size, stay. */
export function hideLinesWhileZooming(map: L.Map, to: number) {
  if (Math.abs(to - map.getZoom()) <= 1) return;
  const container = map.getContainer();
  container.classList.add("map-big-zoom");
  map.once("zoomend", () => container.classList.remove("map-big-zoom"));
}

/** The same before there is a map to ask, for the panel's `insets` as
 *  given: the map made where it would be put, on the projection it is
 *  made with (Leaflet's own, Web Mercator). */
export function centreClearFor(point: L.LatLngExpression, zoom: number, insets: { top: number; bottom: number; left: number }): L.LatLng {
  const crs = L.CRS.EPSG3857;
  return crs.pointToLatLng(crs.latLngToPoint(L.latLng(point), zoom).subtract(offsetOf(insets)), zoom);
}

/** How far the middle of what the panel leaves is from the map's own. */
function offsetOf({ top, bottom, left }: { top: number; bottom: number; left: number }): L.Point {
  return L.point(left / 2, (top - bottom) / 2);
}

/** Padding for fitBounds that keeps what is fitted in what the panel
 *  leaves of the map, with `margin` to spare round it. */
export function paddingClear(map: L.Map, margin = 24): L.FitBoundsOptions {
  const { top, bottom, left } = insetsOf(map);
  return { paddingTopLeft: [left + margin, top + margin], paddingBottomRight: [margin, bottom + margin] };
}
