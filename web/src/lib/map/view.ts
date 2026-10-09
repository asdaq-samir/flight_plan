import L from "leaflet";

/** A pointer that hovers: a name shows under it. A finger's tap is the
 *  card's, not a tooltip's. */
export const hovers = typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;

/** The view as a box on a half-degree grid, rounded outward: a pan of a
 *  few miles asks the planner for the same box again, which is cached. */
export function boxOf(map: L.Map) {
  const b = map.getBounds();
  const out = (v: number, up: boolean) => (up ? Math.ceil(v * 2) : Math.floor(v * 2)) / 2;
  const box = { south: out(b.getSouth(), false), west: out(b.getWest(), false), north: out(b.getNorth(), true), east: out(b.getEast(), true) };
  return { box, zoom: map.getZoom(), key: `${box.south},${box.west},${box.north},${box.east}` };
}

/** A grid box, as boxOf's, and its key. */
export type Box = { box: { south: number; west: number; north: number; east: number }; key: string };

/** Where the view will be once a zoom under way has eased in: its bounds
 *  at the zoom's target (Leaflet's zoomanim gives the centre and zoom). */
export function boundsAt(map: L.Map, center: L.LatLng, zoom: number): L.LatLngBounds {
  const half = map.getSize().divideBy(2);
  const middle = map.project(center, zoom);
  return L.latLngBounds(map.unproject(middle.subtract(half), zoom), map.unproject(middle.add(half), zoom));
}

/** The view and as much again on every side -- a flick of a finger's
 *  pan, about a screen -- on the half-degree grid, rounded outward: asked
 *  for once, a pan or a zoom in that stays inside it is answered already,
 *  the marks there as the map stops. */
export function aheadOf(bounds: L.LatLngBounds): Box {
  const dLat = bounds.getNorth() - bounds.getSouth(), dLon = bounds.getEast() - bounds.getWest();
  const out = (v: number, up: boolean) => (up ? Math.ceil(v * 2) : Math.floor(v * 2)) / 2;
  const box = {
    south: Math.max(-90, out(bounds.getSouth() - dLat, false)), west: Math.max(-180, out(bounds.getWest() - dLon, false)),
    north: Math.min(90, out(bounds.getNorth() + dLat, true)), east: Math.min(180, out(bounds.getEast() + dLon, true)),
  };
  return { box, key: `${box.south},${box.west},${box.north},${box.east}` };
}

/** Whether a box already asked for still does for the bounds: they lie
 *  inside it, and it is not much bigger than they would ask for now --
 *  zoomed in from a whole state, the state's thousand fields were kept,
 *  and drawn. */
export function within(bounds: L.LatLngBounds, { box }: Box): boolean {
  const inside = bounds.getSouth() >= box.south && bounds.getWest() >= box.west && bounds.getNorth() <= box.north && bounds.getEast() <= box.east;
  const wanted = aheadOf(bounds).box;
  return inside && box.north - box.south <= 3 * (wanted.north - wanted.south);
}
