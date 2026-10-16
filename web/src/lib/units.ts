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
 *  three figures, "FL045" for 4,500 ft, and "FL---" with none yet. */
export function flightLevel(ft: number | null | undefined): string {
  return ft === null || ft === undefined ? "FL---" : `FL${String(Math.round(ft / 100)).padStart(3, "0")}`;
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
  const whole = ((Math.round(deg) % 360) + 360) % 360;
  return `${String(whole === 0 ? 360 : whole).padStart(3, "0")}°`;
}
