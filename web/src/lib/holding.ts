// The planner's app/figures/holding.py holds the same rules for the native app (GET /api/holding): the two change together.
/**
 * Holding-pattern entries and wind (the roadmap's holding visualiser, ACS
 * IR.III.B), as AIM 5-3-8 gives them: the entry from the airplane's
 * heading to the fix against the holding course -- direct from the 180°
 * sector, teardrop from the 70° one on the non-holding side beyond the
 * fix, parallel from the 110° one on the holding side -- the 70° line
 * drawn on the holding side, for left turns mirrored; and the inbound leg
 * at a minute (a minute and a half above 14,000 ft MSL), the outbound
 * heading and time worked to make it so in the wind.
 */
import { windTriangle } from "./diversion";
import { angleBetween, normalizeDeg } from "./geo";
import { headwindKt } from "./wind";

export type Entry = "direct" | "teardrop" | "parallel";
export type Turns = "right" | "left";

/** The inbound leg's time at an altitude, minutes: "At or below 14,000
 *  feet MSL: 1 minute. Above 14,000 feet MSL: 1 1/2 minutes" (AIM 5-3-8
 *  j.4(a)), as the planner's vfr.holds times a hold with none given. */
export function legMinutes(altitudeFt: number): number {
  return altitudeFt > 14_000 ? 1.5 : 1;
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
  const off = normalizeDeg(turns === "right" ? headingDeg - inboundDeg : inboundDeg - headingDeg);
  const entry: Entry = off <= 110 || off >= 290 ? "direct" : off <= 180 ? "teardrop" : "parallel";
  const edges: [number, Entry, Entry][] = [[110, "direct", "teardrop"], [180, "teardrop", "parallel"], [290, "parallel", "direct"]];
  const near = edges.find(([at]) => angleBetween(off, at) <= 5);
  return { entry, either: near ? (near[1] === entry ? near[2] : near[1]) : null };
}

/** The bearing from the fix the airplane comes from, against the inbound
 *  course, for drawing: where it is on the page round the fix. */
export function approachRelative(inboundDeg: number, headingDeg: number): number {
  return normalizeDeg(headingDeg + 180 - inboundDeg);
}

export interface HoldingWind {
  /** The inbound leg's time, minutes: 1, or 1.5 above 14,000 ft MSL. */
  legMin: number;
  inbound: { heading: number; wca: number; gs: number };
  /** The outbound heading: triple the inbound drift correction, the other
   *  way (AIM 5-3-8 j.8(c)), so the turns' drift is taken up too. */
  outbound: { heading: number; wca: number; gs: number };
  /** The outbound time, seconds, for the inbound leg to take legMin: the
   *  legs' ground speeds, the turns left out. */
  outboundSec: number;
  /** A rule of thumb with no FAA figure behind it -- a second a knot of
   *  the wind along the course; the AIM asks only that the outbound time be
   *  set to make the inbound leg's (5-3-8 j.4(a)). */
  ruleSec: number;
}

/** The legs flown in a wind from `windFromDeg` at `windKt` at `tasKt`, the
 *  courses and the wind in the same reference (magnetic, as a clearance
 *  gives the course). Null where the wind is stronger than the airplane. */
export function holdingWind(inboundDeg: number, tasKt: number, windFromDeg: number, windKt: number, altitudeFt: number): HoldingWind | null {
  const legMin = legMinutes(altitudeFt);
  const outboundDeg = normalizeDeg(inboundDeg + 180);
  const inbound = windTriangle(inboundDeg, tasKt, windFromDeg, windKt);
  const outLeg = windTriangle(outboundDeg, tasKt, windFromDeg, windKt);
  if (!inbound || !outLeg) return null;
  const outWca = -3 * inbound.wca;
  const headwindIn = headwindKt(windFromDeg, windKt, inboundDeg);
  return {
    legMin,
    inbound: { heading: normalizeDeg(inboundDeg + inbound.wca), wca: inbound.wca, gs: inbound.gs },
    outbound: { heading: normalizeDeg(outboundDeg + outWca), wca: outWca, gs: outLeg.gs },
    outboundSec: (legMin * 60 * inbound.gs) / outLeg.gs,
    // A headwind inbound is a tailwind outbound: shorten the outbound leg.
    ruleSec: legMin * 60 - headwindIn,
  };
}
