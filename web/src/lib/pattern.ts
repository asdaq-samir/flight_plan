/**
 * An airport's traffic pattern for the runway a pilot would land on, as
 * AC 90-66C flies it (the roadmap's pattern card, ACS PA.III.B): the end
 * the reported wind favours, which side of it the downwind is flown
 * (left unless the FAA says right, 14 CFR 91.126(b)(1)), and how to join
 * it from the way the route arrives -- the 45° to the downwind abeam
 * midfield at pattern altitude from the pattern's side, or over the
 * field 500 ft above it and back to the 45 from the other.
 *
 * Worked out by the shared engine (native/crates/brief/src/runway/pick.rs and
 * wind.rs, through lib/engine), the very code behind the planner's
 * wingtip.pattern and wingtip.runway_wind and the phones' wt_call: the rules and
 * their AC 90-66C and 14 CFR sources live there. Only the shapes the
 * pages read are made here.
 */
import type { Runway } from "./api/types";
import { callEngine, type EngineAnswer } from "./engine/engine";

export type RunwayEnd = NonNullable<Runway["runway_ends"]>[number];

/** A true bearing as a pilot says a direction: "southwest" (lib/compass). */
export { compassWord } from "./compass";

export interface InUse {
  runway: Runway;
  end: RunwayEnd;
  /** Whether the reported wind chose it; if not, it is the most used
   *  runway's (paved, then the longest) first end, for want of a wind. */
  byWind: boolean;
}

const inUse = (runways: Runway[], f: EngineAnswer<"gonogo_runway_flown">): InUse | null => {
  if (!f) return null;
  const runway = runways[f.runway]!;
  return { runway, end: runway.runway_ends![f.end]!, byWind: f.by_wind };
};

/** The runway end a pilot would take off from and land on: of the ends
 *  the reported wind favours on each runway (wingtip.runway_wind), the one
 *  with the most headwind -- AC 90-66C 11.5's runway most nearly into the
 *  wind -- or, with no wind reported, the runway most used's (paved, then
 *  the longest) first end. Only ends with a heading: a helipad has no
 *  pattern to draw. */
export function runwayInUse(runways: Runway[]): InUse | null {
  return inUse(runways, callEngine("gonogo_runway_in_use", { runways }));
}

/** The runways the pilot picked in FPL, by field, as the address keeps
 *  them (lib/fieldLists): `pattern` holds the departure's runway out and
 *  every other field's runway in, `takeoff` a stop's runway out. An older
 *  address's "NONE" (the None chip's, gone) is no pick. */
export interface RunwayPicks {
  pattern: Map<string, string>;
  takeoff: Map<string, string>;
}

/** The end the pilot picked at `ident` for a takeoff or a landing, by the
 *  field's ICAO or FAA ident alike (a stop typed UES is KUES to the
 *  planner); null with no pick. */
export function pickedEnd(picks: RunwayPicks | null | undefined, ident: string, kind: "takeoff" | "landing", departure: boolean): string | null {
  if (!picks) return null;
  return callEngine("gonogo_picked_end", {
    picks: { pattern: [...picks.pattern], takeoff: [...picks.takeoff] }, ident, kind, departure,
  });
}

/** The runway end flown at a field: the pilot's pick in FPL where they
 *  made one (`picked`, the end as painted, "24"), else the one most nearly
 *  into the wind, else the longest (runwayInUse). One rule for the radio
 *  calls, the kneeboard, the mock oral and the runway check, which each
 *  chose their own and never saw the pilot's pick: the runway checked for
 *  length could be a long one while a short one was picked. */
export function runwayFlown(runways: Runway[], picked: string | null | undefined): InUse | null {
  return inUse(runways, callEngine("gonogo_runway_flown", { runways, picked: picked ?? null }));
}

/** The wind a field's runways are chosen by: the end it favours as
 *  painted ("27"), its head- and crosswind and the gust's crosswind to the
 *  knot (wingtip.runway_wind), whether it is calm, and where it was reported
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
 * own report's, worked out by the planner on each runway (wingtip.runway_wind,
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
  const p = callEngine("wind_pick", {
    runways,
    nearby: nearby
      ? { station: nearby.station, distance_nm: nearby.distanceNm, dir_true_deg: nearby.dirTrueDeg ?? null, speed_kt: nearby.speedKt ?? null, gust_kt: nearby.gustKt ?? null }
      : null,
    forecast_at: forecastAt ?? null,
  });
  if (!p) return null;
  return {
    ident: p.ident, headwindKt: p.headwind_kt, crosswindKt: p.crosswind_kt, gustCrosswindKt: p.gust_crosswind_kt, calm: p.calm,
    ...(p.variable_kt != null ? { variableKt: p.variable_kt } : {}), ...(p.in_use ? { inUse: true } : {}), from: p.from,
    ...(p.forecast_at != null ? { forecastAt: p.forecast_at } : {}),
  };
}

/** The true bearing from the runway to its downwind: off the left of
 *  the landing direction for left traffic, the right for right. */
export function patternSideDeg(end: RunwayEnd): number {
  return callEngine("pattern_side", { heading_true_deg: end.heading_true_deg ?? null, traffic: end.traffic });
}

/** A runway end as written: "9" for "09", as a US runway is painted. */
export function runwayNumber(ident: string): string {
  return callEngine("gonogo_runway_number", { ident });
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
  const e = callEngine("pattern_entry", {
    end: { ident: end.ident, heading_true_deg: end.heading_true_deg ?? null, traffic: end.traffic }, course_deg: courseDeg,
  });
  return { from: e.from, patternSide: e.pattern_side, words: e.words };
}

/** How to leave the pattern from `end` (AC 90-66C 11.8): straight out,
 *  or a 45° turn the pattern's way once past the departure end at
 *  pattern altitude. */
export function exitFor(end: RunwayEnd): string {
  return callEngine("pattern_exit", { traffic: end.traffic });
}
