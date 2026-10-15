import { parseMetar } from "metar-taf-parser";
import type { Metar } from "./api/types";
import { observedAt } from "./reportTime";

export { observedAt };

/**
 * A METAR read from its text, for one heard over FIS-B (lib/fisb), which
 * comes as sent, not parsed as the planner's are: read by
 * metar-taf-parser (the codes as FAA Order JO 7900.5 (Surface Weather
 * Observing) sets them: the wind true, VRB and calm, the visibility in
 * statute miles with its fractions and M, the sky's layers and vertical
 * visibility in feet above the ground, the temperature, dew point and
 * altimeter), and turned into the figures the card shows. The ceiling is
 * 14 CFR 1.1's: the lowest layer broken or overcast, or the vertical
 * visibility into an obscuration; the flight category AIM 7-1-7's, as
 * the planner's (vfr.glmp).
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

/** Knots and inches of mercury, from a station that reports in metres a
 *  second or hectopascals. */
const KT_PER_MPS = 1.943844;
const INHG_PER_HPA = 0.0295300;
const SM_PER_M = 1 / 1609.344;

/** A METAR's or SPECI's text, read; null where it is not one, or where
 *  it cannot be read. */
export function metarOf(text: string, now: Date = new Date()): Metar | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!/^(METAR|SPECI) /.test(raw)) return null;
  let parsed;
  try {
    parsed = parseMetar(raw.replace(/=$/, ""));
  } catch {
    return null;
  }
  const { wind, visibility, altimeter } = parsed;
  const speed = (kt: number | undefined) => (kt == null ? null : wind?.unit === "MPS" ? Math.round(kt * KT_PER_MPS) : kt);
  const layers = parsed.clouds.filter(c => (c.quantity === "BKN" || c.quantity === "OVC") && c.height != null).map(c => c.height!);
  if (parsed.verticalVisibility != null) layers.push(parsed.verticalVisibility);
  const ceiling = layers.length ? Math.min(...layers) : null;
  const sm = visibility == null ? null : visibility.unit === "m" ? Math.round(visibility.value * SM_PER_M * 100) / 100 : visibility.value;
  const time = parsed.day != null && parsed.hour != null && parsed.minute != null
    ? `${String(parsed.day).padStart(2, "0")}${String(parsed.hour).padStart(2, "0")}${String(parsed.minute).padStart(2, "0")}Z` : "";
  return {
    raw,
    observed_at: observedAt(time, now),
    flight_category: flightCategory(ceiling, sm),
    ceiling_ft: ceiling,
    visibility_sm: sm,
    wind_dir_true_deg: wind?.degrees ?? null,
    wind_speed_kt: speed(wind?.speed),
    wind_gust_kt: speed(wind?.gust),
    altimeter_in_hg: altimeter == null ? null : altimeter.unit === "inHg" ? altimeter.value : Math.round(altimeter.value * INHG_PER_HPA * 100) / 100,
    temp_c: parsed.temperature ?? null,
    dewpoint_c: parsed.dewPoint ?? null,
  };
}
