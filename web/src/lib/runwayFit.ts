/**
 * How one runway end suits the airplane today, for its chip in FPL's list
 * (ProceduresRoute), at the owner's asks: the crosswind on it against the
 * most the POH demonstrates, and the POH's short-field distance over a
 * 50 ft obstacle for the airplane's weight, the field's pressure and
 * density altitude and the headwind on it, against the runway's length
 * -- what 14 CFR 91.103(b) asks a pilot to know. Worked out by the
 * Brief's runway check's own evaluator (lib/runwayCheck's endDistance),
 * which says the same for the runway flown.
 */
import type { AircraftProfile, Runway } from "./api/types";
import type { RunwayEnd } from "./pattern";
import { endDistance, fieldAir } from "./runwayCheck";
import { crosswindKt as crosswindOf, headwindKt as headwindOf, steadyOrGustKt } from "./wind";

/** "Close": a runway with less than 15 per cent to spare over the
 *  distance needed. For a landing it is the FAA's margin: "an additional
 *  safety margin of at least 15 percent should be added to actual landing
 *  distance" (SAFO 19001, Landing Performance Assessments at Time of
 *  Arrival, 2019, for part 91 airplane operators among others; it
 *  replaced SAFO 06012). For a takeoff the FAA gives no such figure, so
 *  the same 15 per cent is a design margin there, held to the landing's. */
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
  // Along and across the end (vfr.runway_wind.components_kt): none with no
  // wind. A variable one (VRB, reported with no direction, AIM 7-1-28) may
  // blow straight across, so all of it, gusts included, is crosswind, as
  // lib/minimums' bestCrosswind takes it: a VRB15G25 showed 0 kt across
  // and never passed the demonstrated crosswind (the aviation check,
  // 2026-10-27). It gives no headwind.
  const heading = end.heading_true_deg;
  const dir = heading == null ? null : wind?.dirTrueDeg ?? null;
  const across = (kt: number | null | undefined) => (!kt || heading == null ? 0 : dir == null ? Math.abs(kt) : crosswindOf(dir, kt, heading));
  const headwind = dir == null || !wind?.speedKt ? 0 : headwindOf(dir, wind.speedKt, heading!);
  const crosswindKt = Math.round(steadyOrGustKt(across(wind?.speedKt), across(wind?.gustKt)));
  const demonstrated = aircraft?.crosswind?.demonstrated_kt ?? null;
  const table = kind === "takeoff" ? aircraft?.takeoff : aircraft?.landing;
  const lengthFt = runway.length_ft ?? null;
  const needed = table ? endDistance(table, runway, fieldAir(elevationFt, altimeterInHg, tempC), weightLb, Math.round(headwind)) : null;
  const neededFt = needed ? Math.round(needed.totalFt) : null;
  const short = neededFt != null && lengthFt != null && neededFt > lengthFt;
  return {
    crosswindKt, crosswindOver: demonstrated != null && crosswindKt > demonstrated, neededFt, lengthFt, short,
    close: !short && neededFt != null && lengthFt != null && neededFt * DISTANCE_MARGIN > lengthFt,
  };
}
