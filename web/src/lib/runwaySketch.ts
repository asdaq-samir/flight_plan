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

/** How many of the field's runways the sketch leaves out for want of their
 *  ends, so the card can say its picture is partial rather than whole. */
export function runwaysLeftOut(runways: Runway[], drawn: Strip[]): number {
  const real = runways.filter(r => (r.runway_ends ?? []).length >= 2).length;
  return Math.max(0, real - drawn.length);
}

/**
 * The scale (points per nautical mile) at which no runway end is under a
 * pane laid over the box. Only the ends are tested: a pane over a runway's
 * middle hides nothing a pilot reads, but one over an end hides where the
 * runway stops. The field is drawn about the box's centre, so shrinking it
 * brings every end toward the centre, and the loop ends at the first scale
 * that clears the pane, however far a diagonal runway reaches into its
 * corner; it only gives up when the centre itself is under the pane.
 */
export function scaleClearOf(
  strips: Strip[], fit: number, centre: [number, number], box: { w: number; h: number },
  hole: { x: number; y: number; w: number; h: number }, pad: number,
): number {
  const under = (k: number) => strips.some(s => [s.a, s.b].some(([x, y]) => {
    const px = box.w / 2 + (x - centre[0]) * k, py = box.h / 2 - (y - centre[1]) * k;
    return px > hole.x - pad && px < hole.x + hole.w + pad && py > hole.y - pad && py < hole.y + hole.h + pad;
  }));
  let scale = fit;
  for (let i = 0; i < 80 && under(scale); i++) scale *= 0.95;
  return scale;
}
