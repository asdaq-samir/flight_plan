import type { StopField } from "./api/types";
import { compassPoint } from "./compass";
import { fuelNames } from "./stopServices";

/** What the map's Stops look for at a field, in the order a row lists
 *  them (the owner's layout, 2026-10-27). */
export type StopKind = "fuel" | "food" | "repair" | "training";
/** The kind picked on the sheet: one of them, or all. */
export type StopPick = StopKind | "all";

/**
 * Each kind's name, colour and glyph, one place for the sheet's pills and
 * lines, the Airport tab's Find Nearby tiles and the map's pins, so the
 * pin on the chart is the colour of the line on the sheet (the owner's
 * picks on the Stops canvas, 2026-10-27). The glyphs are lucide's (ISC):
 * Fuel, Utensils, Wrench and GraduationCap, their paths copied so the
 * map's pins, drawn as HTML strings, draw the same ones.
 */
export const STOP_KINDS: Record<StopKind, { name: string; tile: string; colour: string; paths: string[] }> = {
  fuel: {
    name: "Fuel", tile: "Fuel", colour: "#d97706",
    paths: ["M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5", "M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16", "M2 21h13", "M3 9h11"],
  },
  food: {
    name: "Food", tile: "Food", colour: "#dc2626",
    paths: ["M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2", "M7 2v20", "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"],
  },
  repair: {
    name: "Repair", tile: "Repair", colour: "#0f766e",
    paths: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"],
  },
  training: {
    name: "Training", tile: "Flight Training", colour: "#0369a1",
    paths: [
      "M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z",
      "M22 10v6", "M6 12.5V16a6 3 0 0 0 12 0v-3.5",
    ],
  },
};

/** The kinds in a row's order: fuel, food, repair, training. */
export const KIND_ORDER: StopKind[] = ["fuel", "food", "repair", "training"];
/** The sheet's pills' order, All first (the owner's layout). */
export const PICK_ORDER: StopPick[] = ["all", "food", "fuel", "repair", "training"];

/** The radii the sheet offers round the pilot, nm: a menu, not a slider
 *  (the owner's discrete settings), 25 the first (the owner, 2026-10-27). */
export const STOP_RADII = [10, 25, 50, 100] as const;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** NASR's repair codes (APT_BASE's AIRFRAME_REPAIR_SER_CODE and
 *  PWR_PLANT_REPAIR_SER, MAJOR or MINOR) in words: "Airframe major,
 *  engine minor". Empty where it has neither. */
export function repairWords(f: Pick<StopField, "airframe_repair" | "powerplant_repair">): string {
  const parts = [f.airframe_repair && `airframe ${f.airframe_repair}`, f.powerplant_repair && `engine ${f.powerplant_repair}`].filter(Boolean);
  return capital(parts.join(", "));
}

/** One line of a row: the kind and what the field has of it, by name --
 *  the fuels as the pump is labelled, the restaurants and the schools by
 *  their names, the repair as NASR codes it. Only the kinds it has. */
export function kindLines(f: StopField): { kind: StopKind; words: string }[] {
  const words: Record<StopKind, string> = {
    fuel: fuelNames(f.fuel_types ?? []),
    food: (f.food ?? []).map(p => p.name).join(", "),
    repair: repairWords(f),
    training: (f.training ?? []).map(p => p.name).join(", "),
  };
  return KIND_ORDER.filter(k => words[k]).map(kind => ({ kind, words: words[kind] }));
}

/** The kinds a field has, in a row's order. */
export const kindsOf = (f: StopField): StopKind[] => kindLines(f).map(l => l.kind);

/** Where the field is: "12 nm NE" round the pilot; along the route how far
 *  off it, "12 nm off course", or "On the route" under a mile (the owner's
 *  layout, 2026-10-27). */
export function whereWords(f: Pick<StopField, "distance_nm" | "bearing_deg" | "off_nm">, along: boolean): string {
  if (along) {
    const nm = Math.round(f.off_nm ?? 0);
    return nm < 1 ? "On the route" : `${nm} nm off course`;
  }
  return `${Math.round(f.distance_nm)} nm ${compassPoint(f.bearing_deg)}`;
}
