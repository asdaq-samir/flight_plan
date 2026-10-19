/**
 * The runway check at each airport a flight takes off from or lands at
 * (the Performance tab's, and its row on the Brief's Go / No-Go): the
 * runway the pilot picked in FPL, else the one the wind favours (pattern's
 * runwayFlown), the field's pressure and density altitude,
 * the reported wind along and across it, and the POH's short-field
 * distances (lib/takeoffLanding) against that runway's length -- the
 * runway lengths and takeoff and landing distances 14 CFR 91.103(b)
 * asks a pilot to know.
 */
import type { AircraftProfile, Airport, Briefing, Course, Runway } from "./api/types";
import { pickedEnd, runwayFlown, type RunwayPicks } from "./pattern";
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
 * What an airplane performs as if it were at (FAA-H-8083-25C, chapter 11).
 */
export function densityAltitudeFt(pressureAltFt: number, tempC: number): number {
  const pressure = (1 - (LAPSE_K_PER_FT * pressureAltFt) / T0_K) ** PRESSURE_EXP;
  const density = pressure / ((tempC + 273.15) / T0_K);
  return (T0_K / LAPSE_K_PER_FT) * (1 - density ** (1 / DENSITY_EXP));
}

export interface RunwayDistance extends Distances {
  kind: "takeoff" | "landing";
  /** The runway it is flown on, and its end: a stop's runway out may not
   *  be its runway in. */
  runway: Runway | undefined;
  end: string | null;
  /** Over that runway's length, 50 ft obstacle included. */
  over: boolean;
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
  takeoffLb: number | null, landingLb: number | null, picks?: RunwayPicks | null): RunwayCheck[] {
  const takeoffTable = aircraft?.takeoff ?? null;
  const landingTable = aircraft?.landing ?? null;
  if (!briefing || !course || !takeoffTable || !landingTable) return [];
  const fields = [course.departure, ...(course.stops ?? []).filter(s => s.kind !== "fix"), course.destination];
  const demonstrated = aircraft?.crosswind?.demonstrated_kt ?? null;
  return fields.map((field, i) => {
    const metar = briefing.metars[field.ident] ?? null;
    const runways = briefing.airports[field.ident]?.runways ?? [];
    // The runway the wind favours most, or the longest without a wind.
    const windward = [...runways].filter(r => !r.closed)
      .sort((a, b) => (b.wind?.headwind_kt ?? -99) - (a.wind?.headwind_kt ?? -99) || (b.length_ft ?? 0) - (a.length_ft ?? 0))[0];
    // The runway flown for a takeoff or a landing: the pilot's pick in FPL
    // where there is one, checked whatever the wind -- a short runway
    // picked was never checked, the long one into the wind was -- with the
    // wind on the end picked (a tailwind on the far end of the wind's
    // runway); else the wind's.
    const flownFor = (kind: "takeoff" | "landing") => {
      const flown = runwayFlown(runways, pickedEnd(picks, field.ident, kind, i === 0));
      const picked = !!flown && !!pickedEnd(picks, field.ident, kind, i === 0);
      const runway = picked ? flown!.runway : windward;
      const w = runway?.wind;
      const end = picked ? flown!.end.ident : w?.end ?? null;
      const headwind = w ? (end != null && end !== w.end ? -w.headwind_kt : w.headwind_kt) : 0;
      const crosswind = Math.max(Math.abs(w?.crosswind_kt ?? 0), Math.abs(w?.gust_crosswind_kt ?? 0));
      return { runway, end, picked, headwind, crosswind };
    };
    const elevation = field.elevation_ft ?? 0;
    const pa = pressureAltitudeFt(elevation, metar?.altimeter_in_hg);
    const temp = metar?.temp_c ?? isaTempC(elevation);
    const last = i === fields.length - 1;
    const kinds: ("takeoff" | "landing")[] = i === 0 ? ["takeoff"] : last ? ["landing"] : ["landing", "takeoff"];
    const first = flownFor(kinds[0]!);
    const grassOf = (r: Runway | undefined) => /turf|grass|grs|dirt|gravel/i.test(r?.surface ?? "");
    return {
      field, role: i === 0 ? "Departure" : last ? "Destination" : "Stop", runway: first.runway, end: first.end, picked: first.picked,
      pressureAltFt: pa, densityAltFt: densityAltitudeFt(pa, temp), tempC: temp, reported: !!metar,
      headwindKt: first.headwind, crosswindKt: first.crosswind, crosswindOver: demonstrated != null && first.crosswind > demonstrated,
      grass: grassOf(first.runway),
      distances: kinds.map(kind => {
        const on = flownFor(kind);
        const table = kind === "takeoff" ? takeoffTable : landingTable;
        const weight = (kind === "takeoff" ? takeoffLb : landingLb) ?? Math.max(...table.weights_lb);
        const d = shortField(table, pa, temp, weight, on.headwind, grassOf(on.runway));
        return { kind, ...d, runway: on.runway, end: on.end, over: on.runway?.length_ft != null && d.totalFt > on.runway.length_ft };
      }),
    };
  });
}
