import { bearingDeg, distanceNm, type LatLon } from "./geo";
import { compassPoint } from "./compass";
import { nmAway } from "./useAway";

/** An area's outlines as GeoJSON gives a polygon's or a multipolygon's
 *  coordinates, [lon, lat]: each polygon's rings, its outside first. */
export type Rings = number[][][];

/** Every polygon's outside ring, from a Polygon's or a MultiPolygon's
 *  coordinates. */
export function outsides(geometry: { type?: string; coordinates?: unknown }): Rings {
  const c = geometry.coordinates as number[][][] | number[][][][] | undefined;
  if (!c?.length) return [];
  return geometry.type === "Polygon" ? [(c as number[][][])[0]!] : (c as number[][][][]).map(polygon => polygon[0]!).filter(Boolean);
}

/** Whether a point is inside a ring, by the crossings of a ray east of it
 *  (in degrees: a TFR's few miles are flat enough). */
function inside(ring: number[][], at: LatLon): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi! > at.lat) !== (yj! > at.lat) && at.lon < ((xj! - xi!) * (at.lat - yi!)) / (yj! - yi!) + xi!) hit = !hit;
  }
  return hit;
}

export const insideAny = (rings: Rings, at: LatLon) => rings.some(ring => inside(ring, at));

function crosses(a: LatLon, b: LatLon, c: number[], d: number[]): boolean {
  const o = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const p1 = { x: a.lon, y: a.lat }, p2 = { x: b.lon, y: b.lat }, p3 = { x: c[0]!, y: c[1]! }, p4 = { x: d[0]!, y: d[1]! };
  return o(p1, p2, p3) !== o(p1, p2, p4) && o(p3, p4, p1) !== o(p3, p4, p2);
}

/** Whether a route's line, [lat, lon] points in order, goes into the
 *  area: a point of it inside, or a leg across its edge. */
export function lineEnters(rings: Rings, line: readonly (readonly [number, number])[]): boolean {
  const points = line.map(([lat, lon]) => ({ lat, lon }));
  if (points.some(p => insideAny(rings, p))) return true;
  for (let k = 1; k < points.length; k++) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) if (crosses(points[k - 1]!, points[k]!, ring[i - 1]!, ring[i]!)) return true;
    }
  }
  return false;
}

/** Where the area is from the airplane: "Inside it" or how far and which
 *  way its nearest corner is ("12 nm NE"). */
export function areaFrom(rings: Rings, at: LatLon): string | null {
  if (!rings.length) return null;
  if (insideAny(rings, at)) return "You are inside it";
  let best: { nm: number; to: LatLon } | null = null;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      const to = { lat: lat!, lon: lon! };
      const nm = distanceNm(at, to);
      if (!best || nm < best.nm) best = { nm, to };
    }
  }
  return best ? `${nmAway(best.nm)} ${compassPoint(bearingDeg(at, best.to))} of you` : null;
}
