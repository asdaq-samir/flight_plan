/**
 * When the flight passes a point along its route, and whether a TFR or a
 * special-use area is in force then (the roadmap's 4-D airspace check):
 * the briefing lists what is near the route at any time during the
 * flight, and this says whether it is at the time the airplane gets
 * there.
 */
import type { Leg } from "./api/types";
import { clockTime, utcFigures } from "./clock";

/** The minutes either side of a pass time a TFR's window is widened by:
 *  an ETA is an estimate, and a few minutes early is still inside. */
const PASS_MARGIN_MIN = 30;

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
const DAY = "SUN|MON|TUE|WED|THU|FRI|SAT";

/** A clock's formatter for each zone, made once: Intl's are slow to make. */
const clocks = new Map<string, Intl.DateTimeFormat>();

/** The day of the week (0 Sunday) and the minute of the day of `pass` in
 *  `zone` -- "UTC", or an IANA zone the browser's own Intl reads, daylight
 *  saving time and all -- or null for a zone it does not know. */
function clockIn(pass: Date, zone: string): { day: number; minute: number } | null {
  if (zone === "UTC") return { day: pass.getUTCDay(), minute: pass.getUTCHours() * 60 + pass.getUTCMinutes() };
  let clock = clocks.get(zone);
  if (!clock) {
    try {
      clock = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch {
      return null;
    }
    clocks.set(zone, clock);
  }
  const parts = clock.formatToParts(pass);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return { day: DAYS.indexOf(part("weekday").toUpperCase()), minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

/** The days a clause of times of use names -- "MON - FRI", "SAT - SUN",
 *  "FRI" -- as days of the week; every day where it names none, or
 *  "DAILY", which "means 7 days per week" (FAA Order JO 7400.2, 21-2-4). */
function daysOf(clause: string): Set<number> {
  const days = new Set<number>();
  for (const m of clause.matchAll(new RegExp(`\\b(${DAY})\\b(?:\\s*-\\s*(${DAY})\\b)?`, "g"))) {
    const first = DAYS.indexOf(m[1]!), last = m[2] ? DAYS.indexOf(m[2]) : first;
    for (let d = first; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === last) break;
    }
  }
  return days.size === 0 ? new Set([0, 1, 2, 3, 4, 5, 6]) : days;
}

/**
 * Whether a special-use area's published times of use have it in use when
 * the flight passes, as the FAA writes them (the TIMESOFUSE of its
 * special-use airspace data, after FAA Order JO 7400.2, 21-2-4): "specific
 * hours/days ... local time using the 24-hour clock, and days of the week"
 * ("0700 - 2200, MON - FRI; OTHER TIMES BY NOTAM"), "CONTINUOUS", "BY
 * NOTAM". Every time range is read, clause by clause (";", and the "%" the
 * data breaks a long one with) -- "0800 - 1600, MON - FRI; 1000 - 1400,
 * SAT" is in use on a Saturday too -- each with its clause's days, a range
 * past midnight with the day it began; but not the ranges of an "OTHER
 * TIMES BY NOTAM" clause, which bound the NOTAM's times, not the
 * schedule. Seasons ("SEP 1 - APR 30, ...") are not read: each season's
 * hours count all year, which can say in use, never the other way.
 *
 * Local hours are read in the area's own zone (`timeZone`, the planner's
 * from the FAA's GMTOFFSET and DST_CODE: vfr.sua.time_zone) -- not this
 * device's, which put a pilot elsewhere, or Arizona's areas in summer, an
 * hour or three off -- and "Z" or "UTC" ones in UTC. With no zone, local
 * hours are not guessed at: "unknown", for the pilot to read. "Not
 * scheduled" still means a NOTAM can activate it where its words say so.
 */
export function suaWhen(timesOfUse: string | null | undefined, pass: Date, timeZone?: string | null): SuaWhen {
  const text = (timesOfUse ?? "").toUpperCase();
  if (!text) return "unknown";
  if (/CONTINUOUS|\bH24\b/.test(text)) return "active";
  let read = false, unread = false;
  for (const clause of text.split(/[;%]/)) {
    if (/^\s*(OTHER TIMES|O\/T)\b/.test(clause)) continue;
    const ranges = [...clause.matchAll(/(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})\s*(Z|UTC)?/g)];
    if (ranges.length === 0) continue;
    const days = daysOf(clause);
    for (const range of ranges) {
      const zone = range[5] ? "UTC" : timeZone;
      const clock = zone ? clockIn(pass, zone) : null;
      if (!clock) {
        unread = true;
        continue;
      }
      read = true;
      const from = Number(range[1]) * 60 + Number(range[2]);
      const to = Number(range[3]) * 60 + Number(range[4]);
      const overnight = from > to;
      const inHours = overnight ? clock.minute >= from || clock.minute < to : clock.minute >= from && clock.minute < to;
      // Past midnight, a range that began the day before is that day's.
      const day = overnight && clock.minute < to ? (clock.day + 6) % 7 : clock.day;
      if (inHours && days.has(day)) return "active";
    }
  }
  if (unread) return "unknown";
  if (!read) return /NOTAM/.test(text) ? "by-notam" : "unknown";
  return /NOTAM/.test(text) ? "by-notam" : "not-scheduled";
}

/** A pass time in this device's own time, as the briefing writes a
 *  TFR's, and in UTC: "09:20 (14:20Z)". */
export function passLine(pass: Date): string {
  const z = utcFigures(pass);
  return `${clockTime(pass)} (${z.slice(0, 2)}:${z.slice(2)}Z)`;
}
