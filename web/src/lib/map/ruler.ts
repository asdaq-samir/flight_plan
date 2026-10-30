/**
 * The map's ruler (MapRuler), as ForeFlight's: two fingers held still on
 * the chart for a moment put a line between them, with its course each
 * way, its length and the time to fly it, until both lift. The owner's
 * ask, 2026-10-30 ("the ruler that comes up with a double finger hold and
 * then drag it to see the distance etc"). What it says and when it comes
 * are worked out here; MapRuler follows the fingers and draws it.
 */
import { hoursMinutes, duration } from "../clock";
import { bearingDeg, destination, distanceNm, type LatLon } from "../geo";
import { magneticOf, type Declination } from "../magnetic";
import { bearing, nm as miles, one } from "../units";

/** How long two fingers are held before the ruler comes: ForeFlight's is
 *  about this, and a pinch to zoom has moved well before it. */
export const HOLD_MS = 400;
/** How far either finger may move in that time and still be held still,
 *  in points: a finger at rest on glass wanders a few. More is a pinch. */
export const STILL_PX = 10;

type Point = { x: number; y: number };

/** Whether each finger is still within STILL_PX of where it came down. */
export function heldStill(from: readonly Point[], now: readonly Point[], px = STILL_PX): boolean {
  return from.length === now.length && from.every((p, i) => Math.hypot(now[i]!.x - p.x, now[i]!.y - p.y) < px);
}

/**
 * The true course from `a` to `b` measured at the middle of the line, and
 * that middle: a pilot measures a course with the plotter at the meridian
 * nearest its middle, where the meridians' convergence takes least off
 * the course at either end (FAA-H-8083-25C, chapter 16). The course back
 * is its reciprocal there.
 */
export function middleCourse(a: LatLon, b: LatLon): { trueDeg: number; middle: LatLon; nm: number } {
  const nm = distanceNm(a, b);
  const middle = destination(a, bearingDeg(a, b), nm / 2);
  return { trueDeg: bearingDeg(middle, b), middle, nm };
}

/** Minutes to fly `nm` at `tasKt`, no wind: the ruler's time is the
 *  airplane's book cruise, as ForeFlight's, not a wind-corrected one. */
export const eteMinutes = (nm: number, tasKt: number) => (nm / tasKt) * 60;

export interface RulerWords {
  /** The course from the left end to the right, with its arrow: "134°M →". */
  toRight: string;
  /** The course back from the right end to the left: "← 314°M". */
  toLeft: string;
  /** "85.0 nm · 51m (100 kt)", or the distance alone with no speed. */
  figures: string;
  /** All of it in words, for VoiceOver to say as the ruler comes. */
  spoken: string;
}

/**
 * What the ruler says, from `left` to `right` as it reads on the screen:
 * the course each way, magnetic where the variation has loaded (lib/
 * magnetic, WMM-2025, at the line's middle) and true until it has; the
 * distance to a tenth of a mile; and the time at the airplane's cruise,
 * where there is one.
 */
export function rulerWords(left: LatLon, right: LatLon, declination: Declination | null, tasKt: number | null): RulerWords {
  const { trueDeg, middle, nm } = middleCourse(left, right);
  const variation = declination ? declination(middle.lat, middle.lon) : 0;
  const ref = declination ? "M" : "T";
  const there = magneticOf(trueDeg, variation), back = magneticOf(trueDeg + 180, variation);
  const minutes = tasKt ? eteMinutes(nm, tasKt) : null;
  const speed = tasKt ? Math.round(tasKt) : null;
  const time = minutes !== null ? ` · ${duration(minutes)} (${speed} kt)` : "";
  const [course, reciprocal] = [bearing(there), bearing(back)];
  return {
    toRight: `${course}${ref} →`,
    toLeft: `← ${reciprocal}${ref}`,
    figures: `${miles(nm)}${time}`,
    spoken: `Ruler: ${one(nm)} nautical miles, ${spokenCourse(course)} ${declination ? "magnetic" : "true"} one way and ${spokenCourse(reciprocal)} the other${
      minutes !== null ? `, ${spokenTime(minutes)} at ${speed} knots` : ""}.`,
  };
}

/** "134°" as it is said, figure by figure: "1 3 4". */
const spokenCourse = (written: string) => written.replace("°", "").split("").join(" ");

/** "1 hour 5 minutes": the narrow "1h 5m" reads to VoiceOver as metres. */
function spokenTime(minutes: number): string {
  const t = hoursMinutes(minutes);
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return [t.hours ? part(t.hours, "hour") : "", t.minutes || !t.hours ? part(t.minutes, "minute") : ""].filter(Boolean).join(" ");
}

/**
 * The turn that sets the ruler's words along the line from `a` to `b` on
 * the screen and upright, -90 to 90 degrees, as the chart's airspace
 * labels are set (edgeLabels): and whether `b` is then the left end.
 */
export function upright(a: Point, b: Point): { angleDeg: number; flipped: boolean } {
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (angle > 90) return { angleDeg: angle - 180, flipped: true };
  if (angle <= -90) return { angleDeg: angle + 180, flipped: true };
  return { angleDeg: angle, flipped: false };
}
