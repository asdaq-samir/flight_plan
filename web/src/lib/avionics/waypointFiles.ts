import { garminText, namedPoints, type PlanPoint } from "./points";

/**
 * The route's checkpoints as a panel's own user waypoints, named as the
 * flight plan files name them (namedPoints), so a plan imported after
 * them finds them by name.
 */

/** A GTN's user.wpt, for the SD card's root (190-01007-F0 section 3): a
 *  row a waypoint, its name (six characters the GTN keeps), its comment
 *  (25 of capitals, figures, spaces and "/"), its latitude and longitude
 *  in decimal degrees, west and south negative; a carriage return after
 *  each longitude. */
export function gtnUserWaypointsOf(points: PlanPoint[]): string {
  const rows = namedPoints(points).filter(p => p.type === "USER WAYPOINT");
  return [...new Map(rows.map(p => [p.id, p])).values()]
    .map(p => `${p.id},${garminText(p.name)},${p.lat.toFixed(6)},${p.lon.toFixed(6)}\r\n`).join("");
}

/** Dynon's header line, word for word: the first line of a SkyView user
 *  waypoint file, not a waypoint (SkyView HDX Pilot's User Guide Rev J,
 *  5-68 and 5-69). */
export const DYNON_HEADER = "Short Name, Long Name, Latitude, Longitude, Altitude, Icon, Narrative Text, Dynon User Waypoints File v1.0,";

/** A SkyView's user waypoints (.csv, on a USB stick): a short name of up
 *  to 8 capitals and figures, a long name of up to 22, the place in
 *  decimal degrees, no altitude, a pin for its icon, and the checkpoint's
 *  own name as its remarks, in quotes as a comma in it needs. */
export function dynonUserWaypointsOf(points: PlanPoint[]): string {
  const rows = namedPoints(points).filter(p => p.type === "USER WAYPOINT");
  return [DYNON_HEADER, ...[...new Map(rows.map(p => [p.id, p])).values()].map(p => [
    p.id.slice(0, 8),
    garminText(p.name, 22).replace(/\//g, " ").trim(),
    p.lat.toFixed(6),
    p.lon.toFixed(6),
    "",
    "PIN_BLUE",
    `"${p.name.replace(/"/g, "'")}"`,
  ].join(","))].join("\r\n") + "\r\n";
}

function xml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** A GPX 1.1 route, the one a SkyView (its first route's first 99 points,
 *  5-47), an aera and MGL import: each point named as the .fpl names it,
 *  every point written, the panel reading what it can. */
export function gpxOf(points: PlanPoint[], name: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="Wingtip Maps" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <rte>`,
    `    <name>${xml(name)}</name>`,
    ...namedPoints(points).map(p =>
      `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${xml(p.id)}</name><desc>${xml(p.name)}</desc></rtept>`),
    `  </rte>`,
    `</gpx>`,
    "",
  ].join("\n");
}
