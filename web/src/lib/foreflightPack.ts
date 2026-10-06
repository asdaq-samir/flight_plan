/**
 * The route's checkpoints for ForeFlight. The planner builds the content
 * pack (planning-service app/foreflight.py) at an address that carries
 * the checkpoints as the nav log has them -- as a token in the path, the
 * address ending in the pack's file name, which ForeFlight names its
 * download by -- so ForeFlight can fetch it itself from an Open in
 * ForeFlight link
 * (https://foreflight.com/support/content-packs/: content?downloadURL=),
 * and a browser can download it to Files, from where ForeFlight imports
 * it too. It was built here, zipped in the browser and handed to the
 * share sheet, which does not offer ForeFlight for a ZIP.
 */

export interface PackCheckpoint {
  /** The chart's kind: water, town, river, road_or_rail, airport. */
  category: string;
  lat: number;
  lon: number;
  /** How easy it is to spot, 0 to 5: the chart model's score. */
  score: number;
  /** Miles from the departure, along the whole route. */
  alongNm: number;
  /** The leg flown to it, where the nav log has worked one out. */
  headingDeg?: number | null;
  altitudeFt?: number | null;
  minutesFlown?: number | null;
}

const figure = (value: number | null | undefined, digits: number) => (value == null ? "" : String(Number(value.toFixed(digits))));

/** The pack's address on this server: the route and each checkpoint,
 *  `lat,lon,kind,score,along,heading,altitude,minutes` with `~` between
 *  them, as a query, base64url in one path segment (the planner's
 *  foreflight.token); then the pack's name, KORD-KDLH-checkpoints.zip. */
export function packPath(dep: string, dest: string, stops: string[], checkpoints: PackCheckpoint[]): string {
  const cp = checkpoints.map(c => [
    figure(c.lat, 5), figure(c.lon, 5), c.category, figure(c.score, 2), figure(c.alongNm, 1),
    figure(c.headingDeg, 0), figure(c.altitudeFt, 0), figure(c.minutesFlown, 1),
  ].join(",")).join("~");
  const query = new URLSearchParams({ dep, dest, stops: stops.join(","), cp }).toString();
  const token = btoa(query).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `/api/planner/foreflight-pack/${token}/${[dep, ...stops, dest].join("-")}-checkpoints.zip`;
}

/** Where ForeFlight fetches the pack from: this page's own origin, but on
 *  the local stack's HTTPS port (8443) the plain port beside it (8080).
 *  That port's certificate is the Mac's own authority's, which ForeFlight
 *  would not take: it came to the port in plain HTTP, which TLS refuses.
 *  The planner leaves the pack on plain http for it (SecurityConfig). */
export function packOrigin(location: Pick<Location, "protocol" | "hostname" | "port" | "origin">): string {
  return location.protocol === "https:" && location.port === "8443" ? `http://${location.hostname}:8080` : location.origin;
}

/** ForeFlight's own link for a pack at `packUrl` (a whole address it can
 *  reach): on a device with ForeFlight, it opens there and downloads it. */
export function openInForeFlight(packUrl: string): string {
  return `https://foreflight.com/content?downloadURL=${encodeURIComponent(packUrl)}`;
}
