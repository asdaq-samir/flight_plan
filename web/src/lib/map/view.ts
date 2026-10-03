import type L from "leaflet";

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
