/** Leaflet's Web Mercator's last latitude (L.Projection.SphericalMercator),
 *  where it clamps the poles. */
const MAX_LATITUDE = 85.0511287798;
const RADIANS = Math.PI / 180;

/**
 * A place's x and y in the map's own pixels at zoom 0, where at zoom z it
 * is these times 2^z: map.project([lat, lon], 0) for the map's CRS,
 * Leaflet's default EPSG:3857 (its SphericalMercator scaled by its
 * transformation to a 256-pixel world), worked out by arithmetic. Leaflet
 * makes a LatLng and two Points for each place it projects, and the
 * airspace's volumes were projected a point at a time, a few thousand
 * points with each new box's answer, for their lines and for where their
 * altitudes lie on them: some 30 ms of the main thread through a zoom on
 * the phone viewport at CPU 4x (a profile, 2026-11-04; the owner, "make it
 * fast but stable"). mercator.test holds it to map.project.
 */
export function zoomZeroX(lon: number): number {
  return 256 * (lon / 360 + 0.5);
}

export function zoomZeroY(lat: number): number {
  const sin = Math.sin(Math.max(Math.min(MAX_LATITUDE, lat), -MAX_LATITUDE) * RADIANS);
  return 256 * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI));
}
