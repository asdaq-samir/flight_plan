/** Great-circle distance and initial bearing on a sphere of the earth's
 *  mean radius -- for a card's "18 nm NE", where a tenth of a mile is
 *  nothing; the planner's own figures (vfr.geo) are on the ellipsoid. */
const EARTH_NM = 3440.065;
/** Degrees to radians, and back: each file that turned a bearing or a
 *  latitude into one wrote its own. */
export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

export type LatLon = { lat: number; lon: number };

export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where a stop at `at` goes in a route's stops so it adds the least
 *  distance: between the two of `points` -- the departure, the stops,
 *  the destination -- it bends the route least between. The index into
 *  the stops. */
export function bestStopIndex(points: LatLon[], at: LatLon): number {
  let best = 0, bestAdded = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const added = distanceNm(points[i]!, at) + distanceNm(at, points[i + 1]!) - distanceNm(points[i]!, points[i + 1]!);
    if (added < bestAdded) [best, bestAdded] = [i, added];
  }
  return best;
}

/** True bearing from `a` to `b`, 0 to 360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** A direction brought into 0 up to 360, whatever sign or size it came
 *  as: -10 is 350, 370 is 10. Eleven files wrote this sum out. */
export const normalizeDeg = (d: number) => ((d % 360) + 360) % 360;

/** How far apart two directions are, 0 to 180: a track off a course, a
 *  wind off a runway, an estimate off its answer round the compass (358
 *  is 4 from 002). It was written eight times, two ways. */
export function angleBetween(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** The turn from one direction to another, -180 to 180, right of it
 *  positive. */
export function signedTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Feet in a nautical mile (1,852 m). */
export const FT_PER_NM = 6076.12;

/** Feet lost for every nautical mile of a descent: three to one, 333
 *  ft/nm, as the nav log descends (vfr.navlog.with_descents) -- a little
 *  steeper than a 3° path's 318 ft/nm (6,076 × tan 3°), the angle a VASI
 *  is normally set at (AIM 2-1-2). It was named FT_PER_NM
 *  too, beside the 6,076 of a nautical mile. */
export const DESCENT_FT_PER_NM = 1000 / 3;

/** Where a great circle from `a` on a true bearing reaches `nm` out. */
export function destination(a: LatLon, bearing: number, nm: number): LatLon {
  const d = nm / EARTH_NM, b = rad(bearing), lat1 = rad(a.lat), lon1 = rad(a.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}
