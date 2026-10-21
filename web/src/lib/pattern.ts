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
import { angleBetween } from "./geo";
import { calmOnRunway, crosswindKt, headwindKt, isCalm } from "./wind";

export type RunwayEnd = NonNullable<Runway["runway_ends"]>[number];

const POINTS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;

/** A true bearing as a pilot says a direction: "southwest". */
export function compassWord(bearingDeg: number): string {
  return POINTS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]!;
}

export interface InUse {
  runway: Runway;
  end: RunwayEnd;
  /** Whether the reported wind chose it; if not, it is the most used
   *  runway's (paved, then the longest) first end, for want of a wind. */
  byWind: boolean;
}

/** A runway paved, asphalt or concrete (OurAirports' surface codes),
 *  where an unpaved strip may be listed longer: C81's 06/24 is listed at
 *  3,573 ft of "COP" beside 09/27's 3,270 of asphalt, the one flown (the
 *  owner's "runway 6 is not the longest or the most used"). */
const paved = (r: Runway) => /asp|con|bit|pem|paved/i.test(r.surface ?? "");

/** Paved first, then the longer: the runway a field's traffic uses most,
 *  as far as its data says. */
const mostUsed = (a: Runway, b: Runway) => Number(paved(b)) - Number(paved(a)) || (b.length_ft ?? 0) - (a.length_ft ?? 0);

/** The runway end a pilot would take off from and land on: of the ends the reported wind
 *  favours on each runway (vfr.runway_wind), the one with the most
 *  headwind -- AC 90-66C 11.5's runway most nearly into the wind -- or,
 *  with no wind reported, the runway most used's (paved, then the longest) first end. Only ends with
 *  a heading: a helipad has no pattern to draw. */
export function runwayInUse(runways: Runway[]): InUse | null {
  const open = runways.filter(r => !r.closed && (r.runway_ends ?? []).some(e => e.heading_true_deg != null));
  const winded = open
    .filter(r => r.wind)
    // Calm, the one the field's last wind favoured first (in_use).
    .sort((a, b) => Number(!!b.wind!.in_use) - Number(!!a.wind!.in_use) || b.wind!.headwind_kt - a.wind!.headwind_kt || mostUsed(a, b));
  for (const runway of winded) {
    const end = runway.runway_ends?.find(e => e.ident === runway.wind!.end && e.heading_true_deg != null);
    if (end) return { runway, end, byWind: true };
  }
  const longest = [...open].sort(mostUsed)[0];
  const end = longest?.runway_ends?.find(e => e.heading_true_deg != null);
  return longest && end ? { runway: longest, end, byWind: false } : null;
}

/** The runways the pilot picked in FPL, by field, as the address keeps
 *  them (lib/fieldLists): `pattern` holds the departure's runway out and
 *  every other field's runway in, `takeoff` a stop's runway out. A pick of
 *  "NONE" (trafficPattern's NO_PATTERN) is the pilot's no runway. */
export interface RunwayPicks {
  pattern: Map<string, string>;
  takeoff: Map<string, string>;
}

/** The end the pilot picked at `ident` for a takeoff or a landing, by the
 *  field's ICAO or FAA ident alike (a stop typed UES is KUES to the
 *  planner); null with no pick. */
export function pickedEnd(picks: RunwayPicks | null | undefined, ident: string, kind: "takeoff" | "landing", departure: boolean): string | null {
  if (!picks) return null;
  const map = kind === "takeoff" && !departure ? picks.takeoff : picks.pattern;
  const bare = (i: string) => (i.length === 4 && i.startsWith("K") ? i.slice(1) : i).toUpperCase();
  for (const [field, end] of map) if (bare(field) === bare(ident)) return end === "NONE" ? null : end;
  return null;
}

/** The runway end flown at a field: the pilot's pick in FPL where they
 *  made one (`picked`, the end as painted, "24"), else the one most nearly
 *  into the wind, else the longest (runwayInUse). One rule for the radio
 *  calls, the kneeboard, the mock oral and the runway check, which each
 *  chose their own and never saw the pilot's pick: the runway checked for
 *  length could be a long one while a short one was picked. */
