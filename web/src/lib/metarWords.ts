import type { Metar } from "./api/types";
import { grouped } from "./units";

/**
 * A field's METAR as a briefer says it over the phone (lib/speech), for
 * the pilot who asked the microphone for the weather there (RadioLayer):
 * the figures the planner read out of it, in the order the report has
 * them, and the flight category last. Said in plain words, not the
 * report's codes, where a recognizer reads "KT" and "SM" as letters.
 */
export function metarWords(name: string, m: Metar): string {
  const parts: string[] = [];
  const wind = m.wind_speed_kt;
  if (wind === null || wind === undefined || wind === 0) parts.push("wind calm");
  else {
    const from = m.wind_dir_true_deg === null || m.wind_dir_true_deg === undefined ? "variable" : String(m.wind_dir_true_deg).padStart(3, "0");
    parts.push(`wind ${from} at ${wind}${m.wind_gust_kt ? ` gusting ${m.wind_gust_kt}` : ""} knots`);
  }
  if (m.visibility_sm !== null && m.visibility_sm !== undefined) {
    const sm = m.visibility_sm;
    parts.push(`visibility ${sm === 0.25 ? "a quarter" : sm === 0.5 ? "half a" : sm === 0.75 ? "three quarters of a" : sm} mile${sm > 1 ? "s" : ""}`);
  }
  // A broken or overcast layer reported with no height ("OVC///") is a
  // ceiling not known, not none (14 CFR 1.1; the planner's ceiling_unknown).
  parts.push(m.ceiling_unknown ? "ceiling height not known"
    : m.ceiling_ft === null || m.ceiling_ft === undefined ? "no ceiling" : `ceiling ${grouped(m.ceiling_ft)} feet`);
  if (m.temp_c !== null && m.temp_c !== undefined) {
    parts.push(`temperature ${m.temp_c}${m.dewpoint_c !== null && m.dewpoint_c !== undefined ? `, dew point ${m.dewpoint_c}` : ""}`);
  }
  if (m.altimeter_in_hg !== null && m.altimeter_in_hg !== undefined) parts.push(`altimeter ${m.altimeter_in_hg.toFixed(2)}`);
  const category = m.flight_category ? ` ${[...m.flight_category].join(" ")}.` : "";
  return `${name}: ${parts.join(", ")}.${category}`;
}
