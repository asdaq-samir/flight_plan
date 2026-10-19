/**
 * How one runway end suits the airplane today, for its chip in FPL's list
 * (ProceduresRoute), at the owner's asks: the crosswind on it against the
 * most the POH demonstrates, and the POH's short-field distance over a
 * 50 ft obstacle for the airplane's weight, the field's pressure and
 * density altitude and the headwind on it, against the runway's length
 * -- what 14 CFR 91.103(b) asks a pilot to know. The Brief's runway check
 * (lib/runwayCheck) says the same for the runway the wind favours.
 */
import type { AircraftProfile, Runway } from "./api/types";
import type { RunwayEnd } from "./pattern";
import { isaTempC, pressureAltitudeFt, shortField } from "./takeoffLanding";

/** "Close": less than the 15 per cent margin over the distance needed
 *  that the FAA asks for (SAFO 06012, landing distance assessments). */
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
  // wind, or a variable one, to go by.
  const heading = end.heading_true_deg;
  const across = (kt: number | null | undefined) =>
    wind?.dirTrueDeg == null || heading == null || !kt ? 0 : Math.abs(kt * Math.sin(((wind.dirTrueDeg - heading) * Math.PI) / 180));
  const headwind = wind?.dirTrueDeg == null || heading == null || !wind.speedKt ? 0 : wind.speedKt * Math.cos(((wind.dirTrueDeg - heading) * Math.PI) / 180);
  const crosswindKt = Math.round(Math.max(across(wind?.speedKt), across(wind?.gustKt)));
  const demonstrated = aircraft?.crosswind?.demonstrated_kt ?? null;
  const table = kind === "takeoff" ? aircraft?.takeoff : aircraft?.landing;
  const lengthFt = runway.length_ft ?? null;
  let neededFt: number | null = null;
  if (table) {
    const pa = pressureAltitudeFt(elevationFt, altimeterInHg);
    const grass = /turf|grass|grs|dirt|gravel/i.test(runway.surface ?? "");
    neededFt = Math.round(shortField(table, pa, tempC ?? isaTempC(elevationFt), weightLb ?? Math.max(...table.weights_lb), Math.round(headwind), grass).totalFt);
  }
  const short = neededFt != null && lengthFt != null && neededFt > lengthFt;
  return {
    crosswindKt, crosswindOver: demonstrated != null && crosswindKt > demonstrated, neededFt, lengthFt, short,
    close: !short && neededFt != null && lengthFt != null && neededFt * DISTANCE_MARGIN > lengthFt,
  };
}
