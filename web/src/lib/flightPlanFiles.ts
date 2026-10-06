/**
 * The route as a file another app or the panel's GPS opens: a Garmin
 * flight plan (.fpl, the FlightPlan v1 schema ForeFlight, Garmin Pilot
 * and Garmin's navigators import) and a GPX route, for anything else.
 *
 * Airports go by their identifiers, a VFR waypoint as the fix it is
 * (Garmin's INT-VRP); a checkpoint, which no database knows, as a user
 * waypoint at its place, named CP01 on -- Garmin takes six letters and
 * digits at most -- with its own name as the comment.
 */

export interface PlanPoint {
  ident: string;
  /** What the log calls it: the airport's name, the checkpoint's. */
  name: string;
  kind: "airport" | "fix" | "checkpoint";
  lat: number;
  lon: number;
}

function xml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Each point's identifier and Garmin type: checkpoints numbered CP01 on. */
function identified(points: PlanPoint[]) {
  let checkpoint = 0;
  return points.map(p => {
    if (p.kind !== "checkpoint") return { ...p, id: p.ident.toUpperCase(), type: p.kind === "fix" ? "INT-VRP" : "AIRPORT" };
    checkpoint += 1;
    return { ...p, id: `CP${String(checkpoint).padStart(2, "0")}`, type: "USER WAYPOINT" };
  });
}

const coordinate = (n: number) => n.toFixed(6);

/** A Garmin flight plan: each point once in its table, then the route
 *  through them in order. */
export function fplOf(points: PlanPoint[], name: string, created = new Date()): string {
  const named = identified(points);
  const table = [...new Map(named.map(p => [`${p.type}:${p.id}`, p])).values()];
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">`,
    `  <created>${created.toISOString().replace(/\.\d+Z$/, "Z")}</created>`,
    `  <waypoint-table>`,
    ...table.map(p => [
      `    <waypoint>`,
      `      <identifier>${xml(p.id)}</identifier>`,
      `      <type>${p.type}</type>`,
      `      <country-code></country-code>`,
      `      <lat>${coordinate(p.lat)}</lat>`,
      `      <lon>${coordinate(p.lon)}</lon>`,
      `      <comment>${xml(p.name.toUpperCase().slice(0, 25))}</comment>`,
      `    </waypoint>`,
    ].join("\n")),
    `  </waypoint-table>`,
    `  <route>`,
    `    <route-name>${xml(name.toUpperCase().slice(0, 25))}</route-name>`,
    `    <flight-plan-index>1</flight-plan-index>`,
    ...named.map(p => [
      `    <route-point>`,
      `      <waypoint-identifier>${xml(p.id)}</waypoint-identifier>`,
      `      <waypoint-type>${p.type}</waypoint-type>`,
      `      <waypoint-country-code></waypoint-country-code>`,
      `    </route-point>`,
    ].join("\n")),
    `  </route>`,
    `</flight-plan>`,
    "",
  ].join("\n");
}

/** ForeFlight's own link to the route (https://foreflight.com/support/app-urls/):
 *  it opens ForeFlight on its map with the flight plan filled in, airports
 *  and fixes by identifier and each checkpoint at its place, as ForeFlight
 *  writes a position in a route (42.3700/-88.0800), then the altitude where
 *  the plan has one. Nothing to download: the route is the link. */
export function foreflightRoute(points: PlanPoint[], altitudeFt?: number | null): string {
  const tokens = points.map(p => (p.kind === "checkpoint" ? `${p.lat.toFixed(4)}/${p.lon.toFixed(4)}` : p.ident.toUpperCase()));
  if (altitudeFt) tokens.push(`${Math.round(altitudeFt)}ft`);
  return `foreflightmobile://maps/search?q=${tokens.join("+")}`;
}

/** A GPX 1.1 route through the points, each named as in the .fpl. */
export function gpxOf(points: PlanPoint[], name: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="Wingtip Maps" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <rte>`,
    `    <name>${xml(name)}</name>`,
    ...identified(points).map(p =>
      `    <rtept lat="${coordinate(p.lat)}" lon="${coordinate(p.lon)}"><name>${xml(p.id)}</name><desc>${xml(p.name)}</desc></rtept>`),
    `  </rte>`,
    `</gpx>`,
    "",
  ].join("\n");
}

/** A file to the share sheet where the browser can share one (Safari on
 *  an iPhone: "Open in ForeFlight"), otherwise downloaded. */
export async function shareFile(fileName: string, type: string, text: string): Promise<void> {
  const file = new File([text], fileName, { type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: fileName });
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
