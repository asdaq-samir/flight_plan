/**
 * When the flight passes a point along its route, and whether a TFR or a
 * special-use area is in force then (the roadmap's 4-D airspace check):
 * the briefing lists what is near the route at any time during the
 * flight, and this says whether it is at the time the airplane gets
 * there.
 */
import type { Leg } from "./api/types";

/** The minutes either side of a pass time a TFR's window is widened by:
 *  an ETA is an estimate, and a few minutes early is still inside. */
export const PASS_MARGIN_MIN = 30;

/** When the flight is `alongNm` along its route: the departure plus the
 *  legs' times to there, the leg it is in taken pro rata. Null where a
 *  leg before it has no time (it cannot be flown) or there are no legs. */
export function passTime(legs: Leg[], departIso: string, alongNm: number): Date | null {
  const depart = new Date(departIso);
  if (!legs.length || Number.isNaN(depart.getTime())) return null;
  let distance = 0;
  let minutes = 0;
  for (const leg of legs) {
    if (leg.ete_min == null) return null;
    if (alongNm <= distance + leg.distance_nm || leg === legs[legs.length - 1]) {
      const share = leg.distance_nm > 0 ? Math.min(1, Math.max(0, (alongNm - distance) / leg.distance_nm)) : 0;
      return new Date(depart.getTime() + (minutes + share * leg.ete_min) * 60_000);
    }
    distance += leg.distance_nm;
    minutes += leg.ete_min;
  }
  return null;
}

export type TfrWhen = "in-force" | "before" | "after";

/** A TFR's window against the pass time, widened by PASS_MARGIN_MIN:
 *  one with no start or no end is open that way. */
export function tfrWhen(t: { effective?: string | null; expires?: string | null }, pass: Date): TfrWhen {
  const margin = PASS_MARGIN_MIN * 60_000;
  if (t.effective && pass.getTime() < new Date(t.effective).getTime() - margin) return "before";
  if (t.expires && pass.getTime() > new Date(t.expires).getTime() + margin) return "after";
  return "in-force";
}

export type SuaWhen = "active" | "not-scheduled" | "by-notam" | "unknown";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * Whether a special-use area's published times of use (the FAA's own
 * words: "0700 - 2200 LOCAL, MON - FRI; OTHER TIMES BY NOTAM",
 * "CONTINUOUS", "INTERMITTENT BY NOTAM") have it in use when the flight
 * passes. LOCAL is read in this device's time zone, the pilot's own, and
 * a time without a zone as local too, as the chart's tables write them.
 * "Not scheduled" still means a NOTAM can activate it where its words
 * say so; anything not read is "unknown", for the pilot to read.
 */
export function suaWhen(timesOfUse: string | null | undefined, pass: Date): SuaWhen {
  const text = (timesOfUse ?? "").toUpperCase();
  if (!text) return "unknown";
  if (/CONTINUOUS|\bH24\b/.test(text)) return "active";
  const range = /(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})\s*(Z|UTC|LOCAL|LT)?/.exec(text);
  if (!range) return /NOTAM/.test(text) ? "by-notam" : "unknown";
  const utc = range[5] === "Z" || range[5] === "UTC";
  const hour = utc ? pass.getUTCHours() : pass.getHours();
  const minute = utc ? pass.getUTCMinutes() : pass.getMinutes();
  const day = utc ? pass.getUTCDay() : pass.getDay();
  const now = hour * 60 + minute;
  const from = Number(range[1]) * 60 + Number(range[2]);
  const to = Number(range[3]) * 60 + Number(range[4]);
  const inHours = from <= to ? now >= from && now < to : now >= from || now < to;
  const days = /\b(SUN|MON|TUE|WED|THU|FRI|SAT)\s*-\s*(SUN|MON|TUE|WED|THU|FRI|SAT)\b/.exec(text);
  let onDay = true;
  if (days) {
    const first = DAYS.indexOf(days[1]!), last = DAYS.indexOf(days[2]!);
    onDay = first <= last ? day >= first && day <= last : day >= first || day <= last;
  }
  if (inHours && onDay) return "active";
  return /NOTAM/.test(text) ? "by-notam" : "not-scheduled";
}

/** A pass time in this device's own time, as the briefing writes a
 *  TFR's, and in UTC: "09:20 (14:20Z)". */
export function passLine(pass: Date): string {
  const z = `${String(pass.getUTCHours()).padStart(2, "0")}:${String(pass.getUTCMinutes()).padStart(2, "0")}Z`;
  const local = `${String(pass.getHours()).padStart(2, "0")}:${String(pass.getMinutes()).padStart(2, "0")}`;
  return `${local} (${z})`;
}
