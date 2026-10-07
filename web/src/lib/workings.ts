/**
 * A leg of the nav log worked out the way a student shows it on the
 * examiner's nav log (PA.I.D, cross-country flight planning): the wind
 * triangle from the true course to the magnetic heading, the ground
 * speed, the time and the fuel, each with its sum. The planner has
 * already done every step (vfr.navlog); this lays them out, and checks a
 * student's own figures against them within an E6B's accuracy.
 */
import type { Leg } from "./api/types";

/** An angle as -180 to 180. */
function wrap(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** A heading as 001 to 360, as a pilot writes it. */
export function heading(deg: number): string {
  const whole = ((Math.round(deg) % 360) + 360) % 360;
  return `${String(whole === 0 ? 360 : whole).padStart(3, "0")}°`;
}

/** What the student works out, and how far off an E6B allows. */
export const ANSWERS = [
  { key: "wca", label: "Wind correction", unit: "°", tolerance: 2 },
  { key: "th", label: "True heading", unit: "°", tolerance: 2 },
  { key: "mh", label: "Magnetic heading", unit: "°", tolerance: 2 },
  { key: "gs", label: "Ground speed", unit: "kt", tolerance: 3 },
  { key: "ete", label: "Time", unit: "min", tolerance: 1 },
  { key: "fuel", label: "Fuel", unit: "gal", tolerance: 0.3 },
] as const;

export type AnswerKey = (typeof ANSWERS)[number]["key"];

export interface Workings {
  /** The steps in order, each a name, its sum and its result. */
  steps: { name: string; sum: string; result: string }[];
  /** The figures a student is asked for, cruise only. */
  answers: Record<AnswerKey, number>;
  /** What the leg's climb adds, where it has one: the log's own time and
   *  fuel are the cruise's and this. */
  climb: { min: number; gal: number } | null;
}

/** A leg worked out, or null for one that cannot be (no wind is a calm
 *  leg; a wind faster than the airplane, no leg at all). */
export function workingsOf(leg: Leg): Workings | null {
  if (leg.groundspeed_kt == null || leg.groundspeed_kt <= 0 || leg.ete_min == null || leg.fuel_gal == null) return null;
  const tc = leg.true_course_deg;
  const windDir = leg.wind?.wind_dir_true_deg ?? 0;
  const windKt = leg.wind?.wind_speed_kt ?? 0;
  const tas = leg.tas_kt;
  // The planner's own figures (vfr.navlog), which the log's rows show:
  // the sums below are how they are reached.
  const wca = leg.wca_deg;
  const th = leg.true_heading_deg;
  const variation = leg.magnetic_variation_deg;
  const mh = leg.magnetic_heading_deg;
  const gs = leg.groundspeed_kt;
  const ete = (leg.distance_nm / gs) * 60;
  const fuel = (ete / 60) * leg.fuel_burn_gph;
  const climbMin = leg.ete_min - ete;
  const climbGal = leg.fuel_gal - fuel;
  const east = variation >= 0;
  const r1 = (n: number) => n.toFixed(1);
  const steps = [
    { name: "True course", sum: "measured on the chart", result: heading(tc) },
    {
      name: "Wind",
      sum: leg.wind ? `forecast at ${Math.round(leg.altitude_ft).toLocaleString()} ft, from true north` : "no forecast near: calm",
      result: `${heading(windDir)} at ${Math.round(windKt)} kt`,
    },
    { name: "True airspeed", sum: `${Math.round(leg.power_pct)}% power at a density altitude of ${Math.round(leg.density_altitude_ft).toLocaleString()} ft`, result: `${Math.round(tas)} kt` },
    {
      name: "Wind correction",
      sum: `sin⁻¹(${Math.round(windKt)} × sin(${heading(windDir)} − ${heading(tc)}) ÷ ${Math.round(tas)})`,
      result: Math.round(wca) === 0 ? "0° (none)" : `${wca >= 0 ? "+" : "−"}${Math.abs(wca).toFixed(0)}° (${wca >= 0 ? "right" : "left"})`,
    },
    { name: "True heading", sum: `${heading(tc)} ${wca >= 0 ? "+" : "−"} ${Math.abs(wca).toFixed(0)}°`, result: heading(th) },
    {
      name: "Magnetic heading",
      sum: `${heading(th)} ${east ? "−" : "+"} ${Math.abs(variation).toFixed(0)}° ${east ? "E" : "W"} (east is least, west is best)`,
      result: heading(mh),
    },
    { name: "Compass heading", sum: "the magnetic heading with the deviation card's correction for it", result: heading(mh) },
    {
      name: "Ground speed",
      sum: `${Math.round(tas)} × cos ${Math.abs(wca).toFixed(0)}° − ${Math.round(windKt)} × cos(${heading(windDir)} − ${heading(tc)})`,
      result: `${Math.round(gs)} kt`,
    },
    { name: "Time", sum: `${r1(leg.distance_nm)} nm ÷ ${Math.round(gs)} kt × 60`, result: `${Math.round(ete)} min` },
    { name: "Fuel", sum: `${Math.round(ete)} min at ${r1(leg.fuel_burn_gph)} gal/h`, result: `${r1(fuel)} gal` },
  ];
  return {
    steps,
    answers: { wca, th, mh, gs, ete, fuel },
    climb: climbMin > 0.5 ? { min: climbMin, gal: Math.max(0, climbGal) } : null,
  };
}

/** Whether a student's figure is right within the answer's tolerance:
 *  headings compared round the compass (359° is 1° from 000°). */
export function checks(key: AnswerKey, typed: number, answer: number): boolean {
  const { tolerance } = ANSWERS.find(a => a.key === key)!;
  const off = key === "th" || key === "mh" ? Math.abs(wrap(typed - answer)) : Math.abs(typed - answer);
  return off <= tolerance + 1e-9;
}
