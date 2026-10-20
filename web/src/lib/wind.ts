/**
 * A wind on a runway or a course: how much of it is along and how much
 * across, the gust's crosswind against the steady one, and when a wind
 * is calm. One owner for the sums the runway check, the runway chips,
 * the pattern's pick, the pilot's minimums and the holding page each did
 * their own way.
 */
import type { Runway } from "./api/types";
import { rad } from "./geo";

/** The headwind of a wind from `fromDeg` at `kt` on a heading of
 *  `headingDeg`, the same reference both (true for a METAR's wind and a
 *  runway's true heading): negative for a tailwind -- as the planner's
 *  vfr.runway_wind.components_kt. */
export function headwindKt(fromDeg: number, kt: number, headingDeg: number): number {
  return kt * Math.cos(rad(fromDeg - headingDeg));
}

/** The crosswind of that wind: positive from the right, negative from
 *  the left, as vfr.runway_wind.components_kt. */
export function crosswindKt(fromDeg: number, kt: number, headingDeg: number): number {
  return kt * Math.sin(rad(fromDeg - headingDeg));
}

/** The crosswind a wind is judged by, steady or in the gusts, whichever
 *  is more, unsigned: a pilot meets the gust's crosswind in the flare, so
 *  that is the one held against the demonstrated crosswind or a personal
 *  minimum -- a design choice that errs toward the stronger wind. */
export function steadyOrGustKt(steadyKt: number, gustKt: number | null | undefined): number {
  return Math.max(Math.abs(steadyKt), Math.abs(gustKt ?? 0));
}

/** A runway's wind as the planner works it out (vfr.runway_wind), judged
 *  by steadyOrGustKt. */
export function runwayCrosswindKt(wind: Pick<NonNullable<Runway["wind"]>, "crosswind_kt" | "gust_crosswind_kt">): number {
  return steadyOrGustKt(wind.crosswind_kt, wind.gust_crosswind_kt);
}

/**
 * Whether a reported or forecast wind is calm: a speed of nothing, which
 * a METAR and a TAF code as 00000KT (AIM 7-1-28's key, "00000KT for
 * calm"; a TAF's calm is 3 knots or less, forecast as 00000KT, AIM
 * 7-1-29). No speed at all is a wind not reported, never a calm one.
 */
export function isCalm(speedKt: number | null | undefined): boolean {
  return speedKt === 0;
}

/** Whether a runway's wind from the planner is a calm one: it puts no
 *  head-, cross- or gust's crosswind on the end only for a speed of 0
 *  (vfr.runway_wind.favoured_end). Any reported knot leaves at least
 *  0.71 kt along or across a runway, which rounds to 1, so this is
 *  isCalm on the report it was worked out from. */
export function calmOnRunway(wind: NonNullable<Runway["wind"]>): boolean {
  return wind.headwind_kt === 0 && wind.crosswind_kt === 0 && wind.gust_crosswind_kt == null;
}
