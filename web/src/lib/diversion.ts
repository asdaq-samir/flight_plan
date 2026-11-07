/**
 * A diversion worked out exactly (the roadmap's diversion drill, ACS
 * PA.VI.C): from a point on the route, to the field a student picks, in
 * the leg's own air -- its altitude, wind, true airspeed, burn and
 * variation -- the true course and distance there, the wind triangle,
 * the magnetic heading, the ground speed, the time and the fuel. And a
 * student's own estimates checked against it.
 *
 * The ACS asks for "a reasonable estimate of heading, groundspeed,
 * arrival time, and fuel required" (PA.VI.C.S2) and gives no figures;
 * ALLOWANCES are this drill's own, about what a pilot works out in their
 * head and off the chart while flying the airplane.
 *
 * Worked out by the shared engine (native/crates/figures/src/figures/diversion.rs,
 * through lib/engine), the very code behind the planner's /api/diversion
 * and the phones' wt_call("diversion"). ALLOWANCES stays here as the drill's
 * labels and the type of its keys; diversion.test.ts holds it to the
 * engine's. `stopwatch` is a display format, not a rule, and stays too.
 */
import type { Leg } from "./api/types";
import { callEngine, type EngineAnswer } from "./engine/engine";

/** The figures a student estimates, and how far off is still reasonable. */
export const ALLOWANCES = [
  { key: "mh", label: "Magnetic heading", unit: "°", allowance: 10 },
  { key: "gs", label: "Ground speed", unit: "kt", allowance: 10 },
  { key: "ete", label: "Time", unit: "min", allowance: 3 },
  { key: "fuel", label: "Fuel", unit: "gal", allowance: 1 },
] as const;

export type EstimateKey = (typeof ALLOWANCES)[number]["key"];

export interface Diversion {
  /** True course and distance from the point to the field. */
  tc: number;
  distanceNm: number;
  wca: number;
  th: number;
  mh: number;
  gs: number;
  ete: number;
  fuel: number;
}

/** The wind triangle for a true course: the correction (+ right), the
 *  true heading and the ground speed; null where the crosswind is more
 *  than the airplane's speed and no heading holds the course. The nav
 *  log's own correction and ground speed, in the engine. */
export function windTriangle(tc: number, tas: number, windFromDeg: number, windKt: number): EngineAnswer<"wind_triangle"> {
  return callEngine("wind_triangle", { tc, tas, wind_from_deg: windFromDeg, wind_kt: windKt });
}

/** The diversion from a point on `leg` to a field `distanceNm` away on a
 *  true course of `tcDeg`, flown in the leg's air at its cruise burn. */
export function divert(leg: Leg, tcDeg: number, distanceNm: number): Diversion | null {
  const { solved } = callEngine("diversion", {
    true_course_deg: tcDeg, distance_nm: distanceNm, tas_kt: leg.tas_kt, fuel_burn_gph: leg.fuel_burn_gph,
    magnetic_variation_deg: leg.magnetic_variation_deg, wind: leg.wind ?? null,
  });
  if (!solved) return null;
  const { distance_nm, ...figures } = solved;
  return { ...figures, distanceNm: distance_nm };
}

/** Whether an estimate is reasonable: within its allowance, a heading
 *  round the compass (358° is 4° from 002°). */
export function reasonable(key: EstimateKey, typed: number, exact: number): boolean {
  return callEngine("diversion_reasonable", { key, typed, exact });
}

/** Minutes and seconds, as a stopwatch shows them: "2:07". */
export function stopwatch(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
