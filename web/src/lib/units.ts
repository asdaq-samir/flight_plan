/** How an altitude, a ceiling or a visibility is written everywhere on
 *  the page: one formatter each, so a nav log, a briefing and a map card
 *  never write the same figure two ways. A missing figure is an em dash
 *  -- nothing reported, which is not the same as zero. */

// One formatter for the page, made once: toLocaleString() makes one for
// every figure it writes, and a nav log writes hundreds -- 0.1 s of a
// phone's as the Brief opened (measured 2026-10-07).
const WHOLE = new Intl.NumberFormat();

/** A whole-number altitude with a thousands separator: "12,500". */
export function altFt(ft: number | null | undefined): string {
  return ft === null || ft === undefined ? "—" : WHOLE.format(Math.round(ft));
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
