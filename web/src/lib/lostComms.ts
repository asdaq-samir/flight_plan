/**
 * Two-way radio failure under IFR (the roadmap's lost-comms calculator,
 * 14 CFR 91.185, ACS IR.VII.A): the route to fly, the altitude on each
 * segment of it, and when to leave the clearance limit, each worked from
 * the clearance as the rule words it. In VFR conditions there is nothing
 * to work: continue VFR and land as soon as practicable (91.185(b)).
 *
 * Worked out by the shared engine (native/crates/figures/src/figures/lost_comms.rs,
 * through lib/engine), the very code behind the planner's /api/lost-comms
 * and the phones' wt_lost_comms: the routes' labels and rules, VFR's words
 * and each segment's line too, so the page writes none of 91.185's words
 * itself.
 */
import { callEngine, type EngineAnswer } from "./engine/engine";

/** The engine's "lost_comms" answer, as /api/lost-comms gives it. */
export type LostCommsAnswer = EngineAnswer<"lost_comms">;

export type RouteKey = LostCommsAnswer["routes"][number]["key"];

/** 91.185(c)(1): the routes, in the rule's order -- the first that
 *  applies -- each its key, label and the rule's words; and 91.185(b)'s
 *  words for VFR conditions. The engine's, asked with no segments. */
export function lostCommsWords(): Pick<LostCommsAnswer, "routes" | "vfr"> {
  const { routes, vfr } = callEngine("lost_comms", { segments: [] });
  return { routes, vfr };
}

export interface Segment {
  name: string;
  /** The minimum altitude for IFR operations on it: the MEA, or an OROCA
   *  or MOCA where the pilot is working off-airway. */
  minimumFt: number | null;
}

export interface Clearance {
  assignedFt: number | null;
  expectedFt: number | null;
  /** The segment the expected altitude applies from ("expect 6,000 ten
   *  minutes after departure" is from where the airplane is then): its
   *  index; before it, only the assigned and the minimum count. */
  expectedFrom: number;
}

export type Because = "assigned" | "minimum" | "expected";

/** 91.185(c)(2): on each segment, the highest of the altitude assigned,
 *  the minimum for IFR operations, and the altitude ATC said to expect --
 *  and which it was. Null where none is known. A segment with no name is
 *  "Segment", as the planner names it. */
export function segmentAltitudes(segments: Segment[], c: Clearance): { name: string; fly: number | null; because: Because | null; words: string }[] {
  const answer = callEngine("lost_comms", {
    segments: segments.map(s => ({ name: s.name, minimum_ft: s.minimumFt })),
    assigned_ft: c.assignedFt, expected_ft: c.expectedFt, expected_from: c.expectedFrom,
  });
  // `words` the page's line for it: "Fly 6,000 ft: expected".
  return answer.segments.map(({ name, fly, because, words }) => ({ name, fly, because, words }));
}

/** 91.185(c)(3): when to leave the clearance limit, in words. */
export function leaveLimit(approachFix: boolean, efc: string, eta: string): string {
  return callEngine("lost_comms", { segments: [], approach_fix: approachFix, efc, eta }).leave;
}
