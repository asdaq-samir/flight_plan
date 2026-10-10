/** Great-circle distance and initial bearing on a sphere of the earth's
 *  mean radius -- for a card's "18 nm NE", where a tenth of a mile is
 *  nothing; the planner's own figures (vfr.geo) are on the ellipsoid. */
const EARTH_NM = 3440.065;
const rad = (deg: number) => (deg * Math.PI) / 180;

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
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Where a great circle from `a` on a true bearing reaches `nm` out. */
export function destination(a: LatLon, bearing: number, nm: number): LatLon {
  const d = nm / EARTH_NM, b = rad(bearing), lat1 = rad(a.lat), lon1 = rad(a.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI) + 540) % 360) - 180 };
}
