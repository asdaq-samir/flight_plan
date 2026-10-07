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
  const { top, bottom, left } = insetsOf(map);
  const offset = L.point(left / 2, (top - bottom) / 2);
  return map.unproject(map.project(point, zoom).subtract(offset), zoom);
}
