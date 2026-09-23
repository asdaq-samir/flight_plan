/** How an altitude, a ceiling or a visibility is written everywhere on
 *  the page: one formatter each, so a nav log, a briefing and a map card
 *  never write the same figure two ways. A missing figure is an em dash
 *  -- nothing reported, which is not the same as zero. */

/** A whole-number altitude with a thousands separator: "12,500". */
export function altFt(ft: number | null | undefined): string {
  return ft === null || ft === undefined ? "—" : Math.round(ft).toLocaleString();
}

/** The same with its unit: "12,500 ft". */
export function feet(ft: number | null | undefined): string {
  return ft === null || ft === undefined ? "—" : `${altFt(ft)} ft`;
}

/** Statute miles as reported: "2.5 sm". */
export function miles(sm: number | null | undefined): string {
  return sm === null || sm === undefined ? "—" : `${sm} sm`;
}
