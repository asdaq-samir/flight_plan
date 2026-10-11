import type { AltitudeBreakdown, Briefing } from "./api/types";
import { grouped } from "./units";

/**
 * Under IFR, whether the flight is planned into icing: a leg flown at or
 * above the freezing level, where the moisture icing needs is forecast --
 * cloud along the route, or an icing AIRMET or SIGMET over it (the
 * planner's `icing_possible`, vfr.altitude) -- with the pilot reports of
 * icing near the route. Under VFR the flight stays clear of cloud (14 CFR
 * 91.155), and the freezing level is the altitude reasoning's line alone.
 */
export interface IcingAtAltitude {
  /** The highest altitude flown at or above the freezing level. */
  altitudeFt: number;
  freezingLevelFt: number;
  /** The forecast is below freezing at its lowest altitude. */
  atOrBelow: boolean;
  /** Pilot reports of icing near the route, of any intensity but none. */
  reports: number;
}

export function icingAtAltitude(
  selection: AltitudeBreakdown, flownFt: number[], pireps: Briefing["pireps"],
): IcingAtAltitude | null {
  const level = selection.freezing_level_ft;
  if (level == null || !selection.icing_possible || !flownFt.length) return null;
  const highest = Math.max(...flownFt);
  if (!selection.freezing_level_at_or_below && highest < level) return null;
  // A report's intensity as sent: NEG (and NEGclr) is none.
  const reports = pireps.filter(p => p.icing && !p.icing.toUpperCase().startsWith("NEG")).length;
  return { altitudeFt: highest, freezingLevelFt: level, atOrBelow: !!selection.freezing_level_at_or_below, reports };
}

const ft = (n: number) => `${grouped(n)} ft`;

/** In a line, for the Go / No-Go. */
export function icingLine(icing: IcingAtAltitude): string {
  return `Icing possible at ${ft(icing.altitudeFt)}: the freezing level ${icing.atOrBelow ? "at or below" : "at"} ${ft(icing.freezingLevelFt)}, in cloud${
    icing.reports ? `; ${icing.reports} pilot report${icing.reports === 1 ? "" : "s"} of icing near the route` : ""}`;
}
