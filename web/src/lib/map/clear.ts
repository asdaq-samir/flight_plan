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
