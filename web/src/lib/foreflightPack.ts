/**
 * The route's checkpoints as a ForeFlight content pack
 * (https://foreflight.com/support/content-packs/): a ZIP of one folder
 * that ForeFlight imports from the share sheet, Files or AirDrop.
 *
 * - `navdata/`: each checkpoint a waypoint, usable in ForeFlight's route
 *   editor and on its map, with a page of its own beside it -- what it
 *   is, how easy it is to spot, the leg flown to it. ForeFlight ties a
 *   page to a waypoint by its file name: the waypoint's name, then the
 *   page's title.
 * - `layers/`: the course line, and each checkpoint's kind and score as
 *   a label on the map.
 *
 * Waypoint names follow ForeFlight's rules: capitals, one word, at least
 * three characters with a letter. Each is the route's ends and its
 * number -- C81DLH01 -- so the packs of two routes never share a name.
 * The .fpl export (lib/flightPlanFiles) names the same points CP01 on,
 * within Garmin's six characters.
 */
import { degreesMinutes } from "./airspace";
import { altFt } from "./units";
import { heading } from "./workings";

export interface PackCheckpoint {
  /** What the nav log calls it: "Town", "Lake". */
  name: string;
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

export interface PackRoute {
  dep: string;
  dest: string;
  stops: string[];
  /** The course, [lat, lon] from the departure. */
  line: [number, number][];
  checkpoints: PackCheckpoint[];
}

/** What to look for, by the chart's kind of thing. */
const LOOK_FOR: Record<string, string> = {
  town: "A town: on the sectional, the yellow of its built-up area.",
  water: "A lake: on the sectional, blue water.",
  river: "A river: on the sectional, a blue line. Note where the course crosses it.",
  road_or_rail: "A road or railway: on the sectional, a line across the course. Note the angle it crosses at.",
  airport: "An airport: look for its runways.",
};

const xml = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** An identifier in a waypoint name: a US airport's K dropped, as a
 *  pilot says it (KDLH, DLH), and anything but letters and digits. */
const short = (ident: string) => {
  const upper = ident.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return upper.length === 4 && upper.startsWith("K") ? upper.slice(1) : upper;
};

/** Each checkpoint's waypoint name, in order: C81DLH01, C81DLH02… */
export function waypointNames(route: PackRoute): string[] {
  const width = Math.max(2, String(route.checkpoints.length).length);
  return route.checkpoints.map((_, i) => `${short(route.dep)}${short(route.dest)}${String(i + 1).padStart(width, "0")}`);
}

/** The line ForeFlight shows beside a waypoint, inside the 30 to 40
 *  characters it shows: "Lake, 3.2/5, 46 nm". */
export function waypointDescription(cp: PackCheckpoint): string {
  return `${cp.name}, ${cp.score.toFixed(1)}/5, ${Math.round(cp.alongNm)} nm`;
}

const routeTitle = (route: PackRoute) => [route.dep, ...route.stops, route.dest].join(" → ");
const elapsed = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;

/** A checkpoint's page: what it is, how easy it is to spot, the leg
 *  flown to it and where it is. HTML, in the .txt ForeFlight reads. */
function page(route: PackRoute, cp: PackCheckpoint, i: number): string {
  const rows: [string, string][] = [
    ["How easy to spot", `${cp.score.toFixed(1)} of 5`],
    ["From " + route.dep, `${cp.alongNm.toFixed(1)} nm`],
    ...(cp.headingDeg != null ? [["Magnetic heading to it", heading(cp.headingDeg)] as [string, string]] : []),
    ...(cp.altitudeFt != null ? [["Altitude", `${altFt(cp.altitudeFt)} ft`] as [string, string]] : []),
    ...(cp.minutesFlown != null ? [["Time from departure", elapsed(cp.minutesFlown)] as [string, string]] : []),
    ["Position", degreesMinutes(cp)],
  ];
  const next = route.checkpoints[i + 1];
  return [
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${xml(cp.name)}</title></head>`,
    `<body style="font-family: -apple-system, sans-serif; font-size: 17px; line-height: 1.4; margin: 16px;">`,
    `<h2 style="margin: 0 0 4px;">${xml(cp.name)}</h2>`,
    `<p style="margin: 0 0 12px; color: #666;">Checkpoint ${i + 1} of ${route.checkpoints.length}, ${xml(routeTitle(route))}</p>`,
    `<p>${xml(LOOK_FOR[cp.category] ?? `${cp.name}.`)}</p>`,
    `<table style="border-collapse: collapse;">`,
    ...rows.map(([k, v]) => `<tr><td style="padding: 4px 16px 4px 0; color: #666;">${xml(k)}</td><td style="padding: 4px 0;">${xml(v)}</td></tr>`),
    `</table>`,
    next ? `<p>Next: ${xml(next.name)}, ${(next.alongNm - cp.alongNm).toFixed(1)} nm on.</p>` : `<p>The last checkpoint before ${xml(route.dest)}.</p>`,
    `<p style="color: #666; font-size: 15px;">How easy to spot is Wingtip Maps' estimate, from a model trained on pilots' ratings of what the sectional shows.</p>`,
    `</body></html>`,
    "",
  ].join("\n");
}

const coordinates = (lat: number, lon: number) => `${lon.toFixed(6)},${lat.toFixed(6)},0`;

/** ForeFlight's date: 20261005T19:45:00Z. */
const stamp = (d: Date) => d.toISOString().replace(/[-]/g, "").replace(/\.\d+Z$/, "Z");

/** Every file in the pack, by its path inside the ZIP. */
export function packFiles(route: PackRoute, created = new Date()): Record<string, string> {
  const names = waypointNames(route);
  const folder = `Wingtip-${short(route.dep)}-${short(route.dest)}`;
  const title = routeTitle(route);
  const files: Record<string, string> = {
    [`${folder}/manifest.json`]: JSON.stringify({
      name: `Wingtip checkpoints ${route.dep}-${route.dest}`,
      abbreviation: `WT.${short(route.dep)}${short(route.dest)}`,
      // Later each time it is made, so ForeFlight takes a new one over the old.
      version: Number(`${created.getUTCFullYear()}${String(created.getUTCMonth() + 1).padStart(2, "0")}${String(created.getUTCDate()).padStart(2, "0")}.${String(created.getUTCHours()).padStart(2, "0")}${String(created.getUTCMinutes()).padStart(2, "0")}`),
      effectiveDate: stamp(created),
      organizationName: "Wingtip Maps",
    }, null, 2),
    [`${folder}/navdata/Checkpoints.kml`]: [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<kml xmlns="http://www.opengis.net/kml/2.2">`,
      `<Document>`,
      `<name>${xml(title)} checkpoints</name>`,
      ...route.checkpoints.map((cp, i) => [
        `<Placemark>`,
        `<name>${names[i]}</name>`,
        `<description>${xml(waypointDescription(cp))}</description>`,
        `<Point><coordinates>${coordinates(cp.lat, cp.lon)}</coordinates></Point>`,
        `</Placemark>`,
      ].join("")),
      `</Document>`,
      `</kml>`,
      "",
    ].join("\n"),
    [`${folder}/layers/${short(route.dep)}-${short(route.dest)} course.kml`]: [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<kml xmlns="http://www.opengis.net/kml/2.2">`,
      `<Document>`,
      `<name>${xml(title)}</name>`,
      // KML's colours run alpha, blue, green, red.
      `<Style id="course"><LineStyle><color>ffff8a1e</color><width>3</width></LineStyle></Style>`,
      `<Style id="label"><IconStyle><scale>0</scale></IconStyle></Style>`,
      `<Placemark><name>${xml(title)}</name><styleUrl>#course</styleUrl><LineString><coordinates>${route.line.map(([lat, lon]) => coordinates(lat, lon)).join(" ")}</coordinates></LineString></Placemark>`,
      ...route.checkpoints.map(cp =>
        `<Placemark><name>${xml(`${cp.name} ${cp.score.toFixed(1)}`)}</name><styleUrl>#label</styleUrl><Point><coordinates>${coordinates(cp.lat, cp.lon)}</coordinates></Point></Placemark>`),
      `</Document>`,
      `</kml>`,
      "",
    ].join("\n"),
  };
  route.checkpoints.forEach((cp, i) => {
    files[`${folder}/navdata/${names[i]}Checkpoint ${i + 1} of ${route.checkpoints.length}, ${cp.name}.txt`] = page(route, cp, i);
  });
  return files;
}

/** The pack, zipped. fflate is loaded only here, off the planner's
 *  first load. Each folder has an entry of its own ahead of its files,
 *  as ForeFlight's sample pack has, and the ZIP is copied into a buffer
 *  of its own, the kind a File takes. */
export async function contentPack(route: PackRoute, created = new Date()): Promise<Uint8Array<ArrayBuffer>> {
  const { strToU8, zipSync } = await import("fflate");
  const files = Object.entries(packFiles(route, created));
  const folders = [...new Set(files.flatMap(([path]) => path.split("/").slice(0, -1).map((_, i, parts) => `${parts.slice(0, i + 1).join("/")}/`)))];
  return new Uint8Array(zipSync(Object.fromEntries([
    ...folders.map(folder => [folder, new Uint8Array(0)] as const),
    ...files.map(([path, text]) => [path, strToU8(text)] as const),
  ])));
}
