import type { AirspaceVolume } from "../api/types";

/**
 * A volume's altitudes as the sectional prints them, in hundreds of feet
 * MSL (FAA Aeronautical Chart User's Guide, VFR Terms and Symbols,
 * Airspace): a Class B or C shelf as its top over its floor, "100" over
 * "30", the surface as "SFC"; a Class D as its ceiling alone in a dashed
 * box, with a minus where the ceiling is "surface up to but not
 * including" it (the file's TNI, a Class D under a Class B shelf: "-30").
 * A Class C's top is the file's number, where the chart prints "T" for a
 * shelf that ends at the Class B over it: the owner's pick ("36"), as the
 * number says how high.
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
  return { kind: "shelf", top: hundreds(volume.ceiling_ft), floor: volume.floor_sfc ? "SFC" : hundreds(volume.floor_ft) };
}
