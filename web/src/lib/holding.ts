/**
 * Holding-pattern entries and wind (the roadmap's holding visualiser, ACS
 * IR.III.B), as AIM 5-3-8 gives them: the entry from the aeroplane's
 * heading to the fix against the holding course -- direct from the 180°
 * sector, teardrop from the 70° one on the non-holding side beyond the
 * fix, parallel from the 110° one on the holding side -- the 70° line
 * drawn on the holding side, for left turns mirrored; and the inbound leg
 * at a minute (a minute and a half above 14,000 ft MSL), the outbound
 * heading and time worked to make it so in the wind.
 */
import { windTriangle } from "./diversion";

export type Entry = "direct" | "teardrop" | "parallel";
export type Turns = "right" | "left";

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** How far apart two directions are, 0 to 180. */
const apart = (a: number, b: number) => {
  const d = norm(a - b);
  return d > 180 ? 360 - d : d;
};

/**
 * The entry for an aeroplane heading `headingDeg` to the fix of a hold on
 * `inboundDeg` with `turns`: by AIM 5-3-8's sectors, the heading against
 * the inbound course -- for right turns, direct within 110° right to 70°
 * left of it, teardrop beyond 110° right to the reciprocal, parallel
 * beyond the reciprocal to 70° left; left turns their mirror. `either`
 * where it is within 5° of a sector's edge, where the AIM lets a pilot
 * use either entry.
 */
export function holdingEntry(inboundDeg: number, headingDeg: number, turns: Turns): { entry: Entry; either: Entry | null } {
  const off = norm(turns === "right" ? headingDeg - inboundDeg : inboundDeg - headingDeg);
  const entry: Entry = off <= 110 || off >= 290 ? "direct" : off <= 180 ? "teardrop" : "parallel";
  const edges: [number, Entry, Entry][] = [[110, "direct", "teardrop"], [180, "teardrop", "parallel"], [290, "parallel", "direct"]];
  const near = edges.find(([at]) => apart(off, at) <= 5);
  return { entry, either: near ? (near[1] === entry ? near[2] : near[1]) : null };
}

/** The bearing from the fix the aeroplane comes from, against the inbound
 *  course, for drawing: where it is on the page round the fix. */
export function approachRelative(inboundDeg: number, headingDeg: number): number {
  return norm(headingDeg + 180 - inboundDeg);
}

export interface HoldingWind {
  /** The inbound leg's time, minutes: 1, or 1.5 above 14,000 ft MSL. */
  legMin: number;
  inbound: { heading: number; wca: number; gs: number };
  /** The outbound heading by the rule of three: three times the inbound
   *  correction, the other way, so the turns' drift is taken up too. */
  outbound: { heading: number; wca: number; gs: number };
  /** The outbound time, seconds, for the inbound leg to take legMin: the
   *  legs' ground speeds, the turns left out. */
  outboundSec: number;
  /** The rule of thumb's: a second a knot of the wind along the course. */
  ruleSec: number;
}

/** The legs flown in a wind from `windFromDeg` at `windKt` at `tasKt`, the
 *  courses and the wind in the same reference (magnetic, as a clearance
 *  gives the course). Null where the wind is stronger than the aeroplane. */
export function holdingWind(inboundDeg: number, tasKt: number, windFromDeg: number, windKt: number, altitudeFt: number): HoldingWind | null {
  const legMin = altitudeFt > 14_000 ? 1.5 : 1;
  const outboundDeg = norm(inboundDeg + 180);
  const inbound = windTriangle(inboundDeg, tasKt, windFromDeg, windKt);
  const outLeg = windTriangle(outboundDeg, tasKt, windFromDeg, windKt);
  if (!inbound || !outLeg) return null;
  const outWca = -3 * inbound.wca;
  const headwindIn = windKt * Math.cos(((windFromDeg - inboundDeg) * Math.PI) / 180);
  return {
    legMin,
    inbound: { heading: norm(inboundDeg + inbound.wca), wca: inbound.wca, gs: inbound.gs },
    outbound: { heading: norm(outboundDeg + outWca), wca: outWca, gs: outLeg.gs },
    outboundSec: (legMin * 60 * inbound.gs) / outLeg.gs,
    // A headwind inbound is a tailwind outbound: shorten the outbound leg.
    ruleSec: legMin * 60 - headwindIn,
  };
}
