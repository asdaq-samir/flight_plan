/**
 * The route's checkpoints for ForeFlight. The planner builds the content
 * pack (planning-service app/foreflight.py) at an address that carries
 * the checkpoints as the nav log has them, so ForeFlight can fetch it
 * itself from an Open in ForeFlight link
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

/** The pack's address on this server: each checkpoint
 *  `lat,lon,kind,score,along,heading,altitude,minutes`, `~` between them. */
export function packPath(dep: string, dest: string, stops: string[], checkpoints: PackCheckpoint[]): string {
  const cp = checkpoints.map(c => [
    figure(c.lat, 5), figure(c.lon, 5), c.category, figure(c.score, 2), figure(c.alongNm, 1),
    figure(c.headingDeg, 0), figure(c.altitudeFt, 0), figure(c.minutesFlown, 1),
  ].join(",")).join("~");
  const query = new URLSearchParams({ dep, dest, ...(stops.length ? { stops: stops.join(",") } : {}), cp });
  return `/api/planner/foreflight-pack?${query}`;
}

/** ForeFlight's own link for a pack at `packUrl` (a whole address it can
 *  reach): on a device with ForeFlight, it opens there and downloads it. */
export function openInForeFlight(packUrl: string): string {
  return `https://foreflight.com/content?downloadURL=${encodeURIComponent(packUrl)}`;
}
