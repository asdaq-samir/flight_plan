/**
 * A POH's short-field distances and the air they are read in. Worked out
 * by the shared engine (native/crates/brief/src/runway/performance.rs, through
 * lib/engine), the very code behind the planner's runway check and the
 * phones': the rules and their sources live there.
 */
import type { ShortField } from "./api/types";
import { callEngine } from "./engine/engine";

/** A standard day's temperature at an altitude: 15 °C at sea level, less
 *  1.98 °C a thousand feet (ICAO Doc 7488). */
export const isaTempC = (altitudeFt: number) => callEngine("gonogo_field_air", { elevation_ft: altitudeFt }).temp_c;

/** The field's pressure altitude from its elevation and the altimeter
 *  setting reported: a thousand feet for every inch under 29.92. */
export const pressureAltitudeFt = (elevationFt: number, altimeterInHg: number | null | undefined) =>
  callEngine("gonogo_field_air", { elevation_ft: elevationFt, altimeter_in_hg: altimeterInHg ?? null, temp_c: 15 }).pressure_alt_ft;

export interface Distances {
  groundRollFt: number;
  totalFt: number;
  /** What could not be had from the table: beyond its altitudes or
   *  temperatures (where its edge is taken), or a tailwind past ten. */
  caveats: string[];
}

/**
 * A POH's short-field distances (ShortField) at a pressure altitude,
 * temperature and weight: read between the table's altitudes and
 * temperatures, and between its weights; then its notes for the wind
 * (the Cessna 172S POH's figures 5-5 and 5-11) and on dry grass the
 * ground roll's share more.
 */
export function shortField(table: ShortField, pressureAltFt: number, tempC: number, weightLb: number, headwindKt: number, grass: boolean): Distances {
  const d = callEngine("gonogo_short_field", {
    table, pressure_alt_ft: pressureAltFt, temp_c: tempC, weight_lb: weightLb, headwind_kt: headwindKt, grass,
  });
  return { groundRollFt: d.ground_roll_ft, totalFt: d.total_ft, caveats: d.caveats };
}
