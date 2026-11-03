/**
 * When the flight passes a point along its route, and whether a TFR or a
 * special-use area is in force then (the roadmap's 4-D airspace check):
 * the briefing lists what is near the route at any time during the
 * flight, and this says whether it is at the time the airplane gets
 * there. The rules are the shared engine's
 * (native/engine/src/gonogo/pass_times.rs, through lib/engine); the time
 * zones are the browser's, which the engine has no database of.
 */
import type { Leg } from "./api/types";
import { clockTime, utcFigures } from "./clock";
import { callEngine } from "./engine/engine";

/** When the flight is `alongNm` along its route: the departure plus the
 *  legs' times to there, the leg it is in taken pro rata. Null where a
 *  leg before it has no time (it cannot be flown) or there are no legs. */
export function passTime(legs: Leg[], departIso: string, alongNm: number): Date | null {
  const depart = new Date(departIso);
  if (!legs.length || Number.isNaN(depart.getTime())) return null;
  const minutes = callEngine<number | null>("gonogo_pass_minutes", {
    legs: legs.map(l => ({ distance_nm: l.distance_nm, ete_min: l.ete_min ?? null })), along_nm: alongNm,
  });
  return minutes == null ? null : new Date(depart.getTime() + minutes * 60_000);
}

export type TfrWhen = "in-force" | "before" | "after";

/** A TFR's window against the pass time, widened by half an hour either way:
 *  one with no start or no end is open that way. */
export function tfrWhen(t: { effective?: string | null; expires?: string | null }, pass: Date): TfrWhen {
  // Microseconds since 1970; a time that does not read is no bound.
  const us = (iso: string | null | undefined) => {
    const ms = iso ? new Date(iso).getTime() : NaN;
    return Number.isNaN(ms) ? null : ms * 1000;
  };
  return callEngine("gonogo_tfr_when", { at_us: pass.getTime() * 1000, effective_us: us(t.effective), expires_us: us(t.expires) });
}

export type SuaWhen = "active" | "not-scheduled" | "by-notam" | "unknown";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

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
  const local = timeZone ? clockIn(pass, timeZone) : null;
  return callEngine("gonogo_sua_when", {
    times_of_use: timesOfUse ?? null, utc: [pass.getUTCDay(), pass.getUTCHours() * 60 + pass.getUTCMinutes()],
    local: local && local.day >= 0 ? [local.day, local.minute] : null,
  });
}

/** A pass time in this device's own time, as the briefing writes a
 *  TFR's, and in UTC: "09:20 (14:20Z)". */
export function passLine(pass: Date): string {
  const z = utcFigures(pass);
  return `${clockTime(pass)} (${z.slice(0, 2)}:${z.slice(2)}Z)`;
}
