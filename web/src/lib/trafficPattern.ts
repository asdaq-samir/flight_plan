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
 *
 * Drawn by the shared engine (native/crates/brief/src/runway/circuit.rs,
 * through lib/engine), from the very corners the planner flies the
 * pattern by (wingtip.pattern) and the phones draw it from: the legs and
 * their sources live there. Only the shapes the map reads are made here.
 */
import type { Runway } from "./api/types";
import { callEngine, type EngineAnswer } from "./engine/engine";
import type { LatLon } from "./geo";
import { isFixIdent } from "./identSchema";

export type LegName = "Upwind" | "Crosswind" | "Downwind" | "Base" | "Final";

export interface TrafficPattern {
  /** Round the runway to land on it, or off it and out of the pattern
   *  (departurePattern). */
  kind: "arrival" | "departure";
  ident: string;
  /** The end landed on, as painted: "27", "9L". */
  runway: string;
  traffic: "left" | "right";
  /** The pattern's altitude, MSL, where it is known. */
  altitudeFt: number | null;
  /** The legs in the order flown, each from its start to its end. */
  legs: { name: LegName; from: LatLon; to: LatLon }[];
  /** The 45° entry: from out on the pattern's side to the downwind abeam
   *  midfield; leaving, the exit from the upwind's end, its name the way
   *  it goes. */
  entry: { from: LatLon; to: LatLon; name: string };
}

// The engine says the traffic its end was given back as it was given: the
// planner's runway ends are "left" or "right", so the drawing's is too.
const drawn = (d: EngineAnswer<"traffic_pattern">): TrafficPattern | null =>
  d && {
    kind: d.kind, ident: d.ident, runway: d.runway, traffic: d.traffic === "right" ? "right" : "left", altitudeFt: d.altitude_ft, legs: d.legs,
    entry: d.entry,
  };

/** The runway as the engine reads it: its length and its ends. */
const runwayOf = (runway: Runway) => ({ length_ft: runway.length_ft ?? null, runway_ends: runway.runway_ends ?? [] });

/**
 * The pattern for landing on `endIdent` of `runway`, or null where its
 * threshold or heading is not known (the other end's place is taken from
 * the runway's length where it alone is missing).
 */
export function trafficPattern(ident: string, runway: Runway, endIdent: string, altitudeFt: number | null): TrafficPattern | null {
  return drawn(callEngine("traffic_pattern", { ident, runway: runwayOf(runway), end_ident: endIdent, altitude_ft: altitudeFt }));
}

/**
 * The way out of a field leaving from `endIdent`, where the field is left
 * rather than landed at: the takeoff along the runway and the upwind past
 * its end, then out of the pattern straight on or with a 45° turn to the
 * pattern's side -- the two AIM 4-3-3 gives -- whichever is the nearer the
 * way on to `toward`, the flight's next field. The planner flies the same
 * (wingtip.pattern.departure_circuit). It drew the landing's whole pattern and
 * its 45° entry at the field left from (the owner, 2026-10-27: "why is c81
 * also drawing a visual pattern?").
 */
export function departurePattern(ident: string, runway: Runway, endIdent: string, altitudeFt: number | null, toward: LatLon | null): TrafficPattern | null {
  return drawn(callEngine("departure_pattern", {
    ident, runway: runwayOf(runway), end_ident: endIdent, altitude_ft: altitudeFt, toward: toward ? { lat: toward.lat, lon: toward.lon } : null,
  }));
}

/** The patterns picked, by field, from the address: "KDLH:27,C81:24".
 *  An older address's "KDLH:NONE", the None chip's, taken away at the
 *  owner's ask ("Why is none even an option?", 2026-10-21) -- every
 *  takeoff and landing is on a runway -- is read as no pick, so the
 *  runway into the wind is picked there. */
export function patternsOf(param: string | null): Map<string, string> {
  const picked = new Map<string, string>();
  for (const part of (param ?? "").split(",")) {
    const [ident, end] = part.split(":").map(s => s.trim().toUpperCase());
    if (ident && end && isFixIdent(ident) && /^\d{1,2}[LCR]?$|^[NSEW]{1,2}$/.test(end)) picked.set(ident, end);
  }
  return picked;
}

/** The address's form of the patterns picked; empty for none. */
export function patternsParam(picked: Map<string, string>): string {
  return [...picked].map(([ident, end]) => `${ident}:${end}`).join(",");
}
