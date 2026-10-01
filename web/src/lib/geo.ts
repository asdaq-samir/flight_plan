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

/** True bearing from `a` to `b`, 0 to 360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
