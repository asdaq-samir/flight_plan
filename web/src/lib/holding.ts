/**
 * Holding-pattern entries and wind (the roadmap's holding visualiser, ACS
 * IR.III.B), as AIM 5-3-8 gives them: the entry from the airplane's
 * heading to the fix against the holding course -- direct from the 180°
 * sector, teardrop from the 70° one on the non-holding side beyond the
 * fix, parallel from the 110° one on the holding side -- the 70° line
 * drawn on the holding side, for left turns mirrored; and the inbound leg
 * at a minute (a minute and a half above 14,000 ft MSL), the outbound
 * heading and time worked to make it so in the wind.
 *
 * Worked out by the shared engine (native/crates/figures/src/figures/holding.rs,
 * through lib/engine), the very code behind the planner's /api/holding and
 * the phones' wt_holding: the rules and their AIM sources live there. Only
 * the shapes the pages read are made here.
 */
import { callEngine } from "./engine/engine";

export type Entry = "direct" | "teardrop" | "parallel";
export type Turns = "right" | "left";

interface Leg { heading: number; wca: number; gs: number }

/** The inbound leg's time at an altitude, minutes: "At or below 14,000
 *  feet MSL: 1 minute. Above 14,000 feet MSL: 1 1/2 minutes" (AIM 5-3-8
 *  j.4(a)), as the planner's wingtip.holds times a hold with none given. */
export function legMinutes(altitudeFt: number): number {
  return callEngine("holding_leg_minutes", { altitude_ft: altitudeFt });
}

/**
 * The entry for an airplane heading `headingDeg` to the fix of a hold on
 * `inboundDeg` with `turns`: by AIM 5-3-8's sectors, the heading against
 * the inbound course -- for right turns, direct within 110° right to 70°
 * left of it, teardrop beyond 110° right to the reciprocal, parallel
 * beyond the reciprocal to 70° left; left turns their mirror. `either`
 * where it is within 5° of a sector's edge, where the AIM lets a pilot
 * use either entry ("+/- 5 degrees in heading", AIM 5-3-8 j.8(d)).
 */
export function holdingEntry(inboundDeg: number, headingDeg: number, turns: Turns): { entry: Entry; either: Entry | null } {
  const held = callEngine("holding", { inbound: inboundDeg, heading: headingDeg, turns });
  return { entry: held.entry, either: held.either };
}

/** AIM 5-3-8's words for the entry an airplane heading `headingDeg` to
 *  the fix flies, for the turns given: the engine's (holding.rs
 *  entry_steps), its outbound minute a minute and a half above 14,000 ft
 *  MSL. */
export function entrySteps(inboundDeg: number, headingDeg: number, turns: Turns, altitudeFt: number): string {
  return callEngine("holding", { inbound: inboundDeg, heading: headingDeg, turns, altitude_ft: altitudeFt }).steps;
}

/** The bearing from the fix the airplane comes from, against the inbound
 *  course, for drawing: where it is on the page round the fix. */
export function approachRelative(inboundDeg: number, headingDeg: number): number {
  return callEngine("holding", { inbound: inboundDeg, heading: headingDeg }).approach_relative;
}

export interface HoldingWind {
  /** The inbound leg's time, minutes: 1, or 1.5 above 14,000 ft MSL. */
  legMin: number;
  inbound: Leg;
  /** The outbound heading: triple the inbound drift correction, the other
   *  way (AIM 5-3-8 j.8(c)), so the turns' drift is taken up too. */
  outbound: Leg;
  /** The outbound time, seconds, for the inbound leg to take legMin: the
   *  legs' ground speeds, the turns left out. */
  outboundSec: number;
  /** A rule of thumb with no FAA figure behind it -- a second a knot of
   *  the wind along the course; the AIM asks only that the outbound time be
   *  set to make the inbound leg's (5-3-8 j.4(a)). */
  ruleSec: number;
  /** The rows' lines under the figures, the engine's (holding.rs
   *  wind_words): inbound, outbound and the time. */
  words: { inbound: string; outbound: string; time: string };
}

/** The legs flown in a wind from `windFromDeg` at `windKt` at `tasKt`, the
 *  courses and the wind in the same reference (magnetic, as a clearance
 *  gives the course). Null where the wind is stronger than the airplane. */
export function holdingWind(inboundDeg: number, tasKt: number, windFromDeg: number, windKt: number, altitudeFt: number): HoldingWind | null {
  const { wind } = callEngine("holding", {
    inbound: inboundDeg, heading: inboundDeg, tas_kt: tasKt, wind_from: windFromDeg, wind_kt: windKt, altitude_ft: altitudeFt,
  });
  if (!wind) return null;
  const leg = (l: Leg): Leg => ({ heading: l.heading, wca: l.wca, gs: l.gs });
  return { legMin: wind.leg_min, inbound: leg(wind.inbound), outbound: leg(wind.outbound), outboundSec: wind.outbound_sec, ruleSec: wind.rule_sec,
    words: { inbound: wind.inbound_words, outbound: wind.outbound_words, time: wind.time_words } };
}
