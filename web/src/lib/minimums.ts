import type { Briefing } from "./api/types";
import { callEngine } from "./engine/engine";

/**
 * A pilot's personal minimums -- the weather they have decided they will
 * not take off or land in, stricter than the rules -- and where the
 * briefing's weather is under them. Each off (null) until set. The rules
 * are the shared engine's (native/crates/brief/src/gonogo/minimums.rs, through
 * lib/engine), the planner's and the phones' own.
 */
export interface Minimums {
  /** The lowest ceiling, feet above the field (a METAR's or TAF's). */
  ceilingFt: number | null;
  /** The least visibility, statute miles. */
  visibilitySm: number | null;
  /** The most crosswind on the best runway, gusts included, knots. */
  crosswindKt: number | null;
  /** The most surface wind, gusts included, knots. */
  windKt: number | null;
}

export const NO_MINIMUMS: Minimums = { ceilingFt: null, visibilitySm: null, crosswindKt: null, windKt: null };

/** The choices each minimum is picked from (menus, not sliders). */
export const MINIMUM_CHOICES: Record<keyof Minimums, number[]> = {
  ceilingFt: [1000, 1500, 2000, 2500, 3000, 4000, 5000],
  visibilitySm: [3, 4, 5, 6, 8, 10],
  crosswindKt: [5, 8, 10, 12, 15, 17, 20],
  windKt: [10, 15, 20, 25, 30, 35],
};

/**
 * Where the briefing's weather is under the minimums, each a sentence:
 * every airport landed at's current report (ceiling, visibility, wind,
 * the crosswind on its best runway), the destination's forecast, and
 * the forecast along the route. Empty when it is not, or none is set.
 */
export function underMinimums(m: Minimums, briefing: Briefing, landings: string[], dest: string): string[] {
  return callEngine("gonogo_under_minimums", {
    minimums: { ceiling_ft: m.ceilingFt, visibility_sm: m.visibilitySm, crosswind_kt: m.crosswindKt, wind_kt: m.windKt },
    landings, dest, metars: briefing.metars,
    // Each landing's airport where the briefing has one, so no entry is
    // undefined (the contract's airports map holds airports only).
    airports: Object.fromEntries(landings.flatMap(i => {
      const airport = briefing.airports[i];
      return airport ? [[i, airport] as const] : [];
    })),
    forecast: briefing.forecast,
  });
}
