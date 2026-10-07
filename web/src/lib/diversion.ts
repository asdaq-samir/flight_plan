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
 */
import type { Leg } from "./api/types";

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

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const round360 = (d: number) => ((d % 360) + 360) % 360;

/** The wind triangle for a true course: the correction (+ right), the
 *  true heading and the ground speed; null where the crosswind is more
 *  than the airplane's speed and no heading holds the course. */
export function windTriangle(tc: number, tas: number, windFromDeg: number, windKt: number): { wca: number; th: number; gs: number } | null {
  const angle = rad(windFromDeg - tc);
  const ratio = (windKt * Math.sin(angle)) / tas;
  if (Math.abs(ratio) > 1) return null;
  // `|| 0`: a calm wind's correction is none, not -0.
  const wca = deg(Math.asin(ratio)) || 0;
  const gs = tas * Math.cos(rad(wca)) - windKt * Math.cos(angle);
  return gs > 0 ? { wca, th: round360(tc + wca), gs } : null;
}

/** The diversion from a point on `leg` to a field `distanceNm` away on a
 *  true course of `tcDeg`, flown in the leg's air at its cruise burn. */
export function divert(leg: Leg, tcDeg: number, distanceNm: number): Diversion | null {
  const solved = windTriangle(tcDeg, leg.tas_kt, leg.wind?.wind_dir_true_deg ?? 0, leg.wind?.wind_speed_kt ?? 0);
  if (!solved) return null;
  const ete = (distanceNm / solved.gs) * 60;
  return {
    tc: tcDeg, distanceNm, ...solved,
    // East is least: a variation east (positive) comes off.
    mh: round360(solved.th - leg.magnetic_variation_deg),
    ete, fuel: (ete / 60) * leg.fuel_burn_gph,
  };
}

/** Whether an estimate is reasonable: within its allowance, a heading
 *  round the compass (358° is 4° from 002°). */
export function reasonable(key: EstimateKey, typed: number, exact: number): boolean {
  const { allowance } = ALLOWANCES.find(a => a.key === key)!;
  const off = key === "mh" ? Math.abs(((typed - exact + 540) % 360) - 180) : Math.abs(typed - exact);
  return off <= allowance + 1e-9;
}

/** Minutes and seconds, as a stopwatch shows them: "2:07". */
export function stopwatch(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
