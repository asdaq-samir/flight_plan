import type { Runway } from "./api/types";

/** Feet in a nautical mile, and nautical miles in a degree of latitude. */
export const FT_PER_NM = 6076.12;
const NM_PER_DEG = 60;

export interface Strip {
  /** Its two ends, in nautical miles east and north of the field. */
  a: [number, number];
  b: [number, number];
  width_ft: number;
  ends: [string, string];
  closed: boolean;
}

/** Each runway as a strip in nautical miles about the field: between its
 *  ends where both are known (NASR's surveyed thresholds, else
 *  OurAirports'), else its length along its first end's true heading,
 *  through the field's own point -- a sketch's guess for a field whose
 *  ends are known to neither, mostly one runway's. None for a helipad. */
export function stripsOf(runways: Runway[], lat: number, lon: number): Strip[] {
  const east = (lonDeg: number) => (lonDeg - lon) * NM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const north = (latDeg: number) => (latDeg - lat) * NM_PER_DEG;
  const strips: Strip[] = [];
  for (const r of runways) {
    const [first, second] = r.runway_ends ?? [];
    if (!first || !second) continue;
    const ends: [string, string] = [first.ident, second.ident];
    const width_ft = r.width_ft ?? 75;
    if (first.lat != null && first.lon != null && second.lat != null && second.lon != null) {
      strips.push({ a: [east(first.lon), north(first.lat)], b: [east(second.lon), north(second.lat)], width_ft, ends, closed: r.closed });
    } else if (first.heading_true_deg != null && r.length_ft) {
      const half = r.length_ft / FT_PER_NM / 2;
      const rad = (first.heading_true_deg * Math.PI) / 180;
      // The first end is where a landing on it starts: back along its heading.
      const dx = Math.sin(rad) * half, dy = Math.cos(rad) * half;
      strips.push({ a: [-dx, -dy], b: [dx, dy], width_ft, ends, closed: r.closed });
    }
  }
  return strips;
}
