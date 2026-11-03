/**
 * A wind on a runway or a course: how much of it is along and how much
 * across, the gust's crosswind against the steady one, and when a wind
 * is calm. One owner for the sums the runway check, the runway chips,
 * the pattern's pick, the pilot's minimums and the holding page each did
 * their own way.
 *
 * Worked out by the shared engine (native/engine/src/runway/wind.rs,
 * through lib/engine), the very code behind the planner's
 * vfr.runway_wind and the phones' wt_call: the rules and their sources
 * live there.
 */
import type { Runway } from "./api/types";
import { callEngine } from "./engine/engine";

interface Components { headwind_kt: number; crosswind_kt: number }

/** The headwind of a wind from `fromDeg` at `kt` on a heading of
 *  `headingDeg`, the same reference both (true for a METAR's wind and a
 *  runway's true heading): negative for a tailwind -- as the planner's
 *  vfr.runway_wind.components_kt. */
export function headwindKt(fromDeg: number, kt: number, headingDeg: number): number {
  return callEngine<Components>("wind_components", { from_deg: fromDeg, kt, heading_deg: headingDeg }).headwind_kt;
}

/** The crosswind of that wind: positive from the right, negative from
 *  the left, as vfr.runway_wind.components_kt. */
export function crosswindKt(fromDeg: number, kt: number, headingDeg: number): number {
  return callEngine<Components>("wind_components", { from_deg: fromDeg, kt, heading_deg: headingDeg }).crosswind_kt;
}

/** The crosswind a wind is judged by, steady or in the gusts, whichever
 *  is more, unsigned: a pilot meets the gust's crosswind in the flare, so
 *  that is the one held against the demonstrated crosswind or a personal
 *  minimum -- a design choice that errs toward the stronger wind. */
export function steadyOrGustKt(steadyKt: number, gustKt: number | null | undefined): number {
  return callEngine<number>("wind_steady_or_gust", { steady_kt: steadyKt, gust_kt: gustKt ?? null });
}

/** A runway's wind as the planner works it out (vfr.runway_wind), judged
 *  by steadyOrGustKt. */
export function runwayCrosswindKt(wind: Pick<NonNullable<Runway["wind"]>, "crosswind_kt" | "gust_crosswind_kt">): number {
  return callEngine<number>("runway_crosswind", { wind: { crosswind_kt: wind.crosswind_kt, gust_crosswind_kt: wind.gust_crosswind_kt ?? null } });
}

/**
 * Whether a reported or forecast wind is calm: a speed of nothing, which
 * a METAR and a TAF code as 00000KT (AIM 7-1-28). No speed at all is a
 * wind not reported, never a calm one.
 */
export function isCalm(speedKt: number | null | undefined): boolean {
  return callEngine<boolean>("wind_calm", { speed_kt: speedKt ?? null });
}

/** Whether a runway's wind from the planner is a calm one: nothing along,
 *  across or in the gusts, which only a speed of 0 leaves. */
export function calmOnRunway(wind: NonNullable<Runway["wind"]>): boolean {
  return callEngine<boolean>("runway_calm", { wind });
}
