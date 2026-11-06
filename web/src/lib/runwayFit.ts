/**
 * How one runway end suits the airplane today, for its chip in FPL's list
 * (ProceduresRoute), at the owner's asks: the crosswind on it against the
 * most the POH demonstrates, and the POH's short-field distance over a
 * 50 ft obstacle for the airplane's weight, the field's pressure and
 * density altitude and the headwind on it, against the runway's length
 * -- what 14 CFR 91.103(b) asks a pilot to know. Worked out by the
 * shared engine (native/engine/src/runway/performance.rs, through
 * lib/engine) with the Brief's runway check's own evaluator, which says
 * the same for the runway flown: the rules and their sources live there.
 */
import type { AircraftProfile, Runway } from "./api/types";
import { callEngine } from "./engine/engine";
import type { RunwayEnd } from "./pattern";

/** "Close": a runway with less than 15 per cent to spare over the
 *  distance needed -- SAFO 19001's margin for a landing, held to a
 *  takeoff too. The engine's DISTANCE_MARGIN (runway/performance.rs, where
 *  its source is given), which endFit goes by; named here for the pages. */
export const DISTANCE_MARGIN = 1.15;

/** A wind as a METAR reports it: true, in knots. */
export interface FitWind {
  dirTrueDeg: number | null | undefined;
  speedKt: number | null | undefined;
  gustKt: number | null | undefined;
}

export interface EndFit {
  /** The crosswind on the end, its gusts' where they are more, knots. */
  crosswindKt: number;
  /** Past the most the POH demonstrates (not a limitation, but beyond
   *  what was flown). */
  crosswindOver: boolean;
  /** The distance over a 50 ft obstacle, and the runway's length. */
  neededFt: number | null;
  lengthFt: number | null;
  /** Longer than the runway; or within its margin (DISTANCE_MARGIN). */
  short: boolean;
  close: boolean;
}

export function endFit({ aircraft, runway, end, wind, elevationFt, altimeterInHg, tempC, weightLb, kind }: {
  aircraft: AircraftProfile | null | undefined;
  runway: Runway;
  end: RunwayEnd;
  wind: FitWind | null;
  elevationFt: number;
  altimeterInHg: number | null | undefined;
  tempC: number | null | undefined;
  weightLb: number | null;
  kind: "takeoff" | "landing";
}): EndFit {
  const fit = callEngine<{
    crosswind_kt: number; crosswind_over: boolean; needed_ft: number | null; length_ft: number | null; short: boolean; close: boolean;
  }>("runway_end_fit", {
    aircraft: aircraft ? { takeoff: aircraft.takeoff ?? null, landing: aircraft.landing ?? null, crosswind: aircraft.crosswind ?? null } : null,
    runway, end: { heading_true_deg: end.heading_true_deg ?? null },
    wind: wind ? { dir_true_deg: wind.dirTrueDeg ?? null, speed_kt: wind.speedKt ?? null, gust_kt: wind.gustKt ?? null } : null,
    elevation_ft: elevationFt, altimeter_in_hg: altimeterInHg ?? null, temp_c: tempC ?? null, weight_lb: weightLb, kind,
  });
  return {
    crosswindKt: fit.crosswind_kt, crosswindOver: fit.crosswind_over, neededFt: fit.needed_ft, lengthFt: fit.length_ft, short: fit.short,
    close: fit.close,
  };
}
