import type { Metar } from "./api/types";

/**
 * A METAR read from its text, for one heard over FIS-B (lib/fisb), which
 * comes as sent, not parsed as the planner's are: the figures the card
 * shows, read as FAA Order JO 7900.5 (Surface Weather Observing) codes
 * them -- the wind true (dddffGggKT, VRB, calm 00000KT), the visibility
 * in statute miles (10SM, 1/2SM, 1 1/2SM, M1/4SM), the sky (FEW, SCT,
 * BKN, OVC and VV, hundreds of feet above the ground), the temperature
 * and dew point (M for minus) and the altimeter (A3002) -- the remarks
 * after RMK left alone. The ceiling is 14 CFR 1.1's: the lowest layer
 * broken or overcast, or the vertical visibility into an obscuration;
 * the flight category AIM 7-1-7's, as the planner's (vfr.glmp).
 */

/** AIM 7-1-7's categories, as vfr.glmp.flight_category has them: LIFR
 *  under a 500 ft ceiling or 1 sm; IFR under 1,000 ft or 3 sm; MVFR at
 *  3,000 ft or 5 sm and under; VFR above both. */
export function flightCategory(ceilingFt: number | null, visibilitySm: number | null): string | null {
  if (visibilitySm == null) return null;
  const ceiling = ceilingFt ?? Infinity;
  if (ceiling < 500 || visibilitySm < 1) return "LIFR";
  if (ceiling < 1000 || visibilitySm < 3) return "IFR";
  if (ceiling <= 3000 || visibilitySm <= 5) return "MVFR";
  return "VFR";
}

/** A fraction or a whole number of miles: "1/2", "3", "M1/4". Less than
 *  a quarter (M1/4) is the quarter, as the planner's reports from
 *  aviationweather.gov give it; the report under the figures says "M". */
function miles(word: string): number | null {
  const bare = word.replace(/^[MP]/, "");
  const [top, bottom] = bare.split("/");
  const value = bottom ? Number(top) / Number(bottom) : Number(bare);
  return Number.isFinite(value) ? value : null;
}

/** When a report made on day DD at HH:MM UTC was made: this month's, or
 *  last month's where that day is still to come. */
export function observedAt(time: string, now: Date): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(time);
  if (!m) return null;
  const [day, hour, minute] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let when = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour, minute);
  // An hour's grace for a clock a little behind the station's.
  if (when > now.getTime() + 3_600_000) when = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, hour, minute);
  return new Date(when).toISOString().replace(".000Z", "Z");
}

/** A METAR's or SPECI's text, read; null where it is not one. */
export function metarOf(text: string, now: Date = new Date()): Metar | null {
  const words = text.replace(/=\s*$/, "").trim().split(/\s+/);
  if (words[0] !== "METAR" && words[0] !== "SPECI") return null;
  const body = words.slice(0, words.includes("RMK") ? words.indexOf("RMK") : words.length);
  const metar: Metar = {
    raw: text.replace(/\s+/g, " ").trim(),
    observed_at: observedAt(body[2] ?? "", now),
    flight_category: null, ceiling_ft: null, visibility_sm: null,
    wind_dir_true_deg: null, wind_speed_kt: null, wind_gust_kt: null,
    altimeter_in_hg: null, temp_c: null, dewpoint_c: null,
  };
  for (let i = 3; i < body.length; i++) {
    const word = body[i]!;
    const wind = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(word);
    if (wind) {
      metar.wind_dir_true_deg = wind[1] === "VRB" ? null : Number(wind[1]);
      metar.wind_speed_kt = Number(wind[2]);
      metar.wind_gust_kt = wind[3] ? Number(wind[3]) : null;
      continue;
    }
    if (/^[MP]?\d+(\/\d+)?SM$/.test(word)) {
      let sm = miles(word.slice(0, -2));
      // "1 1/2SM": the whole mile before it.
      const before = body[i - 1];
      if (sm != null && word.includes("/") && before && /^\d$/.test(before)) sm += Number(before);
      metar.visibility_sm = sm;
      continue;
    }
    const sky = /^(FEW|SCT|BKN|OVC|VV)(\d{3})/.exec(word);
    if (sky) {
      const base = Number(sky[2]) * 100;
      if ((sky[1] === "BKN" || sky[1] === "OVC" || sky[1] === "VV") && metar.ceiling_ft == null) metar.ceiling_ft = base;
      continue;
    }
    const temps = /^(M?\d{2})\/(M?\d{2})?$/.exec(word);
    if (temps) {
      const c = (s: string) => (s.startsWith("M") ? -Number(s.slice(1)) : Number(s));
      metar.temp_c = c(temps[1]!);
      metar.dewpoint_c = temps[2] ? c(temps[2]) : null;
      continue;
    }
    const altimeter = /^A(\d{4})$/.exec(word);
    if (altimeter) metar.altimeter_in_hg = Number(altimeter[1]) / 100;
  }
  metar.flight_category = flightCategory(metar.ceiling_ft ?? null, metar.visibility_sm ?? null);
  return metar;
}
