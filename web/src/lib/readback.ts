/**
 * The pilot's readback of a clearance checked against it (AIM 4-4-7 b:
 * pilots read back "those parts of ATC clearances and instructions
 * containing altitude assignments, vectors, or runway assignments", and
 * 4-4-7 b.3 the altimeter, frequencies and codes): the limit, the places
 * of the route, the altitude to maintain and the one to expect, the
 * frequency and the squawk. The check is the shared engine's
 * (native/engine/src/readback.rs, the rule readback_check), held to
 * fixtures/readbacks.json as this module's test is; what was missed or
 * said differently is shown as a warning line in the microphone's pill
 * (RadioLayer) and never stops anything. How an altitude is written on
 * the screen stays here.
 */
import { callEngine } from "./engine/engine";
import { grouped } from "./units";

export interface ReadbackItem {
  item: "limit" | "route" | "altitude" | "expect" | "frequency" | "squawk";
  cleared: string;
  /** What the readback had for it; null where it was not read back. */
  said: string | null;
}

/** An altitude as ATC says it (AIM 4-2-9): feet below 18,000, a flight
 *  level from there up. The clearance card writes its altitudes with it. */
export const altitudeWords = (ft: number) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${grouped(ft)} ft`);

/** The items of the clearance heard as `cleared` that the readback `said`
 *  missed or had differently (none where it matches), and the warning
 *  line for them: "Readback complete.", or "Readback: altitude 4,000 ft
 *  said, 5,000 ft cleared; squawk 4512 not read back." */
export function readbackCheck(cleared: string, said: string): { items: ReadbackItem[]; words: string } {
  return callEngine("readback_check", { cleared, said });
}
