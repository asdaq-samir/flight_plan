/**
 * The runway check at each airport a flight takes off from or lands at
 * (the Performance tab's, and its row on the Brief's Go / No-Go): the
 * runway the wind favours, the field's pressure and density altitude,
 * the reported wind along and across it, and the POH's short-field
 * distances (lib/takeoffLanding) against that runway's length -- the
 * runway lengths and takeoff and landing distances 14 CFR 91.103(b)
 * asks a pilot to know.
 */
import type { AircraftProfile, Airport, Briefing, Course, Runway } from "./api/types";
import { isaTempC, pressureAltitudeFt, shortField, type Distances } from "./takeoffLanding";

/** The ICAO standard atmosphere's troposphere (ICAO Doc 7488): sea level
 *  288.15 K, the lapse rate 6.5 K a kilometre (0.0019812 K a foot), and
 *  the exponents its pressure and density fall off with height by --
 *  g/(R·L) and one less. */
const T0_K = 288.15;
const LAPSE_K_PER_FT = 0.0019812;
const PRESSURE_EXP = 5.25588;
const DENSITY_EXP = PRESSURE_EXP - 1;

/**
 * Density altitude: the height in the standard atmosphere whose air is
 * as thin as the field's, from its pressure altitude and temperature --
 * worked out from the atmosphere itself rather than the 120 ft a degree
 * rule of thumb, which it agrees with to a few per cent near the ground.
 * What an aeroplane performs as if it were at (FAA-H-8083-25C, chapter 11).
 */
export function densityAltitudeFt(pressureAltFt: number, tempC: number): number {
  const pressure = (1 - (LAPSE_K_PER_FT * pressureAltFt) / T0_K) ** PRESSURE_EXP;
  const density = pressure / ((tempC + 273.15) / T0_K);
  return (T0_K / LAPSE_K_PER_FT) * (1 - density ** (1 / DENSITY_EXP));
}

export interface RunwayDistance extends Distances {
  kind: "takeoff" | "landing";
  /** Over the runway's length, 50 ft obstacle included. */
  over: boolean;
}

export interface RunwayCheck {
  field: Airport;
  /** "Departure", "Stop" or "Destination". */
  role: string;
  runway: Runway | undefined;
  pressureAltFt: number;
  densityAltFt: number;
  tempC: number;
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
  distances: RunwayDistance[];
}

/** Every airport the flight takes off from or lands at, the distances it
 *  needs there: the takeoff from the departure, the landing at the
 *  destination, both at a stop. Empty without the POH's tables or the
 *  briefing's runways. */
export function runwayChecks(aircraft: AircraftProfile | null | undefined, briefing: Briefing | null, course: Course | null,
  takeoffLb: number | null, landingLb: number | null): RunwayCheck[] {
  const takeoffTable = aircraft?.takeoff ?? null;
  const landingTable = aircraft?.landing ?? null;
  if (!briefing || !course || !takeoffTable || !landingTable) return [];
  const fields = [course.departure, ...(course.stops ?? []).filter(s => s.kind !== "fix"), course.destination];
  const demonstrated = aircraft?.crosswind?.demonstrated_kt ?? null;
  return fields.map((field, i) => {
    const metar = briefing.metars[field.ident] ?? null;
    const runways = briefing.airports[field.ident]?.runways ?? [];
    // The runway the wind favours most, or the longest without a wind.
    const runway = [...runways].filter(r => !r.closed)
      .sort((a, b) => (b.wind?.headwind_kt ?? -99) - (a.wind?.headwind_kt ?? -99) || (b.length_ft ?? 0) - (a.length_ft ?? 0))[0];
    const elevation = field.elevation_ft ?? 0;
    const pa = pressureAltitudeFt(elevation, metar?.altimeter_in_hg);
    const temp = metar?.temp_c ?? isaTempC(elevation);
    const headwind = runway?.wind?.headwind_kt ?? 0;
    const crosswind = Math.max(Math.abs(runway?.wind?.crosswind_kt ?? 0), Math.abs(runway?.wind?.gust_crosswind_kt ?? 0));
    const grass = /turf|grass|grs|dirt|gravel/i.test(runway?.surface ?? "");
    const last = i === fields.length - 1;
    const kinds: ("takeoff" | "landing")[] = i === 0 ? ["takeoff"] : last ? ["landing"] : ["landing", "takeoff"];
    return {
      field, role: i === 0 ? "Departure" : last ? "Destination" : "Stop", runway,
      pressureAltFt: pa, densityAltFt: densityAltitudeFt(pa, temp), tempC: temp, reported: !!metar,
      headwindKt: headwind, crosswindKt: crosswind, crosswindOver: demonstrated != null && crosswind > demonstrated, grass,
      distances: kinds.map(kind => {
        const table = kind === "takeoff" ? takeoffTable : landingTable;
        const weight = (kind === "takeoff" ? takeoffLb : landingLb) ?? Math.max(...table.weights_lb);
        const d = shortField(table, pa, temp, weight, headwind, grass);
        return { kind, ...d, over: runway?.length_ft != null && d.totalFt > runway.length_ft };
      }),
    };
  });
}
