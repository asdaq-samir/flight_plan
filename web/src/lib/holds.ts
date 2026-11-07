/**
 * The holds the pilot put on the route's points, as the address keeps
 * them (`holds`) and the planner reads them (wingtip.holds): the point, its
 * inbound course (magnetic), R or L, its legs by minutes ("1M") or nm
 * ("4N"), and how long, turns ("2T") or minutes ("10M") --
 * "VPBNG/090/30:270:R:1M:2T", several joined by commas.
 */
export interface Hold {
  fix: string;
  /** The inbound course to the fix, magnetic degrees. */
  inbound: number;
  right: boolean;
  /** Its legs: timed, or by distance. */
  leg: { min: number } | { nm: number };
  /** How long it is held: turns round it, or minutes. */
  length: { turns: number } | { minutes: number };
}

import type { RouteHold as EngineHold, RouteHoldIn } from "./engine/contract";
import { callEngine } from "./engine/engine";
import { bearing } from "./units";

// A hold as the engine reads and writes it (native/crates/route/src/route, the
// planner's wingtip.holds too) is the contract's RouteHold: flat, the legs
// and the length each one of two, the other null.

const fromEngine = (h: EngineHold): Hold => ({
  fix: h.fix, inbound: h.inbound, right: h.right,
  leg: h.leg_min != null ? { min: h.leg_min } : { nm: h.leg_nm! },
  length: h.turns != null ? { turns: h.turns } : { minutes: h.minutes! },
});

const toEngine = (h: Hold): RouteHoldIn => ({
  fix: h.fix, inbound: h.inbound, right: h.right,
  ...("min" in h.leg ? { leg_min: h.leg.min } : { leg_nm: h.leg.nm }),
  ...("turns" in h.length ? { turns: h.length.turns } : { minutes: h.length.minutes }),
});

/** One hold as the address writes it, or null: read by the shared engine
 *  (crate::route::holds), the one reading the planner and the phones
 *  have too. */
export function holdOf(text: string): Hold | null {
  const h = callEngine("hold_read", { text });
  return h && fromEngine(h);
}

/** How long a hold is held, as the address codes it: "2T", "10M". */
export function lengthCode(length: Hold["length"]): string {
  return callEngine("hold_length_write", length);
}

/** A length's code read back ("2T" two turns, "10M" ten minutes), or
 *  null for one that is not. */
export function lengthOfCode(code: string): Hold["length"] | null {
  return callEngine("hold_length_read", { text: code });
}

/** How long a hold is held, in words: "2 turns", "1 turn", "10 min". */
export function lengthWords(length: Hold["length"]): string {
  return "turns" in length ? `${length.turns} ${length.turns === 1 ? "turn" : "turns"}` : `${length.minutes} min`;
}

/** A hold as the address writes it: the inbound course in three figures,
 *  000 for north, as the planner reads it (wingtip.holds). */
export function holdText(hold: Hold): string {
  return callEngine("hold_write", { hold: toEngine(hold) });
}

/** The address's holds, each valid one, by its point: an airport, a
 *  fix, or the pilot's own point off one, not a present position. */
export function holdsOf(value: string | null | undefined): Hold[] {
  const read = callEngine("holds_read", { text: value ?? "" });
  return read.flatMap(({ hold }) => (hold ? [fromEngine(hold)] : []));
}

export const holdsParam = (holds: Hold[]) => holds.map(holdText).join(",");

/** A hold said in a few words, as its row in FPL's list says it: "Right
 *  turns · 270° inbound · 1 min legs · 2 turns", north as 360°
 *  (units.bearing). */
export function holdWords(hold: Hold): string {
  const leg = "min" in hold.leg ? `${hold.leg.min} min legs` : `${hold.leg.nm} nm legs`;
  return `${hold.right ? "Right" : "Left"} turns · ${bearing(hold.inbound)} inbound · ${leg} · ${lengthWords(hold.length)}`;
}
