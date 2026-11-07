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
import { useEffect, useState } from "react";
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
 *  oral's facts. This is how they are counted; duration and hm write
 *  them. */
export function hoursMinutes(minutes: number): { hours: number; minutes: number } {
  const whole = Math.round(minutes);
  return { hours: Math.floor(whole / 60), minutes: whole % 60 };
}

/** The browser's own duration formatter, made once and only when first
 *  asked for (an Intl formatter is costly to make, as above), or null
 *  where the browser has none: Intl.DurationFormat is in Safari since 16.4
 *  (the iOS app asks for iOS 18), Chrome since 129, Firefox since 136.
 *  English, as every other word the app writes is. */
type DurationFormat = { format(d: { hours: number; minutes: number }): string };
let narrow: DurationFormat | null | undefined;
function narrowFormat(): DurationFormat | null {
  if (narrow === undefined) {
    const Format = (Intl as unknown as { DurationFormat?: new (locale: string, options: object) => DurationFormat }).DurationFormat;
    narrow = Format ? new Format("en-US", { style: "narrow" }) : null;
  }
  return narrow;
}

/** The same words written by hand, where the browser has no formatter. */
export function durationByHand(t: { hours: number; minutes: number }): string {
  return t.hours && t.minutes ? `${t.hours}h ${t.minutes}m` : t.hours ? `${t.hours}h` : `${t.minutes}m`;
}

/** A duration, "1h 5m", "45m", "3h": every time aloft, time left and
 *  age the app writes, in Intl.DurationFormat's narrow style (the owner's
 *  pick, 2026-10-28: the nav log's columns narrowest). It was four ways
 *  ("1h 05m", "1 h 05 m", "1 h 05 min", "1 h 5 min") and a few more of
 *  each screen's own. The FAA's forms are not durations and stay as they
 *  are: a clock time (1430Z), a nav log's "0:18" (hm). */
export function duration(minutes: number): string {
  const t = hoursMinutes(minutes);
  // No time at all is written "0m": the formatter leaves out every unit
  // that is nought, and wrote nothing.
  if (!t.hours && !t.minutes) return "0m";
  return narrowFormat()?.format(t) ?? durationByHand(t);
}

/** How long ago something was, from the milliseconds since: "just now"
 *  under a minute, "23m ago", "2h 5m ago". */
export function ago(sinceMs: number): string {
  const minutes = Math.floor(Math.max(0, sinceMs) / 60_000);
  return minutes < 1 ? "just now" : `${duration(minutes)} ago`;
}

/** A time en route as a paper nav log writes it, "0:18", "1:35": the
 *  kneeboard, a saved flight's page and its debrief, and the instructor's
 *  review, which each had a copy of it. */
export function hm(minutes: number): string {
  const t = hoursMinutes(minutes);
  return `${t.hours}:${String(t.minutes).padStart(2, "0")}`;
}

/** The time now, a minute at a time, for what says an age or goes out of
 *  date while it stays open: a report's "40m ago" (Observed), a nav
 *  log's winds (NavLogView). */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
