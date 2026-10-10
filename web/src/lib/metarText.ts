import type { AirportPlace } from "./api/types";

/** The wind as reported, true: "140° at 10 kt", "calm", "variable at 4
 *  kt, gusts 18". */
export function windLine(metar: NonNullable<AirportPlace["metar"]>): string {
  if (!metar.wind_speed_kt) return "Calm";
  const from = metar.wind_dir_true_deg == null ? "Variable" : `${String(Math.round(metar.wind_dir_true_deg)).padStart(3, "0")}°`;
  return `${from} at ${Math.round(metar.wind_speed_kt)} kt${metar.wind_gust_kt ? `, gusts ${Math.round(metar.wind_gust_kt)}` : ""}`;
}

/** When the report was made: "Observed 1255Z, 14 minutes ago". */
export function observedLine(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  const zulu = `${String(when.getUTCHours()).padStart(2, "0")}${String(when.getUTCMinutes()).padStart(2, "0")}Z`;
  const minutes = Math.max(0, Math.round((Date.now() - when.getTime()) / 60_000));
  const ago = minutes < 1 ? "just now" : minutes < 90 ? `${minutes} minute${minutes === 1 ? "" : "s"} ago` : `${Math.round(minutes / 60)} hours ago`;
  return `Observed ${zulu}, ${ago}. Wind true, as reported.`;
}
