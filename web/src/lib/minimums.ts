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

/** The crosswind on the field's best open runway for the wind -- the
 *  least, the gusts' where they are more -- and that runway's favoured
 *  end. A closed runway is not landed on, so its wind is not counted
 *  (the planner puts one on every runway): a closed runway into the wind
 *  passed a field whose open one had it all across. A wind reported with
 *  no direction -- variable, VRB, which gives no runway a component --
 *  may blow across any of them, so all of it, gusts included, is taken as
 *  crosswind, with no end (`reported`, the field's METAR wind). */
export function bestCrosswind(
  runways: Briefing["airports"][string]["runways"],
  reported?: { speedKt?: number | null; gustKt?: number | null } | null,
): { end: string | null; kt: number } | null {
  return callEngine("gonogo_best_crosswind", {
    runways, reported: reported ? { speed_kt: reported.speedKt ?? null, gust_kt: reported.gustKt ?? null } : null,
  });
}

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
    airports: Object.fromEntries(landings.filter(i => briefing.airports[i]).map(i => [i, briefing.airports[i]])),
    forecast: briefing.forecast,
  });
}
