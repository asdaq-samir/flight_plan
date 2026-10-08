/** How an altitude, a ceiling or a visibility is written everywhere on
 *  the page: one formatter each, so a nav log, a briefing and a map card
 *  never write the same figure two ways. A missing figure is an em dash
 *  -- nothing reported, which is not the same as zero. */

// One formatter for the page, made once: toLocaleString() makes one for
// every figure it writes, and a nav log writes hundreds -- 0.1 s of a
// phone's as the Brief opened (measured 2026-10-07). Made the first time
// a figure is written, not as the page loads: the browser's number data
// read then was a quarter of a second of the app's opening on a phone
// (CPU 6x slower), on a search screen that writes none (2026-10-08).
let whole: Intl.NumberFormat | null = null;
// And then made as soon as the page is idle, so the first figure written
// after a tap does not pay for it: an airport's card opened from the
// search, its elevation the first, took 0.2 s longer (2026-10-08).
if (typeof window !== "undefined") {
  (window.requestIdleCallback ?? ((go: () => void) => window.setTimeout(go, 2000)))(() => { whole ??= new Intl.NumberFormat(); });
}

/** A whole-number altitude with a thousands separator: "12,500". */
export function altFt(ft: number | null | undefined): string {
  whole ??= new Intl.NumberFormat();
  return ft === null || ft === undefined ? "—" : whole.format(Math.round(ft));
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
