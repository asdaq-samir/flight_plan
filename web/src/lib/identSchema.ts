import { degreesMinutes } from "./coords";

/** An airport ident, normalized (trimmed, uppercased) and shape-checked
 *  -- the same 3-4 alphanumeric character rule springboot-app's own
 *  SaveFlightRequest already enforces server-side. Every dep/dest form
 *  in this app (Plan and Train) used to hand-copy
 *  its own trim/uppercase/empty-check; this is the one place that
 *  logic lives now. "" for anything that doesn't fit -- callers treat
 *  that the same way they treated an empty string before: don't submit.
 *
 *  A regular expression rather than a zod schema: this module is on the
 *  first load (main.tsx reads the address with it), and zod was 75 KB
 *  of the entry chunk for two patterns. The account forms keep zod, on
 *  the console's own chunk.
 */
export function identOf(value: string | null | undefined): string {
  return normalized(value, /^[A-Z0-9]{3,4}$/);
}

/** A stop's ident: an airport's, or a named fix's -- a VFR waypoint
 *  (VPBNG), a GPS waypoint -- two to five letters and digits; or "". */
export function stopOf(value: string | null | undefined): string {
  return normalized(value, /^[A-Z0-9]{2,5}$/);
}

/** A present position as a route's departure, "@42.3246,-88.0741" (the
 *  planner's app.common.position_of): Fly Here's Direct-To from where the
 *  airplane is; or "". */
export function positionOf(value: string | null | undefined): string {
  const point = (value ?? "").trim();
  return /^@-?\d{1,2}(\.\d{1,6})?,-?\d{1,3}(\.\d{1,6})?$/.test(point) ? point : "";
}

/** Whether a route's point is a present position (positionOf). */
export const isPosition = (ident: string) => ident.startsWith("@");

/** A route's departure: an airport, or a present position. */
export function departureOf(value: string | null | undefined): string {
  return identOf(value) || positionOf(value);
}

/** A point's name as the route shows it: a present position by its
 *  coordinates, as a GPS writes them ("N42°19.5′ W088°04.4′"), at the
 *  pilot's ask -- it read "Here". */
export function pointName(ident: string): string {
  if (!isPosition(ident)) return ident;
  const [lat, lon] = ident.slice(1).split(",").map(Number);
  return degreesMinutes({ lat: lat!, lon: lon! });
}

function normalized(value: string | null | undefined, shape: RegExp): string {
  const ident = (value ?? "").trim().toUpperCase();
  return shape.test(ident) ? ident : "";
}

/** The stops a route makes on the way, from the address's `stops`
 *  ("KDSM,VPBNG"): each a valid ident, in order. */
export function stopsOf(value: string | null | undefined): string[] {
  return (value ?? "").split(",").map(stopOf).filter(Boolean);
}

/** The most stops a route makes: the planner's own limit (MAX_STOPS). */
export const MAX_STOPS = 8;

/** A route the planner can plan, or null: both ends valid idents, and no
 *  airport straight after itself -- a route from an airport to itself is
 *  a round trip once it lands somewhere between. Plan's and Train's forms
 *  and hooks each used to decide this for themselves, three different
 *  ways -- Train's form let a same-airport route through, and its chart
 *  read then asked for that corridor. */
export function routeOf(
  dep: string | null | undefined, dest: string | null | undefined, stops: string[] = [],
): { dep: string; dest: string } | null {
  const d = departureOf(dep), a = identOf(dest);
  if (!d || !a) return null;
  const idents = [d, ...stops, a];
  return idents.every((ident, i) => i === 0 || ident !== idents[i - 1]) ? { dep: d, dest: a } : null;
}

const ARROW = " → ";

/** "C81 → KMSN → KDLH": a route's airports in order, as the capsule and a
 *  saved flight name it. */
export const routeName = (dep: string, dest: string, stops: string[] = []) =>
  // A local flight, one airport to itself: "KDLH local". A present
  // position by its coordinates (pointName).
  dep && dep === dest && stops.length === 0 ? `${dep} local` : [dep, ...stops, dest].map(pointName).join(ARROW);

/** A route's name (routeName) cut short in its middle where it is too long
 *  for its line: the departure, as many stops as `fits`, then "…" and the
 *  destination -- "C81 → KHIB → … → KMSN" -- where a cut at the end left
 *  the destination off ("C81 → KHIB → JIXAB → ..."). Whole idents, never
 *  part of one; with no room even for "C81 → … → KMSN", that. */
export function routeNameWithin(name: string, fits: (shown: string) => boolean): string {
  const points = name.split(ARROW);
  if (points.length < 3 || fits(name)) return name;
  const [dep, dest] = [points[0], points[points.length - 1]];
  for (let kept = points.length - 3; kept > 0; kept--) {
    const shown = [dep, ...points.slice(1, 1 + kept), "…", dest].join(ARROW);
    if (fits(shown)) return shown;
  }
  return [dep, "…", dest].join(ARROW);
}


/** Points' own altitudes from the address, feet by ident -- "VPBNG:4500,
 *  KMSN:1900": a waypoint's flown to it, an airport's its pattern (the
 *  planner's `altitudes`). What is not one is left out. */
export function altitudesOf(value: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (value ?? "").split(",")) {
    const [ident, feet] = part.split(":");
    const point = stopOf(ident), ft = Number(feet);
    if (point && Number.isInteger(ft) && ft > 0 && ft < 18_000) out[point] = ft;
  }
  return out;
}

/** And back, for the address: "" with none. */
export const altitudesParam = (altitudes: Record<string, number>) =>
  Object.entries(altitudes).map(([ident, ft]) => `${ident}:${ft}`).join(",");
