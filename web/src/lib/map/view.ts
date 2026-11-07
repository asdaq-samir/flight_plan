/** A pointer that hovers: a name shows under it. A finger's tap is the
 *  card's, not a tooltip's. */
export const hovers = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;

/** The map's view as its four edges: MapLibre's LngLatBounds, or any
 *  bounds that says them. */
export type Bounds = { getSouth(): number; getWest(): number; getNorth(): number; getEast(): number };

/** A grid box, on the half-degree grid rounded outward, and its key: the
 *  planner's questions for the view (useGlView), cached by it. */
export type Box = { box: { south: number; west: number; north: number; east: number }; key: string };

/** The view and as much again on every side -- a flick of a finger's
 *  pan, about a screen -- on the half-degree grid, rounded outward: asked
 *  for once, a pan or a zoom in that stays inside it is answered already,
 *  the marks there as the map stops. */
export function aheadOf(bounds: Bounds): Box {
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
export function within(bounds: Bounds, { box }: Box): boolean {
  const inside = bounds.getSouth() >= box.south && bounds.getWest() >= box.west && bounds.getNorth() <= box.north && bounds.getEast() <= box.east;
  const wanted = aheadOf(bounds).box;
  return inside && box.north - box.south <= 3 * (wanted.north - wanted.south);
}
