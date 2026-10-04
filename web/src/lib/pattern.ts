/**
 * An airport's traffic pattern for the runway a pilot would land on, as
 * AC 90-66C flies it (the roadmap's pattern card, ACS PA.III.B): the end
 * the reported wind favours, which side of it the downwind is flown
 * (left unless the FAA says right, 14 CFR 91.126(b)(1)), and how to join
 * it from the way the route arrives -- the 45° to the downwind abeam
 * midfield at pattern altitude from the pattern's side, or over the
 * field 500 ft above it and back to the 45 from the other.
 */
import type { Runway } from "./api/types";

export type RunwayEnd = NonNullable<Runway["runway_ends"]>[number];

const POINTS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;

/** A true bearing as a pilot says a direction: "southwest". */
export function compassWord(bearingDeg: number): string {
  return POINTS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]!;
}

/** The difference between two bearings, 0 to 180. */
function apart(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export interface InUse {
  runway: Runway;
  end: RunwayEnd;
  /** Whether the reported wind chose it; if not, it is the longest
   *  runway's first end, for want of a wind. */
  byWind: boolean;
}

/** The runway end a pilot would take off from and land on: of the ends the reported wind
 *  favours on each runway (vfr.runway_wind), the one with the most
 *  headwind -- AC 90-66C 11.5's runway most nearly into the wind -- or,
 *  with no wind reported, the longest runway's first end. Only ends with
 *  a heading: a helipad has no pattern to draw. */
export function runwayInUse(runways: Runway[]): InUse | null {
  const open = runways.filter(r => !r.closed && (r.runway_ends ?? []).some(e => e.heading_true_deg != null));
  const winded = open
    .filter(r => r.wind)
    .sort((a, b) => b.wind!.headwind_kt - a.wind!.headwind_kt || (b.length_ft ?? 0) - (a.length_ft ?? 0));
  for (const runway of winded) {
    const end = runway.runway_ends?.find(e => e.ident === runway.wind!.end && e.heading_true_deg != null);
    if (end) return { runway, end, byWind: true };
  }
  const longest = [...open].sort((a, b) => (b.length_ft ?? 0) - (a.length_ft ?? 0))[0];
  const end = longest?.runway_ends?.find(e => e.heading_true_deg != null);
  return longest && end ? { runway: longest, end, byWind: false } : null;
}

/** The true bearing from the runway to its downwind: off the left of
 *  the landing direction for left traffic, the right for right. */
export function patternSideDeg(end: RunwayEnd): number {
  return (((end.heading_true_deg ?? 0) + (end.traffic === "right" ? 90 : -90)) % 360 + 360) % 360;
}

/** A runway end as written: "9" for "09", as a US runway is painted. */
export function runwayNumber(ident: string): string {
  return ident.replace(/^0+(?=\d)/, "");
}

export interface Entry {
  /** Where the aeroplane comes from, as a direction from the field. */
  from: string;
  /** Whether that is the pattern's side of the runway. */
  patternSide: boolean;
  /** What to fly, in a sentence or two. */
  words: string;
}

/**
 * How to join the pattern for `end` arriving on a true course of
 * `courseDeg` (the hop's last leg): from the pattern's side, the 45° to
 * the downwind abeam midfield at pattern altitude (AC 90-66C 11.3); from
 * the other, its Appendix A's preferred entry -- over midfield 500 ft
 * above pattern altitude, down to it well clear, and back to the 45 --
 * or, where the pattern is not busy, across midfield at pattern altitude
 * straight onto the downwind.
 */
export function entryFor(end: RunwayEnd, courseDeg: number): Entry {
  const fromDeg = (courseDeg + 180) % 360;
  const patternSide = apart(fromDeg, patternSideDeg(end)) < 90;
  const downwind = `${end.traffic} downwind for runway ${runwayNumber(end.ident)}`;
  const from = compassWord(fromDeg);
  return {
    from, patternSide,
    words: patternSide
      ? `From the ${from}, on the pattern's side: join the 45° to the ${downwind}, abeam midfield at pattern altitude.`
      : `From the ${from}, across the field from the pattern: cross midfield 500 ft above pattern altitude, descend to it well clear, and turn back to join the 45° to the ${downwind}. With no traffic, crossing midfield at pattern altitude onto the downwind will do.`,
  };
}

/** How to leave the pattern from `end` (AC 90-66C 11.8): straight out,
 *  or a 45° turn the pattern's way once past the departure end at
 *  pattern altitude. */
export function exitFor(end: RunwayEnd): string {
  return `Straight out, or a 45° ${end.traffic} turn once past the departure end at pattern altitude.`;
}
