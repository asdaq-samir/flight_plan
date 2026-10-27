import type { OnRoute } from "./api/types";
import { clockTime } from "./clock";

/**
 * Where and when the flight meets a hazard, in the Brief's words and as
 * lines on the map: the planner works it out (app.exposure, the
 * briefing's `on_route`) -- the legs, the times the airplane is there
 * and whether that is while the hazard is valid -- and this only says it.
 */

/** Legs 0-based as the planner gives them, said 1-based as the nav log
 *  numbers its rows: "Leg 2", "Legs 2–3", "Legs 1, 3–4". */
export function legWords(legs: number[]): string {
  const sorted = [...new Set(legs)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const runs: [number, number][] = [];
  for (const leg of sorted) {
    const last = runs.at(-1);
    if (last && leg === last[1] + 1) last[1] = leg;
    else runs.push([leg, leg]);
  }
  const said = runs.map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}–${b + 1}`)).join(", ");
  return `${sorted.length === 1 ? "Leg" : "Legs"} ${said}`;
}

const at = (iso: string | null | undefined) => (iso ? clockTime(new Date(iso)) : null);

/** The hazard's own time against the airplane's, in words: before it
 *  starts, after it ends, else until when it is valid; a report's when it
 *  was made. G-AIRMET snapshots stand for a window the planner sets, not
 *  the product's, so theirs say only before or after. */
function validWords(on: OnRoute): string | null {
  if (on.when === "before") return `before it starts at ${at(on.valid_from)}`;
  if (on.when === "after") return `after it ends at ${at(on.valid_to)}`;
  if (on.when === "during") {
    if (on.source === "G-AIRMET") return null;
    if (on.valid_to) return `valid till ${at(on.valid_to)}`;
    return on.valid_from ? `in effect from ${at(on.valid_from)}` : "in effect";
  }
  if (on.source === "PIREP" && on.issued) return `reported ${at(on.issued)}`;
  if (on.source === "METAR" && on.issued) return `observed ${at(on.issued)}`;
  if (on.source === "TAF") return "forecast for then";
  return null;
}

/** "Legs 2–3 · 14:20–14:45, valid till 15:00": the legs, when the
 *  airplane is there (one time where it passes a point), and the
 *  hazard's own time against it. */
export function onRouteLine(on: OnRoute): string {
  const enter = at(on.enter), leave = at(on.leave);
  const when = enter && leave && enter !== leave ? `${enter}–${leave}` : enter;
  const valid = validWords(on);
  return [legWords(on.legs), [when, valid].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}

/** Whether the airplane is there while the hazard holds: the planner's
 *  "during", or a report or forecast for the place, which has no window. */
export const metWhileValid = (on: OnRoute) => on.when !== "before" && on.when !== "after";

export type LatLon = { lat: number; lon: number };

/** The stretches of the route the legs make, each a line of fixes: legs
 *  next to each other are one line. Legs past the fixes are left out. */
export function legLines(legs: number[], fixes: LatLon[]): LatLon[][] {
  const sorted = [...new Set(legs)].filter(i => i >= 0 && i + 1 < fixes.length).sort((a, b) => a - b);
  const lines: LatLon[][] = [];
  let last = -2;
  for (const leg of sorted) {
    if (leg === last + 1 && lines.length) lines.at(-1)!.push(fixes[leg + 1]!);
    else lines.push([fixes[leg]!, fixes[leg + 1]!]);
    last = leg;
  }
  return lines;
}