export function runwayFlown(runways: Runway[], picked: string | null | undefined): InUse | null {
  if (picked) {
    for (const runway of runways.filter(r => !r.closed)) {
      const end = runway.runway_ends?.find(e => runwayNumber(e.ident) === runwayNumber(picked) && e.heading_true_deg != null);
      if (end) return { runway, end, byWind: runway.wind?.end === end.ident };
    }
  }
  return runwayInUse(runways);
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
  /** A variable wind's speed (VRB), picked as calm is: no direction to
   *  take a runway into. */
  variableKt?: number;
  /** Calm now, `ident` the runway the field's last wind favoured, the one
   *  in use (the planner's RunwayWind.in_use); calm and not, the longest. */
  inUse?: boolean;
  from: { ident: string; nm: number } | null;
  /** Picked into the wind a TAF forecasts for when the airplane is there,
   *  s since 1970 (windPick's `forecastAt`); none, the wind reported now. */
  forecastAt?: number | null;
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
 * most headwind, the longer runway on a tie. Calm is said as calm, and
 * picks, at the owner's ask ("when winds are calm just pick the currently
 * used or most used runway"), the runway the field's last wind favoured
 * where the planner knows it, else the longest. None with no wind to go
 * by, or a variable one. With
 * `forecastAt`, `nearby` is a TAF's wind for then (the owner's pick,
 * 2026-10-20), the report now set aside.
 */
export function windPick(runways: Runway[], nearby?: ReportedWind | null, forecastAt?: number): WindPick | null {
  // A forecast's wind is worked out here alone: the planner's runway winds
  // are the field's report now.
  const own = forecastAt == null ? runwayInUse(runways) : null;
  if (own?.byWind && own.runway.wind) {
    const w = own.runway.wind;
    const calm = calmOnRunway(w);
    return {
      ident: runwayNumber(own.end.ident), headwindKt: w.headwind_kt, crosswindKt: w.crosswind_kt, gustCrosswindKt: w.gust_crosswind_kt ?? null,
      calm, ...(calm && w.in_use ? { inUse: true } : {}), from: null,
    };
  }
  if (!nearby || nearby.speedKt == null) return null;
  // Its own TAF, at the field, is said as the field's; another's by name.
  const from = nearby.distanceNm === 0 ? null : { ident: nearby.station, nm: Math.round(nearby.distanceNm) };
  const forecast = forecastAt != null ? { forecastAt } : {};
  const ends = runways
    .filter(r => !r.closed)
    .flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e, heading: e.heading_true_deg! })));
  if (ends.length === 0) return null;
  if (isCalm(nearby.speedKt)) {
    const longest = runwayInUse(runways);
    return { ident: longest ? runwayNumber(longest.end.ident) : "", headwindKt: 0, crosswindKt: 0, gustCrosswindKt: null, calm: true, from, ...forecast };
  }
  if (nearby.dirTrueDeg == null) {
    // A variable wind (VRB, FAA Order JO 7900.5) has no direction to land
    // into: the runway in use or the longest, as calm, at the owner's
    // screenshot (C81 under KUGN's VRB06KT left with no runway at all).
    const longest = runwayInUse(runways);
    return {
      ident: longest ? runwayNumber(longest.end.ident) : "", headwindKt: 0, crosswindKt: 0, gustCrosswindKt: null,
      calm: true, variableKt: Math.round(nearby.speedKt), from, ...forecast,
    };
  }
  const dir = nearby.dirTrueDeg, speed = nearby.speedKt;
  const best = [...ends].sort((a, b) => headwindKt(dir, speed, b.heading) - headwindKt(dir, speed, a.heading)
    || (b.runway.length_ft ?? 0) - (a.runway.length_ft ?? 0))[0]!;
  return {
    ident: runwayNumber(best.end.ident), headwindKt: Math.round(headwindKt(dir, speed, best.heading)),
    crosswindKt: Math.round(crosswindKt(dir, speed, best.heading)),
    gustCrosswindKt: nearby.gustKt ? Math.round(crosswindKt(dir, nearby.gustKt, best.heading)) : null, calm: false, from, ...forecast,
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
