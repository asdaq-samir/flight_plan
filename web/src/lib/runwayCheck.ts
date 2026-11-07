/**
 * The runway check at each airport a flight takes off from or lands at
 * (the Performance tab's, and its row on the Brief's Go / No-Go): the
 * runway the pilot picked in FPL, else the one the wind favours (pattern's
 * runwayFlown), the field's pressure and density altitude,
 * the reported wind along and across it, and the POH's short-field
 * distances (lib/takeoffLanding) against that runway's length -- the
 * runway lengths and takeoff and landing distances 14 CFR 91.103(b)
 * asks a pilot to know. Worked out by the shared engine
 * (native/crates/brief/src/gonogo/runways.rs, through lib/engine), the very
 * code behind the planner's Go / No-Go and the phones'.
 */
import type { AircraftProfile, Airport, Briefing, Course, Runway } from "./api/types";
import { callEngine, type EngineAnswer } from "./engine/engine";
import type { RunwayPicks } from "./pattern";
import type { Distances } from "./takeoffLanding";

/** Distances as the engine answers them, and whether over the runway. */
type EngineDistances = EngineAnswer<"gonogo_end_distance">;

const distances = (d: EngineDistances): Distances & { over: boolean } =>
  ({ groundRollFt: d.ground_roll_ft, totalFt: d.total_ft, caveats: d.caveats, over: d.over });

/**
 * Density altitude: the height in the standard atmosphere whose air is
 * as thin as the field's, from its pressure altitude and temperature --
 * worked out from the atmosphere itself rather than the 120 ft a degree
 * rule of thumb, which it agrees with to a few per cent near the ground.
 * What an airplane performs as if it were at (FAA-H-8083-25C, chapter 11).
 * The engine's ICAO standard atmosphere (ICAO Doc 7488), the one the
 * planner's cruise and climb are flown in.
 */
export function densityAltitudeFt(pressureAltFt: number, tempC: number): number {
  return callEngine("gonogo_density_altitude", { pressure_alt_ft: pressureAltFt, temp_c: tempC });
}

export interface RunwayDistance extends Distances {
  kind: "takeoff" | "landing";
  /** The runway it is flown on, and its end: a stop's runway out may not
   *  be its runway in. */
  runway: Runway | undefined;
  end: string | null;
  /** Over that runway's length, 50 ft obstacle included. */
  over: boolean;
  /** No runway, or its length not known: whether it fits is not known
   *  (14 CFR 91.103(b)), never "within". */
  unknown: boolean;
  /** Read past the POH's table (its caveats say how): its edge's figures. */
  beyond: boolean;
}

export interface RunwayCheck {
  field: Airport;
  /** "Departure", "Stop" or "Destination". */
  role: string;
  /** The runway out of the departure, into every other field, and its end. */
  runway: Runway | undefined;
  end: string | null;
  /** The pilot picked it in FPL, rather than the wind. */
  picked: boolean;
  /** Null where the field's elevation is not known (see `unchecked`). */
  pressureAltFt: number | null;
  densityAltFt: number | null;
  /** The temperature reported, else a standard day's; null with neither. */
  tempC: number | null;
  /** The temperature and altimeter were reported (a METAR), not a
   *  standard day's. */
  reported: boolean;
  headwindKt: number;
  /** The crosswind on that runway, its gusts' where they are more. */
  crosswindKt: number;
  /** Past the most the POH demonstrates, where it says (AircraftProfile
   *  crosswind): not a limitation, but beyond what was flown. */
  crosswindOver: boolean;
  grass: boolean;
  /** Why the distances were not worked out (none then), where they were
   *  not: the field's elevation not known. */
  unchecked: string | null;
  distances: RunwayDistance[];
}

/** Every airport the flight takes off from or lands at, the distances it
 *  needs there: the takeoff from the departure, the landing at the
 *  destination, both at a stop. Empty without the POH's tables or the
 *  briefing's runways. */
export function runwayChecks(aircraft: AircraftProfile | null | undefined, briefing: Briefing | null, course: Course | null,
  takeoffLb: number | null, landingLb: number | null, picks?: RunwayPicks | null): RunwayCheck[] {
  const takeoffTable = aircraft?.takeoff ?? null;
  const landingTable = aircraft?.landing ?? null;
  if (!briefing || !course || !takeoffTable || !landingTable) return [];
  const fields: Airport[] = [course.departure, ...(course.stops ?? []).filter(s => s.kind !== "fix"), course.destination];
  const idents = new Set(fields.map(f => f.ident));
  const runwaysAt = (ident: string) => briefing.airports[ident]?.runways ?? [];
  const checks = callEngine("gonogo_runway_checks", {
    aircraft: { takeoff: takeoffTable, landing: landingTable, crosswind: aircraft?.crosswind ?? null },
    fields: fields.map(f => ({ ident: f.ident, elevation_ft: f.elevation_ft ?? null })),
    metars: Object.fromEntries(Object.entries(briefing.metars).filter(([i]) => idents.has(i))),
    airports: Object.fromEntries(Object.entries(briefing.airports).filter(([i]) => idents.has(i))),
    takeoff_lb: takeoffLb, landing_lb: landingLb,
    // The picks in the order they were made, as the Map holds them.
    picks: picks ? { pattern: [...picks.pattern], takeoff: [...picks.takeoff] } : null,
  });
  return checks.map(c => {
    const field = fields[c.field]!;
    const on = (i: number | null) => (i == null ? undefined : runwaysAt(field.ident)[i]);
    return {
      field, role: c.role, runway: on(c.runway), end: c.end, picked: c.picked, pressureAltFt: c.pressure_alt_ft, densityAltFt: c.density_alt_ft,
      tempC: c.temp_c, reported: c.reported, headwindKt: c.headwind_kt, crosswindKt: c.crosswind_kt, crosswindOver: c.crosswind_over,
      grass: c.grass, unchecked: c.unchecked,
      distances: c.distances.map(d => ({ kind: d.kind, ...distances(d), unknown: d.unknown, beyond: d.beyond, runway: on(d.runway), end: d.end })),
    };
  });
}
