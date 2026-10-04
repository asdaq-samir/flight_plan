import type { Briefing } from "./api/types";
import { altFt } from "./units";

/**
 * A pilot's personal minimums -- the weather they have decided they will
 * not take off or land in, stricter than the rules -- and where the
 * briefing's weather is under them. Each off (null) until set.
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

/** The crosswind on the field's best runway for the wind -- the least,
 *  the gusts' where they are more -- and that runway's favoured end. */
export function bestCrosswind(runways: Briefing["airports"][string]["runways"]): { end: string; kt: number } | null {
  const winds = runways.flatMap(r => (r.wind ? [r.wind] : []));
  if (winds.length === 0) return null;
  const crosswind = (w: (typeof winds)[number]) => Math.max(Math.abs(w.crosswind_kt), Math.abs(w.gust_crosswind_kt ?? 0));
  const best = winds.reduce((a, b) => (crosswind(b) < crosswind(a) ? b : a));
  return { end: best.end, kt: crosswind(best) };
}

/**
 * Where the briefing's weather is under the minimums, each a sentence:
 * every airport landed at's current report (ceiling, visibility, wind,
 * the crosswind on its best runway), the destination's forecast, and
 * the forecast along the route. Empty when it is not, or none is set.
 */
export function underMinimums(m: Minimums, briefing: Briefing, landings: string[], dest: string): string[] {
  const reasons: string[] = [];
  const ceiling = (where: string, ft: number | null | undefined) => {
    if (m.ceilingFt != null && ft != null && ft < m.ceilingFt) reasons.push(`${where} ceiling ${altFt(ft)} ft, under your ${altFt(m.ceilingFt)} ft`);
  };
  const visibility = (where: string, sm: number | null | undefined) => {
    if (m.visibilitySm != null && sm != null && sm < m.visibilitySm) reasons.push(`${where} visibility ${sm} sm, under your ${m.visibilitySm} sm`);
  };
  for (const ident of landings) {
    const metar = briefing.metars[ident];
    if (metar) {
      ceiling(ident, metar.ceiling_ft);
      visibility(ident, metar.visibility_sm);
      const wind = Math.max(metar.wind_speed_kt ?? 0, metar.wind_gust_kt ?? 0);
      if (m.windKt != null && wind > m.windKt) {
        const reported = metar.wind_gust_kt ? `${metar.wind_speed_kt}G${metar.wind_gust_kt}` : `${metar.wind_speed_kt}`;
        reasons.push(`${ident} wind ${reported} kt, over your ${m.windKt} kt`);
      }
    }
    const crosswind = bestCrosswind(briefing.airports[ident]?.runways ?? []);
    if (m.crosswindKt != null && crosswind && crosswind.kt > m.crosswindKt) {
      reasons.push(`${ident} crosswind ${crosswind.kt} kt on its best runway (${crosswind.end}), over your ${m.crosswindKt} kt`);
    }
  }
  const destForecast = briefing.forecast.stations.find(s => s.icaoId === dest);
  if (destForecast) {
    ceiling(`${dest} forecast`, destForecast.ceiling_ft);
    visibility(`${dest} forecast`, destForecast.visibility_sm);
  }
  ceiling("Along the route, forecast", briefing.forecast.min_ceiling_ft);
  visibility("Along the route, forecast", briefing.forecast.min_visibility_sm);
  return reasons;
}
