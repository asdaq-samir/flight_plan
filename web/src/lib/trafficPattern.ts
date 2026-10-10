/**
 * A runway's traffic pattern on the map, picked by the pilot for a field
 * of the route (the route's Procedures): the rectangle flown round the
 * runway for the end landed on, the side its traffic is flown on, and the
 * 45° entry to the downwind abeam midfield -- as the FAA's Airplane
 * Flying Handbook (FAA-H-8083-3, "Airport Traffic Patterns") and AC
 * 90-66C draw it:
 *
 * - the downwind "approximately 1/2 to 1 mile out from the landing
 *   runway" -- drawn at three-quarters of a statute mile;
 * - the turn to base "approximately 45° from the approach end of the
 *   runway" -- abeam it 45° back, so as far past the threshold as the
 *   downwind is out;
 * - the crosswind "beyond the departure end of the runway within 300 feet
 *   of pattern altitude" -- where that is depends on the climb, so drawn
 *   as far past the departure end as the downwind is out, a rectangle;
 * - the pattern "entered at a 45° angle to the downwind leg" abeam
 *   midfield (AIM 4-3-3, AC 90-66C 11.3), from the pattern's side;
 * - left traffic unless the FAA says right (14 CFR 91.126(b)(1)),
 *   lib/pattern's patternSideDeg.
 *
 * A sketch of the pattern to fly by, not a procedure: the size of a
 * pattern is the pilot's, flown as the field and its traffic need.
 */
import type { Runway } from "./api/types";
import { bearingDeg, destination, distanceNm, type LatLon } from "./geo";
import { patternSideDeg, runwayNumber, type RunwayEnd } from "./pattern";

/** Three-quarters of a statute mile, in nautical miles: the middle of the
 *  handbook's half a mile to a mile for the downwind's distance out. */
export const DOWNWIND_NM = 0.75 * 0.868976;
/** How far out the 45° entry is drawn from where it joins the downwind. */
const ENTRY_NM = 1.2;

export type LegName = "Upwind" | "Crosswind" | "Downwind" | "Base" | "Final";

export interface TrafficPattern {
  ident: string;
  /** The end landed on, as painted: "27", "9L". */
  runway: string;
  traffic: "left" | "right";
  /** The pattern's altitude, MSL, where it is known. */
  altitudeFt: number | null;
  /** The legs in the order flown, each from its start to its end. */
  legs: { name: LegName; from: LatLon; to: LatLon }[];
  /** The 45° entry: from out on the pattern's side to the downwind abeam
   *  midfield. */
  entry: { from: LatLon; to: LatLon };
}

/** A runway end's threshold, where the FAA or OurAirports has it. */
const at = (end: RunwayEnd | undefined): LatLon | null =>
  end && end.lat != null && end.lon != null ? { lat: end.lat, lon: end.lon } : null;

/**
 * The pattern for landing on `endIdent` of `runway`, or null where its
 * threshold or heading is not known (the other end's place is taken from
 * the runway's length where it alone is missing).
 */
export function trafficPattern(ident: string, runway: Runway, endIdent: string, altitudeFt: number | null): TrafficPattern | null {
  const ends = runway.runway_ends ?? [];
  const end = ends.find(e => e.ident === endIdent);
  const threshold = at(end);
  // A closed runway is not listed, so a stale link must not draw it.
  if (runway.closed || !end || !threshold || end.heading_true_deg == null) return null;
  const other = ends.find(e => e !== end);
  const heading = end.heading_true_deg;
  const far = at(other) ?? (runway.length_ft ? destination(threshold, heading, runway.length_ft / 6076.12) : null);
  if (!far) return null;
  // Along the runway as it is laid, not its painted heading, where both
  // ends are known.
  const along = at(other) ? bearingDeg(threshold, far) : heading;
  const back = (along + 180) % 360;
  const side = patternSideDeg({ ...end, heading_true_deg: along });
  // The corners: the final's start on the extended centre line before the
  // threshold, the upwind's end past the departure end, and the downwind's
  // two ends abeam them.
  const finalStart = destination(threshold, back, DOWNWIND_NM);
  const upwindEnd = destination(far, along, DOWNWIND_NM);
  const crosswindEnd = destination(upwindEnd, side, DOWNWIND_NM);
  const downwindEnd = destination(finalStart, side, DOWNWIND_NM);
  const midfield = destination(destination(threshold, along, distanceNm(threshold, far) / 2), side, DOWNWIND_NM);
  // From out on the pattern's side, behind the downwind's direction: the
  // bisector of the landing direction and the pattern's side.
  const turn = ((side - along + 540) % 360) - 180;
  const entryFrom = destination(midfield, (along + turn / 2 + 360) % 360, ENTRY_NM);
  return {
    ident, runway: runwayNumber(end.ident), traffic: end.traffic, altitudeFt,
    legs: [
      { name: "Upwind", from: far, to: upwindEnd },
      { name: "Crosswind", from: upwindEnd, to: crosswindEnd },
      { name: "Downwind", from: crosswindEnd, to: downwindEnd },
      { name: "Base", from: downwindEnd, to: finalStart },
      { name: "Final", from: finalStart, to: threshold },
    ],
    entry: { from: entryFrom, to: midfield },
  };
}

/** The patterns picked, by field, from the address: "KDLH:27,C81:24". */
export function patternsOf(param: string | null): Map<string, string> {
  const picked = new Map<string, string>();
  for (const part of (param ?? "").split(",")) {
    const [ident, end] = part.split(":").map(s => s.trim().toUpperCase());
    if (ident && end && /^[A-Z0-9]{2,5}$/.test(ident) && /^\d{1,2}[LCR]?$|^[NSEW]{1,2}$/.test(end)) picked.set(ident, end);
  }
  return picked;
}

/** The address's form of the patterns picked; empty for none. */
export function patternsParam(picked: Map<string, string>): string {
  return [...picked].map(([ident, end]) => `${ident}:${end}`).join(",");
}
