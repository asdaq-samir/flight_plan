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
function positionOf(value: string | null | undefined): string {
  const point = (value ?? "").trim();
  return /^@-?\d{1,2}(\.\d{1,6})?,-?\d{1,3}(\.\d{1,6})?(,\d{1,5})?$/.test(point) ? point : "";
}

/** A present position as a route's departure, for Fly Here's Direct-To:
 *  "@42.3246,-88.0741", and the GPS's altitude where it gives one --
 *  ",3500", feet MSL, to the hundred, so the planner climbs from where
 *  the airplane is (its app.common.position_of) and a few feet of drift
 *  are not a new route to plan. */
export function positionIdent(fix: { lat: number; lon: number; altitudeFt?: number | null }): string {
  const at = `@${fix.lat.toFixed(4)},${fix.lon.toFixed(4)}`;
  return fix.altitudeFt == null || fix.altitudeFt < 0 ? at : `${at},${Math.round(fix.altitudeFt / 100) * 100}`;
}

/** A present position without its altitude: where a flight saved from
 *  one starts (the webapp keeps the place, not a moment's altitude). */
export const withoutAltitude = (ident: string) => (isPosition(ident) ? ident.split(",").slice(0, 2).join(",") : ident);

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
  dep && dep === dest && stops.length === 0 ? `${pointName(dep)} local` : [dep, ...stops, dest].map(pointName).join(ARROW);

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

/** Minutes on the ground at the route's stops, from the address's
 *  `ground` ("KJVL:45"): whole minutes, none to a day, by the stop's
 *  ident (the planner's PlanQuery.ground). Written back by altitudesParam,
 *  the same "IDENT:NUMBER" pairs. */
export function groundOf(value: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (value ?? "").split(",")) {
    const [ident, minutes] = part.split(":");
    const point = stopOf(ident), min = Number(minutes);
    if (point && minutes !== "" && Number.isInteger(min) && min >= 0 && min <= 24 * 60) out[point] = min;
  }
  return out;
}

/** And back, for the address: "" with none. */
export const altitudesParam = (altitudes: Record<string, number>) =>
  Object.entries(altitudes).map(([ident, ft]) => `${ident}:${ft}`).join(",");

/** An airway as a route's stop, "V100" or "T254" (the planner's
 *  vfr.airways): flown fix by fix between the stops either side of it. By
 *  its form, as the planner first reads it -- an airport whose identifier
 *  has the same form the course names as one. */
export const isAirwayToken = (ident: string) => /^[VTJQ]\d{1,4}$/.test(ident);
