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
import { angleBetween, rad } from "./geo";

export type RunwayEnd = NonNullable<Runway["runway_ends"]>[number];

const POINTS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;

/** A true bearing as a pilot says a direction: "southwest". */
export function compassWord(bearingDeg: number): string {
  return POINTS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]!;
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

/** The wind a field's runways are chosen by: the end it favours as
 *  painted ("27"), its head- and crosswind and the gust's crosswind to the
 *  knot (vfr.runway_wind), whether it is calm, and where it was reported
 *  when not at the field itself -- the nearest report's station and how
 *  far, for a field with no report of its own. */
export interface WindPick {
  ident: string;
  headwindKt: number;
  crosswindKt: number;
  gustCrosswindKt: number | null;
  calm: boolean;
  from: { ident: string; nm: number } | null;
}

/** A report's wind: true, as a METAR's is, in knots. */
export interface ReportedWind {
  station: string;
  distanceNm: number;
  dirTrueDeg: number | null | undefined;
  speedKt: number | null | undefined;
  gustKt: number | null | undefined;
}

/**
 * The runway end the wind favours, for a pattern and a takeoff alike
 * (AC 90-66C 11.5, the runway most nearly into the wind): the field's
 * own report's, worked out by the planner on each runway (vfr.runway_wind,
 * runwayInUse); else, for a field that reports none, the nearest report's
 * wind (`nearby`), said as that station's, the same sums done here -- the
 * most headwind, the longer runway on a tie. Calm is said as calm, on
 * no end. None with no wind to go by, or a variable one.
 */
export function windPick(runways: Runway[], nearby?: ReportedWind | null): WindPick | null {
  const own = runwayInUse(runways);
  if (own?.byWind && own.runway.wind) {
    const w = own.runway.wind;
    const calm = w.headwind_kt === 0 && w.crosswind_kt === 0;
    return { ident: runwayNumber(own.end.ident), headwindKt: w.headwind_kt, crosswindKt: w.crosswind_kt, gustCrosswindKt: w.gust_crosswind_kt ?? null, calm, from: null };
  }
  if (!nearby || nearby.speedKt == null) return null;
  const from = { ident: nearby.station, nm: Math.round(nearby.distanceNm) };
  const ends = runways
    .filter(r => !r.closed)
    .flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e, heading: e.heading_true_deg! })));
  if (ends.length === 0) return null;
  if (nearby.speedKt === 0) return { ident: "", headwindKt: 0, crosswindKt: 0, gustCrosswindKt: null, calm: true, from };
  if (nearby.dirTrueDeg == null) return null;
  const dir = nearby.dirTrueDeg, speed = nearby.speedKt;
  // (headwind, crosswind from the right), as vfr.runway_wind.components_kt.
  const along = (heading: number, kt: number) => {
    const angle = rad(dir - heading);
    return { head: kt * Math.cos(angle), cross: kt * Math.sin(angle) };
  };
  const best = [...ends].sort((a, b) => along(b.heading, speed).head - along(a.heading, speed).head
    || (b.runway.length_ft ?? 0) - (a.runway.length_ft ?? 0))[0]!;
  const { head, cross } = along(best.heading, speed);
  return {
    ident: runwayNumber(best.end.ident), headwindKt: Math.round(head), crosswindKt: Math.round(cross),
    gustCrosswindKt: nearby.gustKt ? Math.round(along(best.heading, nearby.gustKt).cross) : null, calm: false, from,
  };
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
  /** Where the airplane comes from, as a direction from the field. */
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
  const patternSide = angleBetween(fromDeg, patternSideDeg(end)) < 90;
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
