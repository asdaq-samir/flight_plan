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
import { callEngine, type EngineAnswer } from "./engine/engine";
import type { Clearance } from "./clearance";
import { grouped } from "./units";

/** A part missed or said differently: what the readback had for it
 *  (`said`), null where it was not read back (the engine's contract). */
export type ReadbackItem = EngineAnswer<"readback_check">["items"][number];

/** The parts of a clearance in the order they are read back, each with
 *  its name on the screen (the iPhone's ReadbackCheck.parts). */
export const READBACK_PARTS: { item: ReadbackItem["item"]; name: string }[] = [
  { item: "limit", name: "limit" }, { item: "route", name: "route" }, { item: "altitude", name: "altitude" },
  { item: "expect", name: "expected altitude" }, { item: "frequency", name: "frequency" }, { item: "squawk", name: "squawk" },
];

/** The parts a clearance has, for the tick to name and the count to go by. */
export function clearanceParts(c: Clearance): ReadbackItem["item"][] {
  const has: ReadbackItem["item"][] = [];
  if (c.limit !== null || c.classB) has.push("limit");
  if (c.route.length > 0 || c.asFiled) has.push("route");
  if (c.maintainFt !== null) has.push("altitude");
  if (c.expectFt !== null) has.push("expect");
  if (c.frequency !== null) has.push("frequency");
  if (c.squawk !== null) has.push("squawk");
  return has;
}

/** One line under the read back: a tick for what was read back, a mark
 *  for each part missed or said differently. */
export interface ReadbackLine { ok: boolean; words: string }

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** The lines for a read back of `clearance` checked as `check`: the parts
 *  read back in one tick ("Limit, route and squawk read back"), then one
 *  line for each part missed ("Squawk 4512 not read back") or said
 *  differently ("Altitude: 4,000 ft said, 5,000 ft cleared"), as the
 *  iPhone's ReadbackCheck.lines writes them. */
export function readbackLines(clearance: Clearance, check: { items: ReadbackItem[] }): ReadbackLine[] {
  const has = clearanceParts(clearance);
  const missed = new Set(check.items.map(i => i.item));
  const read = READBACK_PARTS.filter(p => has.includes(p.item) && !missed.has(p.item)).map(p => p.name);
  const lines: ReadbackLine[] = [];
  if (read.length) {
    const list = read.length === 1 ? read[0]! : `${read.slice(0, -1).join(", ")} and ${read.at(-1)}`;
    lines.push({ ok: true, words: `${capital(list)} read back` });
  }
  for (const item of check.items) {
    const name = capital(READBACK_PARTS.find(p => p.item === item.item)?.name ?? item.item);
    lines.push({ ok: false, words: item.said !== null ? `${name}: ${item.said} said, ${item.cleared} cleared` : `${name} ${item.cleared} not read back` });
  }
  return lines;
}

/** An altitude as ATC says it (AIM 4-2-9): feet below 18,000, a flight
 *  level from there up. The clearance card writes its altitudes with it. */
export const altitudeWords = (ft: number) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${grouped(ft)} ft`);

/** The items of the clearance heard as `cleared` that the readback `said`
 *  missed or had differently (none where it matches), and the warning
 *  line for them: "Readback complete.", or "Readback: altitude 4,000 ft
 *  said, 5,000 ft cleared; squawk 4512 not read back." */
export function readbackCheck(cleared: string, said: string): EngineAnswer<"readback_check"> {
  return callEngine("readback_check", { cleared, said });
}
