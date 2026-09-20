import type { NavLog } from "../../../lib/api/types";
import { altFt, deg } from "../format";

interface Props {
  /** The nav log's own altitude and, unless the pilot typed one, the
   *  planner's breakdown of how it chose it. */
  nav: Omit<NavLog, "legs" | "totals">;
  /** The route's true course, for the hemispheric rule. */
  bearingDeg: number | null;
}

/** "a, b and c" -- the ceiling is the lowest of up to three things. */
function join(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * How the cruise altitude was chosen, step by step, in the planner's
 * own order (`vfr.altitude.select_cruise_altitude`): the floor from
 * terrain and obstacles, the ceiling from airspace, the freezing level
 * and the aeroplane, the hemispheric rule that picks the lowest legal
 * altitude in between, and the weather that was checked but does not
 * move the number. Every figure is the planner's own, so the pilot can
 * check each one against the chart -- the nav log header's "why"
 * popover and the briefing's Cruise Altitude section are both this.
 */
export default function AltitudeReasoning({ nav, bearingDeg }: Props) {
  const s = nav.altitude_selection;
  if (!s) {
    return (
      <p className="text-sm text-muted-foreground">
        {altFt(nav.altitude_ft)} ft is yours: you typed it in the Alt box, and the planner flew the log at
        it. Clear the box and press Load, and the planner picks the lowest legal VFR cruising altitude
        above the terrain and obstacle floor, under any Class B shelf and the freezing level.
      </p>
    );
  }

  // The profile is the planner's own aircraft file, whatever it holds;
  // the service ceiling is one of its required fields.
  const serviceCeilingFt = (nav.aircraft as { service_ceiling_ft?: number }).service_ceiling_ft ?? null;
  const eastbound = bearingDeg !== null && ((bearingDeg % 360) + 360) % 360 < 180;

  const ceilingParts: string[] = [
    s.airspace_ceiling_ft !== null ? `the Class B shelf at ${altFt(s.airspace_ceiling_ft)} ft` : "no Class B shelf across the route",
    s.weather_unavailable.includes("freezing_level")
      ? "the freezing level (could not be checked)"
      : s.freezing_level_ft !== null
        ? `the freezing level at ${altFt(s.freezing_level_ft)} ft`
        : "no freezing level in range (the forecast stays above 0 °C)",
  ];
  if (serviceCeilingFt !== null) ceilingParts.push(`the ${nav.aircraft.name.toUpperCase()}'s service ceiling of ${altFt(serviceCeilingFt)} ft`);

  const hazards = s.weather_unavailable.includes("hazards")
    ? "SIGMETs and AIRMETs could not be checked"
    : s.hazards.length === 0
      ? "no SIGMET or AIRMET along the route"
      : `${s.hazards.length} SIGMET/AIRMET${s.hazards.length === 1 ? "" : "s"} along the route`;

  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      <li>
        <b>Floor {altFt(s.floor_ft)} ft.</b> The highest ground within 5 nm of the course plus 300 ft, or the
        tallest charted obstacle plus 100 ft, whichever is higher, rounded up to the next 100 ft: the same rule
        as a sectional's maximum elevation figure.
      </li>
      <li>
        <b>Ceiling {s.band_ceiling_ft !== null ? `${altFt(s.band_ceiling_ft)} ft` : "none"}.</b>{" "}
        The lowest of {join(ceilingParts)}.
      </li>
      <li>
        <b>The rule.</b>{" "}
        {bearingDeg !== null ? `A true course of ${deg(bearingDeg)} is ` : "The course is "}
        {eastbound ? "eastbound (000–179°): odd thousands plus 500 ft" : "westbound (180–359°): even thousands plus 500 ft"}
        {" "}(14 CFR 91.159).{" "}
        {s.recommended_ft !== null
          ? `The lowest such altitude at or above the floor is ${altFt(s.recommended_ft)} ft, and it is under the ceiling: that is the nav log's altitude.`
          : "No such altitude fits between the floor and the ceiling. Type one in the Alt box, or plan under or around the airspace."}
      </li>
      <li>
        <b>Checked, not part of the choice.</b>{" "}
        {s.weather_unavailable.includes("ceiling_visibility")
          ? "The forecast ceiling and visibility could not be checked. "
          : `Forecast along the route: ceiling ${altFt(s.min_ceiling_ft)} ft, visibility ${s.min_visibility_sm ?? "—"} sm${
            s.low_ceiling_or_visibility ? ", below VFR minimums (1,000 ft, 3 sm) somewhere on the way" : ""
          }. `}
        {hazards.charAt(0).toUpperCase() + hazards.slice(1)}.
      </li>
      {s.airspace_transits.length > 0 && (
        <li>
          <b>On the way, a radio call, not a ceiling:</b>{" "}
          {join(s.airspace_transits.map(t =>
            `${t.name} (Class ${t.class}, ${t.floor_ft_msl ? `floor ${altFt(t.floor_ft_msl)} ft` : "from the surface"}, ${t.along_track_nm} nm out, ${t.requires})`))}.
        </li>
      )}
    </ol>
  );
}
