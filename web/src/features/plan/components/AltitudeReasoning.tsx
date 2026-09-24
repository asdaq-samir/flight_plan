import type { AltitudeOption, AltitudeSegment, NavLogAltitude } from "../../../lib/api/types";
import { altFt, deg, describeSteps, describeTime } from "../format";

interface Props {
  /** The nav log's own altitude and, unless the pilot typed one, the
   *  planner's breakdown of how it chose it and the three plans. */
  nav: NavLogAltitude;
}

/** "a, b and c" -- the ceiling is the lowest of up to three things. */
function join(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const KIND_LABEL: Record<AltitudeOption["kind"], string> = {
  lowest: "Lowest", highest: "Highest", fastest: "Fastest",
};

/** Consecutive segments under the same shelf, for "the ceiling leg by
 *  leg": [{from_nm, to_nm, airspace_ceiling_ft, band_ceiling_ft}]. */
function ceilingRuns(segments: AltitudeSegment[]): AltitudeSegment[] {
  const runs: AltitudeSegment[] = [];
  for (const s of segments) {
    const last = runs[runs.length - 1];
    if (last && last.band_ceiling_ft === s.band_ceiling_ft) last.to_nm = s.to_nm;
    else runs.push({ ...s });
  }
  return runs;
}

/**
 * How the cruise altitude was chosen, step by step, in the planner's
 * own order (`vfr.altitude.select_cruise_altitude` and
 * `vfr.navlog.altitude_profiles`): the floor from terrain and
 * obstacles, the ceiling from airspace and the aeroplane -- leg by
 * leg, since a Class B shelf caps only the legs
 * under it -- the hemispheric rule that gives the legal altitudes in
 * between, the three plans made of them and the one being flown, and
 * the weather that was checked but does not move the numbers. Every
 * figure is the planner's own, so the pilot can check each one against
 * the chart -- the nav log header's "why" popover and the briefing's
 * Cruise Altitude section are both this.
 */
/** A special-use area's floor or ceiling as the FAA states it. */
function limit(ft: number | null | undefined, ref: string | null | undefined): string {
  if (ref === "SFC") return "the surface";
  if (ft === null || ft === undefined) return "unstated";
  return `${altFt(ft)} ft${ref === "AGL" ? " AGL" : ""}`;
}

export default function AltitudeReasoning({ nav }: Props) {
  const s = nav.altitude_selection;

  // Every figure below is the planner's own, the rule's hemisphere and
  // the oxygen check included: this names them, it does not redo them.

  const ceilingParts: string[] = [
    s.airspace_ceiling_ft !== null ? `the Class B shelf at ${altFt(s.airspace_ceiling_ft)} ft` : "no Class B shelf across the route",
  ];
  // Icing is a warning, not a ceiling: the planner no longer caps the
  // band at the freezing level (icing needs cloud as well as cold).
  const freezing = s.weather_unavailable.includes("freezing_level")
    ? "The freezing level could not be checked."
    : s.freezing_level_ft === null
      ? "No freezing level in range: the forecast stays above 0 °C."
      : `Freezing level ${s.freezing_level_at_or_below ? "at or below" : "at"} ${altFt(s.freezing_level_ft)} ft${
        s.icing_possible
          ? " — icing is possible at and above it: cloud or an icing AIRMET is forecast along the route."
          : ", with no cloud or icing AIRMET forecast along the route."}`;
  // Legs whose own magnetic course is in the other half of the rule
  // from the route's, and so round to the other set of altitudes.
  const otherHalf = s.segments.filter(seg => seg.eastbound !== null && seg.eastbound !== undefined && seg.eastbound !== s.eastbound);
  ceilingParts.push(`the ${nav.aircraft.name.toUpperCase()}'s service ceiling of ${altFt(nav.aircraft.service_ceiling_ft)} ft`);
  const runs = ceilingRuns(s.segments);
  const runsText = runs.length > 1
    ? runs.map((r, i) => {
      const why = r.airspace_ceiling_ft !== null && r.airspace_ceiling_ft === r.band_ceiling_ft
        ? "the Class B shelf"
        : "the service ceiling";
      const where = i === 0 ? `for the first ${r.to_nm} nm` : i === runs.length - 1 ? "the rest of the way" : `from ${r.from_nm} to ${r.to_nm} nm`;
      return `${r.band_ceiling_ft === null ? "none" : `${altFt(r.band_ceiling_ft)} ft`} (${why}) ${where}`;
    }).join(", then ")
    : null;

  const hazards = s.weather_unavailable.includes("hazards")
    ? "SIGMETs and AIRMETs could not be checked"
    : s.hazards.length === 0
      ? "no SIGMET or AIRMET along the route"
      : `${s.hazards.length} SIGMET/AIRMET${s.hazards.length === 1 ? "" : "s"} along the route`;

  const highestLegal = Math.max(...s.segments.flatMap(seg => seg.candidates_ft), ...s.candidates_ft);
  const chosen = nav.options.find(o => o.kind === nav.flown);
  const needOxygen = nav.options.filter(o => o.needs_oxygen).map(o => KIND_LABEL[o.kind].toLowerCase());

  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      <li>
        <b>Floor {altFt(s.floor_ft)} ft.</b> The highest ground within 5 nm of the course plus 300 ft, or the
        tallest charted obstacle plus 100 ft, whichever is higher, rounded up to the next 100 ft: the same rule
        as a sectional's maximum elevation figure. Worked out leg by leg as well, so a leg over lower ground
        may fly lower.
      </li>
      <li>
        <b>Ceiling {s.band_ceiling_ft !== null ? `${altFt(s.band_ceiling_ft)} ft` : "none"} for the whole route.</b>{" "}
        The lowest of {join(ceilingParts)}.
        {runsText && ` Leg by leg: ${runsText} -- a shelf caps only the legs under it.`}
      </li>
      <li>
        <b>The rule.</b>{" "}
        {`A magnetic course of ${deg(s.course_magnetic_deg)} is `}
        {s.eastbound ? "eastbound (000–179°): odd thousands plus 500 ft" : "westbound (180–359°): even thousands plus 500 ft"}
        {" "}(14 CFR 91.159).{" "}
        {s.candidates_ft.length > 0
          ? `Legal for the whole route: ${s.candidates_ft.map(a => altFt(a)).join(", ")} ft`
          : "No one altitude is legal for the whole route"}
        {otherHalf.length > 0 &&
          `. ${otherHalf.length === 1 ? "One leg flies" : `${otherHalf.length} legs fly`} a magnetic course in the other half (${
            otherHalf.map(seg => `${deg(seg.course_magnetic_deg ?? 0)} from ${seg.from_nm} nm`).join(", ")
          }) and ${otherHalf.length === 1 ? "is" : "are"} rounded to its altitudes`}
        {Number.isFinite(highestLegal) && highestLegal > (s.candidates_ft[s.candidates_ft.length - 1] ?? -Infinity)
          ? `; leg by leg, up to ${altFt(highestLegal)} ft.`
          : "."}
      </li>
      {nav.options.length > 0 ? (
        <li>
          <b>Three plans.</b>{" "}
          {nav.options.map(o => (
            `${KIND_LABEL[o.kind]}: ${describeSteps(o)}, ${describeTime(o)}`
            + (o.climb_penalty_min > 0 ? `, ${Math.round(o.climb_penalty_min)} min of it climbing` : "")
            + (o.tailwind_kt !== null ? `, ${Math.abs(Math.round(o.tailwind_kt))} kt ${o.tailwind_kt >= 0 ? "tailwind" : "headwind"} on average` : "")
            + "."
          )).join(" ")}
          {nav.flown === "custom"
            ? ` Flying ${altFt(nav.altitude_ft)} ft, your own, the whole way instead.`
            : nav.flown === null
              ? " None is flown: the winds aloft could not be read."
              : chosen && ` Flying the ${KIND_LABEL[chosen.kind].toLowerCase()}.`}
          {needOxygen.length > 0 && ` The ${join(needOxygen)} ${needOxygen.length === 1 ? "plan climbs" : "plans climb"} above the altitude where more than 30 minutes needs supplemental oxygen (14 CFR 91.211).`}
        </li>
      ) : (
        // No plans only when the winds could not be read before they
        // were made: a route with no legal altitude on some leg ends in
        // an error instead, with no altitude message at all. This used to
        // say that of a winds outage.
        <li>
          <b>No plan.</b> The winds aloft could not be read, so no plan could be flown. Try again shortly.
        </li>
      )}
      <li>
        <b>Checked, not part of the choice.</b>{" "}
        {s.weather_unavailable.includes("ceiling_visibility")
          ? "The forecast ceiling and visibility could not be checked. "
          : `Forecast for the flight, its temporary changes included: ceiling ${
            s.min_ceiling_ft === null ? "none" : `${altFt(s.min_ceiling_ft)} ft`}, visibility ${s.min_visibility_sm ?? "—"} sm${
            s.low_ceiling_or_visibility ? ", below VFR minimums (1,000 ft, 3 sm) somewhere on the way" : ""
          }. `}
        {hazards.charAt(0).toUpperCase() + hazards.slice(1)}. {freezing}
      </li>
      {(s.special_use?.length ?? 0) > 0 && (
        <li>
          <b>Special-use airspace on the way:</b>{" "}
          {join((s.special_use ?? []).map(a =>
            `${a.name} (${a.kind}, ${limit(a.floor_ft, a.floor_ref)} to ${limit(a.ceiling_ft, a.ceiling_ref)}, ${a.along_track_nm} nm out${
              a.type === "P" ? ", no altitude through it" : a.times_of_use ? `, in use ${a.times_of_use}` : ""})`))}.
          {(s.special_use ?? []).some(a => a.type !== "P") &&
            " Check whether each is active with its controlling agency or flight service before you go."}
        </li>
      )}
      {s.weather_unavailable.includes("special_use") && (
        <li>
          <b>Special-use airspace could not be checked.</b> Look for prohibited and restricted areas and MOAs on the
          chart yourself.
        </li>
      )}
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
