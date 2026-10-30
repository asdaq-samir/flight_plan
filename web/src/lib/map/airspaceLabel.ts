import { faaWords, placeWords } from "../advisories";
import type { AirspaceVolume } from "../api/types";
import { altFt } from "../units";

/**
 * A volume's altitudes as the sectional prints them, in hundreds of feet
 * MSL (FAA Aeronautical Chart User's Guide, VFR Terms and Symbols,
 * Airspace): a Class B or C shelf as its top over its floor, "100" over
 * "30", the surface as "SFC"; a Class D as its ceiling alone in a dashed
 * box, with a minus where the ceiling is "surface up to but not
 * including" it (the file's TNI, a Class D under a Class B shelf: "-30").
 * A Class C's top is the file's number, where the chart prints "T" for a
 * shelf that ends at the Class B over it: the owner's pick ("36"), as the
 * number says how high. A Class B or C top the file marks TNI wears the
 * same minus as a Class D's ("-40"): the airspace stops under it.
 */
export type AirspaceLabel =
  | { kind: "shelf"; top: string; floor: string }
  | { kind: "ceiling"; ceiling: string };

/** Feet as the chart's hundreds: 3,600 is "36", 10,000 "100". */
export function hundreds(ft: number): string {
  return String(Math.round(ft / 100));
}

/** The label a volume wears, or none where the file gives no top. */
export function airspaceLabel(
  volume: Pick<AirspaceVolume, "airspace_class" | "floor_ft" | "floor_sfc" | "ceiling_ft" | "ceiling_excluded">,
): AirspaceLabel | null {
  if (volume.ceiling_ft == null) return null;
  if (volume.airspace_class === "D") {
    return { kind: "ceiling", ceiling: `${volume.ceiling_excluded ? "-" : ""}${hundreds(volume.ceiling_ft)}` };
  }
  return { kind: "shelf", top: `${volume.ceiling_excluded ? "-" : ""}${hundreds(volume.ceiling_ft)}`, floor: volume.floor_sfc ? "SFC" : hundreds(volume.floor_ft) };
}

/** The figures of a volume's card (AirspaceLayer), as the pilot reads
 *  them: its name, floor, ceiling and hours. */
export type AirspaceFacts = { name: string; floor: string; ceiling: string; hours: string | null };

/** The FAA's boilerplate remark on a part-time volume, which says no more
 *  than its hours code does. */
const NOTAM_ONLY = /^legal description references notam\.?$/i;

/**
 * A volume's card in words. The name a place's, as it is written
 * ("CHICAGO, WAUKEGAN REGIONAL CLASS D" is "Chicago, Waukegan Regional
 * Class D", placeWords). The floor "SFC" or in feet MSL, the ceiling in
 * feet MSL, "up to but not including" it where the file says TNI (the
 * Chart User's Guide's minus). The hours from the FAA NASR Class
 * Airspace shapefile's WKHR_CODE and WKHR_RMK: "H24" continuous;
 * "NOTAM" part-time, in effect at the times a NOTAM sets and the Chart
 * Supplement then publishes (FAA JO 7400.11, the Class D and Class C
 * legal descriptions), with the remark where it says more than that;
 * else the remark itself, the FAA's capitals in sentence case
 * (faaWords).
 */
export function airspaceFacts(
  volume: Pick<AirspaceVolume, "name" | "floor_ft" | "floor_sfc" | "ceiling_ft" | "ceiling_excluded" | "hours_code" | "hours_remark">,
): AirspaceFacts {
  const ceiling = volume.ceiling_ft == null ? "—"
    : `${volume.ceiling_excluded ? "Up to but not including " : ""}${altFt(volume.ceiling_ft)} ft MSL`;
  return {
    name: placeWords(volume.name),
    floor: volume.floor_sfc ? "SFC" : `${altFt(volume.floor_ft)} ft MSL`,
    ceiling,
    hours: airspaceHours(volume.hours_code, volume.hours_remark),
  };
}

/** When a volume is in effect, in words (airspaceFacts), or none where
 *  the file says nothing. */
export function airspaceHours(code: string | null | undefined, remark: string | null | undefined): string | null {
  const said = remark && !NOTAM_ONLY.test(remark.trim()) ? faaWords(remark.trim()) : null;
  if (code === "H24") return "Continuous";
  if (code === "NOTAM") return said ? `By NOTAM. ${said}` : "By NOTAM";
  return said ?? null;
}
