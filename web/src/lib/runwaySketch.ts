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
 *  ends are known to neither, mostly one runway's. The guess is made only
 *  where no runway at the field has its ends, since one placed on the
 *  field's point would cross the others where it may not, and not for a
 *  runway parallel to one already guessed, which would lie on top of it.
 *  None for a helipad. */
export function stripsOf(runways: Runway[], lat: number, lon: number): Strip[] {
  const east = (lonDeg: number) => (lonDeg - lon) * NM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const north = (latDeg: number) => (latDeg - lat) * NM_PER_DEG;
  const strips: Strip[] = [];
  const guesses: Strip[] = [];
  const guessed: number[] = [];
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
      // Within a degree of a heading already guessed, either way round.
      const line = ((first.heading_true_deg % 180) + 180) % 180;
      if (guessed.some(h => Math.min(Math.abs(h - line), 180 - Math.abs(h - line)) < 1)) continue;
      guessed.push(line);
      guesses.push({ a: [-dx, -dy], b: [dx, dy], width_ft, ends, closed: r.closed });
    }
  }
  return strips.length ? strips : guesses;
}
