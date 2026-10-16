/**
 * The times and days the app writes, in one place: this device's clock
 * ("09:05"), UTC as reports and flight plans give it ("1255Z", "1255"),
 * and this device's calendar day ("2026-10-11", what a date field and a
 * "good through" date compare against).
 *
 * Written from the hours and minutes, not by Intl.DateTimeFormat: one
 * made at each time written (toLocaleTimeString) was 75 ms of a phone's
 * (CPU 4x) as a route came in (2026-10-08), and the one made in the
 * page's idle time instead was a task of 164 ms of its own as the
 * planner opened (2026-10-10), the browser reading its date data. It
 * also wrote midnight "24:05" where hour12 was off in some browsers.
 */
const two = (n: number) => String(n).padStart(2, "0");

/** This device's clock: "09:05". */
export function clockTime(at: Date): string {
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}

/** UTC hours and minutes in four figures, as a flight plan's item 13
 *  takes them: "1505". */
export function utcFigures(at: Date): string {
  return `${two(at.getUTCHours())}${two(at.getUTCMinutes())}`;
}

/** UTC as reports give it: "1255Z". */
export function zuluTime(at: Date): string {
  return `${utcFigures(at)}Z`;
}

/** This device's calendar day, yyyy-MM-dd: the day a pilot means by
 *  "today", where an ISO string's slice is UTC's and turns over in the
 *  evening across the U.S. */
export function localDay(at: Date = new Date()): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** A duration's hours and minutes, the minutes rounded first: rounding
 *  the remainder on its own turned 119.6 minutes into "1h 60m" on the
 *  strip's estimate, "1:60" on the kneeboard and "1 h 60 min" in the mock
 *  oral's facts. Each writes them its own way; this is how they are
 *  counted. */
export function hoursMinutes(minutes: number): { hours: number; minutes: number } {
  const whole = Math.round(minutes);
  return { hours: Math.floor(whole / 60), minutes: whole % 60 };
}
