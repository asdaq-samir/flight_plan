import type { AltitudeBreakdown, Briefing } from "./api/types";
import { callEngine } from "./engine/engine";

/**
 * Under IFR, whether the flight is planned into icing: a leg flown at or
 * above the freezing level, where the moisture icing needs is forecast --
 * cloud along the route, or an icing AIRMET or SIGMET over it (the
 * planner's `icing_possible`, wingtip.altitude) -- with the pilot reports of
 * icing near the route. Under VFR the flight stays clear of cloud (14 CFR
 * 91.155), and the freezing level is the altitude reasoning's line alone.
 * The rule and its line are the shared engine's
 * (native/engine/src/gonogo/icing.rs, through lib/engine).
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
  const found = callEngine<{ altitude_ft: number; freezing_level_ft: number; at_or_below: boolean; reports: number } | null>("gonogo_icing", {
    selection: {
      freezing_level_ft: selection.freezing_level_ft ?? null, icing_possible: selection.icing_possible ?? null,
      freezing_level_at_or_below: selection.freezing_level_at_or_below ?? null,
    },
    flown_ft: flownFt, pireps: pireps.map(p => ({ icing: p.icing ?? null })),
  });
  return found && { altitudeFt: found.altitude_ft, freezingLevelFt: found.freezing_level_ft, atOrBelow: found.at_or_below, reports: found.reports };
}

/** In a line, for the Go / No-Go. */
export function icingLine(icing: IcingAtAltitude): string {
  return callEngine("gonogo_icing_line", {
    icing: { altitude_ft: icing.altitudeFt, freezing_level_ft: icing.freezingLevelFt, at_or_below: icing.atOrBelow, reports: icing.reports },
  });
}
