/**
 * The holds the pilot put on the route's points, as the address keeps
 * them (`holds`) and the planner reads them (vfr.holds): the point, its
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

import { bearing } from "./units";

const HOLD = /^([A-Z0-9/.]+):(\d{1,3}):([RL]):(\d{1,2}(?:\.\d)?)([MN]):(\d{1,3})([TM])$/;

/** One hold as the address writes it, or null. */
export function holdOf(text: string): Hold | null {
  const m = HOLD.exec(text.trim().toUpperCase());
  if (!m || Number(m[2]) > 360) return null;
  const leg = Number(m[4]), length = Number(m[6]);
  if (!(leg > 0) || !(length > 0)) return null;
  return {
    fix: m[1]!, inbound: Number(m[2]) % 360, right: m[3] === "R",
    leg: m[5] === "M" ? { min: leg } : { nm: leg },
    length: m[7] === "T" ? { turns: length } : { minutes: length },
  };
}

/** How long a hold is held, as the address codes it: "2T", "10M". */
export function lengthCode(length: Hold["length"]): string {
  return "turns" in length ? `${length.turns}T` : `${length.minutes}M`;
}

/** A length's code read back ("2T" two turns, "10M" ten minutes), or
 *  null for one that is not. */
export function lengthOfCode(code: string): Hold["length"] | null {
  const m = /^(\d{1,3})([TM])$/.exec(code.trim().toUpperCase());
  if (!m || !(Number(m[1]) > 0)) return null;
  return m[2] === "T" ? { turns: Number(m[1]) } : { minutes: Number(m[1]) };
}

/** How long a hold is held, in words: "2 turns", "1 turn", "10 min". */
export function lengthWords(length: Hold["length"]): string {
  return "turns" in length ? `${length.turns} ${length.turns === 1 ? "turn" : "turns"}` : `${length.minutes} min`;
}

/** A hold as the address writes it: the inbound course in three figures,
 *  000 for north, as the planner reads it (vfr.holds). */
export function holdText(hold: Hold): string {
  const leg = "min" in hold.leg ? `${hold.leg.min}M` : `${hold.leg.nm}N`;
  return `${hold.fix}:${String(hold.inbound).padStart(3, "0")}:${hold.right ? "R" : "L"}:${leg}:${lengthCode(hold.length)}`;
}

/** The address's holds, each valid one, by its point: an airport, a
 *  fix, or the pilot's own point off one, not a present position. */
export function holdsOf(value: string | null | undefined): Hold[] {
  return (value ?? "").split(",").map(holdOf).filter((h): h is Hold => h !== null);
}

export const holdsParam = (holds: Hold[]) => holds.map(holdText).join(",");

/** A hold said in a few words, as its row in FPL's list says it: "Right
 *  turns · 270° inbound · 1 min legs · 2 turns", north as 360°
 *  (units.bearing). */
export function holdWords(hold: Hold): string {
  const leg = "min" in hold.leg ? `${hold.leg.min} min legs` : `${hold.leg.nm} nm legs`;
  return `${hold.right ? "Right" : "Left"} turns · ${bearing(hold.inbound)} inbound · ${leg} · ${lengthWords(hold.length)}`;
}
