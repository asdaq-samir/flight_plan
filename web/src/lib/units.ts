import { normalizeDeg } from "./geo";
/** How an altitude, a ceiling or a visibility is written everywhere on
 *  the page: one formatter each, so a nav log, a briefing and a map card
 *  never write the same figure two ways. A missing figure is an em dash
 *  -- nothing reported, which is not the same as zero. */

/**
 * A whole number with a comma between each three figures, "12,500", as
 * the FAA writes altitudes, distances and weights -- written here rather
 * than by the browser's Intl.NumberFormat, whose number data, read the
 * first time one is made, was a task of its own of 0.1 s on a phone's CPU
 * (4x, 2026-10-10): one long task more as the planner opened, made then
 * so the first figure after a tap did not pay for it, and paid again by
 * every toLocaleString() that made its own.
 */
export function grouped(n: number): string {
  // Rounded on the magnitude, halves away from zero, as Intl.NumberFormat did.
  const magnitude = Math.round(Math.abs(n));
  const digits = String(magnitude).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < 0 && magnitude > 0 ? `-${digits}` : digits;
}

/** A whole-number altitude with a thousands separator: "12,500". */
export function altFt(ft: number | null | undefined): string {
  return ft === null || ft === undefined ? "—" : grouped(ft);
}

/** The same with its unit: "12,500 ft". */
export function feet(ft: number | null | undefined): string {
  return ft === null || ft === undefined ? "—" : `${altFt(ft)} ft`;
}

/** A cruising altitude as the pilot asked it written: hundreds of feet in
 *  three figures, "FL-045" for 4,500 ft (the owner, 2026-10-27: "make it
 *  in the format FL-***"), and "FL----" with none yet. */
export function flightLevel(ft: number | null | undefined): string {
  return ft === null || ft === undefined ? "FL----" : `FL-${String(Math.round(ft / 100)).padStart(3, "0")}`;
}

/**
 * A wind correction as it is applied to a course: "+3°" to the right,
 * "−3°" to the left (a minus sign, not a hyphen), and "0°" under half a
 * degree, where "−0°" and "-0.0°" read as a correction to make. Whole
 * degrees, as a heading is flown; the nav log's columns are to a tenth
 * (`digits`).
 */
export function windCorrection(deg: number, digits = 0): string {
  const shown = Number(Math.abs(deg).toFixed(digits));
  return `${shown === 0 ? "" : deg > 0 ? "+" : "−"}${shown.toFixed(digits)}°`;
}

/**
 * A magnetic variation as the sectional's isogonic lines write it, east
 * or west: "5° E", "3° W". The nav log wrote "+5.2°", which reads as a
 * figure to add where an east variation is taken off the true heading
 * ("east is least, west is best", FAA-H-8083-25C, chapter 16).
 */
export function magneticVariation(deg: number, digits = 0): string {
  const shown = Number(Math.abs(deg).toFixed(digits));
  return shown === 0 ? `${shown.toFixed(digits)}°` : `${shown.toFixed(digits)}° ${deg > 0 ? "E" : "W"}`;
}

/** A figure to a tenth, as the planner sends a route's distances and
 *  fuel and the nav log writes them: "102.4", "12.0". An em dash with
 *  none: an unflyable leg has no time and no fuel. */
export function one(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toFixed(1);
}

/** A distance with its unit, to a tenth: "102.4 nm". A route's total read
 *  "102 nm" on the strip, "102.0 nm" on Flights and was rounded down to
 *  "102 nm" on the kneeboard. */
export function nm(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${one(n)} nm`;
}

/** Fuel with its unit, to a tenth: "12.0 gal". */
export function gal(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${one(n)} gal`;
}

/** Weight with its unit, grouped: "2,450 lb". */
export function pounds(lb: number): string {
  return `${grouped(lb)} lb`;
}

/** The altitudes flown, lowest to highest: "4,500 ft", or "3,500–5,500
 *  ft" where they differ. */
export function feetRange(alts: number[]): string {
  const low = Math.min(...alts), high = Math.max(...alts);
  return low === high ? `${altFt(low)} ft` : `${altFt(low)}–${altFt(high)} ft`;
}

/** Statute miles as reported: "2.5 sm". */
export function miles(sm: number | null | undefined): string {
  return sm === null || sm === undefined ? "—" : `${sm} sm`;
}

/**
 * A course, a heading, a track or a wind's direction as a pilot writes it:
 * three figures, whole degrees, north as 360 -- as ATC states a heading
 * ("Use heading 360 degrees to indicate a north heading", FAA Order JO
 * 7110.65, 2-4-17) and as a METAR codes a wind from the north (36010KT,
 * 000 only for a calm one) -- at the owner's pick ("Yes to 360"), where
 * the nav log wrote 000 and its own workings 360.
 */
export function bearing(deg: number): string {
  const whole = normalizeDeg(Math.round(deg));
  return `${String(whole === 0 ? 360 : whole).padStart(3, "0")}°`;
}
