import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../../components/ui/accordion";
import { usePrinting } from "../../../lib/usePrinting";
import type { AltitudeOption, AltitudeSegment, Leg, NavLogAltitude } from "../../../lib/api/types";
import { CRUISE_REFERENCE_FT } from "../../../lib/performance";
import { TEXT } from "../../../lib/text";
import { faaWords } from "../../../lib/advisories";
import { altFt, cruiseByAltitude, deg, describeFuel, describeSteps, describeTime } from "../format";

interface Props {
  /** The nav log's own altitude and, unless the pilot typed one, the
   *  planner's breakdown of how it chose it and the four plans. */
  nav: NavLogAltitude;
  /** The legs flown, as they stream in: each one's cruise in its own
   *  air, which the performance step says. */
  legs: Leg[];
}

/** "a, b and c" -- the ceiling is the lowest of up to three things. */
function join(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const KIND_LABEL: Record<AltitudeOption["kind"], string> = {
  lowest: "Lowest", highest: "Highest", fastest: "Fastest", economical: "Economical",
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
 * obstacles, the ceiling from airspace and the airplane -- leg by
 * leg, since a Class B shelf caps only the legs
 * under it -- the hemispheric rule that gives the legal altitudes in
 * between, the four plans made of them and the one being flown, the
 * airplane's performance in the day's air they were flown at, and
 * the weather that was checked but does not move the numbers. Every
 * figure is the planner's own, so the pilot can check each one against
 * the chart -- the nav log header's "why" popover and the briefing's
 * Cruise Altitude section are both this.
 */
/** Words set in a sentence's middle: their first letter small, unless
 *  it starts a code ("NOTAM"). */
const midSentence = (words: string) => (/^[A-Z][a-z]/.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words);

/** A special-use area's floor or ceiling as the FAA states it. */
function limit(ft: number | null | undefined, ref: string | null | undefined): string {
  if (ref === "SFC") return "the surface";
  if (ft === null || ft === undefined) return "unstated";
  return `${altFt(ft)} ft${ref === "AGL" ? " AGL" : ""}`;
}

export default function AltitudeReasoning({ nav, legs }: Props) {
  const s = nav.altitude_selection;
  const [open, setOpen] = useState<string[]>([]);
  const printing = usePrinting();

  // Every figure below is the planner's own, the rule's hemisphere and
  // the oxygen check included: this names them, it does not redo them.

  const ceilingParts: string[] = [
    s.airspace_ceiling_ft !== null ? `the Class B shelf at ${altFt(s.airspace_ceiling_ft)} ft` : "no Class B shelf across the route",
  ];
  // The clouds, 14 CFR 91.155's distance below the lowest ceiling the
  // TAFs near the legs forecast for the flight: 500 ft, or 1,000 ft
  // where that is at 10,000 ft or above.
  // Where the clouds leave no altitude, the band leaves them out, and a
  // sentence of its own under the ceiling says so.
  if (s.cloud_base_ft != null && s.cloud_ceiling_ft != null && s.cloud_clearance_kept) {
    ceilingParts.push(`${s.cloud_ceiling_ft >= 10000 ? "1,000" : "500"} ft under the clouds forecast at ${
      altFt(s.cloud_base_ft)} ft near ${s.cloud_station} (14 CFR 91.155)`);
  } else if (!s.weather_unavailable.includes("ceiling_visibility")) {
    ceilingParts.push("no ceiling forecast near the legs");
  }
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
  // A service ceiling is a density altitude: the forecast temperatures
  // bring it down on a warm day and lift it on a cold one.
  const bookCeiling = nav.aircraft.service_ceiling_ft;
  const ceilingToday = s.service_ceiling_ft;
  ceilingParts.push(ceilingToday != null && Math.abs(ceilingToday - bookCeiling) >= 100
    ? `the ${nav.aircraft.name.toUpperCase()}'s service ceiling, ${altFt(bookCeiling)} ft density altitude, which is ${
      altFt(ceilingToday)} ft in the forecast temperatures`
    : `the ${nav.aircraft.name.toUpperCase()}'s service ceiling of ${altFt(bookCeiling)} ft`);
  const runs = ceilingRuns(s.segments);
  const runsText = runs.length > 1
    ? runs.map((r, i) => {
      const why = r.cloud_ceiling_ft != null && r.cloud_ceiling_ft === r.band_ceiling_ft
        ? `the clouds near ${r.cloud_station}`
        : r.airspace_ceiling_ft !== null && r.airspace_ceiling_ft === r.band_ceiling_ft
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

  // The airplane's cruise in each leg's own air (vfr.performance): its
  // figures are its own at the reference altitude on a standard day, and
  // each leg's are worked out for the forecast temperature at its
  // altitude. Legs from a planner that did not say have none.
  const aircraft = nav.aircraft;
  const flown = legs.filter(leg => leg.tas_kt != null);
  const cruiseInItsAir = cruiseByAltitude(flown, aircraft.cruise_power_pct);
  const standardDayLegs = flown.filter(leg => leg.oat_c == null).length;

  const highestLegal = Math.max(...s.segments.flatMap(seg => seg.candidates_ft), ...s.candidates_ft);
  const chosen = nav.options.find(o => o.kind === nav.flown);
  const needOxygen = nav.options.filter(o => o.needs_oxygen).map(o => KIND_LABEL[o.kind].toLowerCase());

  const cloudsLeaveNone = !s.cloud_clearance_kept && s.cloud_base_ft != null;
  const checkedSummary = s.weather_unavailable.includes("ceiling_visibility")
    ? "forecast not checked"
    : `ceiling ${s.min_ceiling_ft === null ? "none" : `${altFt(s.min_ceiling_ft)} ft`}, ${s.min_visibility_sm ?? "—"} sm`;
  const specialUse = s.special_use ?? [];

  // Each step's conclusion is its row, the figure in it; how it was
  // reached folds under it (the stock accordion), so the steps read in a
  // glance and a pilot opens the one they doubt. They were paragraphs of
  // seven to fifteen lines each. On paper every step is open.
  const steps: { key: string; head: ReactNode; body: ReactNode }[] = [
    {
      key: "floor",
      head: <>Floor {altFt(s.floor_ft)} ft</>,
      body: (
        <>
          The highest ground along the course plus 1,000 ft (14 CFR 91.119 over a town, which the planner cannot tell
          from a field), or the tallest charted obstacle within 5 nm of it plus 100 ft, whichever is higher, rounded up
          to the next 100 ft. Worked out leg by leg as well, so a leg over lower ground may fly lower.
        </>
      ),
    },
    {
      key: "ceiling",
      head: (
        <>
          Ceiling {s.band_ceiling_ft !== null ? `${altFt(s.band_ceiling_ft)} ft` : "none"}
          {cloudsLeaveNone && (
            <span className="block font-normal text-destructive">
              Under the clouds near {s.cloud_station}, no VFR altitude on {s.segments.some(seg => seg.cloud_clearance_kept) ? "some legs" : "the route"}
            </span>
          )}
        </>
      ),
      body: (
        <>
          The lowest of {join(ceilingParts)}.
          {runsText && ` Leg by leg: ${runsText}. A shelf or a cloud caps only the legs under it.`}
          {cloudsLeaveNone && (
            <span className="text-destructive">
              {" "}No altitude keeps 500 ft below the clouds forecast at {altFt(s.cloud_base_ft!)} ft near {s.cloud_station} on
              {" "}{s.segments.some(seg => seg.cloud_clearance_kept) ? "some legs" : "the route"}: VFR is not possible there as
              forecast, and the altitudes there leave the clouds out.
            </span>
          )}
        </>
      ),
    },
    {
      key: "rule",
      head: <>{s.eastbound ? "Eastbound: odd" : "Westbound: even"} thousands plus 500 ft (14 CFR 91.159)</>,
      body: (
        <>
          {`A magnetic course of ${deg(s.course_magnetic_deg)} is `}
          {s.eastbound ? "eastbound (000–179°)" : "westbound (180–359°)"}
          {s.hemispheric_rule_from_ft != null && s.hemispheric_rule_from_ft >= s.floor_ft
            ? `. The rule applies above ${altFt(s.hemispheric_rule_from_ft)} ft, 3,000 ft over the lowest ground; below that every 500 ft is legal too. `
            : ". "}
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
        </>
      ),
    },
    nav.options.length > 0 ? {
      key: "plans",
      head: (
        <>
          Four plans
          {nav.flown === "custom" ? `: flying ${altFt(nav.altitude_ft)} ft, your own` : nav.flown === null ? ": none flown, the winds aloft could not be read" : chosen && `: flying the ${KIND_LABEL[chosen.kind].toLowerCase()}`}
        </>
      ),
      body: (
        <>
          Lowest and highest keep to the bottom and the top of the legal altitudes; fastest takes the winds aloft for
          the least time, and economical for the least fuel, every climb counted.{" "}
          {nav.options.map(o => (
            `${KIND_LABEL[o.kind]}: ${describeSteps(o)}, ${describeTime(o)}, ${describeFuel(o)}`
            + (o.climb_penalty_min > 0 ? `, ${Math.round(o.climb_penalty_min)} min of it climbing` : "")
            + (o.tailwind_kt !== null ? `, ${Math.abs(Math.round(o.tailwind_kt))} kt ${o.tailwind_kt >= 0 ? "tailwind" : "headwind"} on average` : "")
            + "."
          )).join(" ")}
          {needOxygen.length > 0 && ` The ${join(needOxygen)} ${needOxygen.length === 1 ? "plan climbs" : "plans climb"} above the altitude where more than 30 minutes needs supplemental oxygen (14 CFR 91.211).`}
        </>
      ),
    } : {
      // No plans only when the winds could not be read before they were
      // made: a route with no legal altitude on some leg ends in an error
      // instead, with no altitude message at all.
      key: "plans",
      // Why, in the row itself: folded, the reason was the one thing a
      // pilot had to open the step to learn.
      head: <>No plan: the winds aloft could not be read</>,
      body: <>No plan can be made or flown without them. Try again shortly.</>,
    },
    ...(cruiseInItsAir.length > 0 ? [{
      key: "performance",
      head: <>Performance in the day&apos;s air</>,
      body: (
        <>
          {`The airplane's ${aircraft.cruise_tas_kt} kt and ${aircraft.fuel_burn_gph} gph are its cruise${
            aircraft.cruise_power_pct != null ? ` at ${aircraft.cruise_power_pct}% power` : ""} at ${
            altFt(CRUISE_REFERENCE_FT)} ft on a standard day, and each leg flies them in the forecast air at its altitude:`}
          <ul className="my-1 list-disc pl-4">
            {cruiseInItsAir.map(line => <li key={line}>{line}</li>)}
          </ul>
          {standardDayLegs > 0 && `No temperature is forecast near ${standardDayLegs === 1 ? "one leg" : `${standardDayLegs} legs`}, so a standard day is assumed there. `}
          {`Climbs are at the best rate${aircraft.climb_rate_fpm_sea_level != null ? `, ${aircraft.climb_rate_fpm_sea_level} fpm at sea level` : ""
          } falling to 100 fpm at the service ceiling, and burn less as full throttle makes less. A model: the handbook governs.`}
        </>
      ),
    }] : []),
    {
      key: "checked",
      head: <>Checked as well: {checkedSummary}</>,
      body: (
        <>
          {s.weather_unavailable.includes("ceiling_visibility")
            ? "The forecast ceiling and visibility could not be checked, so no altitude is kept under the clouds. "
            : `Forecast for the flight, its temporary changes included: ceiling ${
              s.min_ceiling_ft === null ? "none" : `${altFt(s.min_ceiling_ft)} ft`}, visibility ${s.min_visibility_sm ?? "—"} sm${
              s.low_ceiling_or_visibility ? ", below VFR minimums (1,000 ft, 3 sm) somewhere on the way" : ""
            }. `}
          {hazards.charAt(0).toUpperCase() + hazards.slice(1)}. {freezing}
        </>
      ),
    },
    ...(specialUse.length > 0 ? [{
      key: "special-use",
      head: <>Special-use airspace: {join(specialUse.map(a => a.name))}</>,
      body: (
        <>
          {join(specialUse.map(a =>
            `${a.name} (${a.kind}, ${limit(a.floor_ft, a.floor_ref)} to ${limit(a.ceiling_ft, a.ceiling_ref)}, ${a.along_track_nm} nm out${
              a.type === "P" ? ", no altitude through it" : a.times_of_use ? `, in use ${midSentence(faaWords(a.times_of_use))}` : ""})`))}.
          {specialUse.some(a => a.type !== "P") &&
            " Check whether each is active with its controlling agency or flight service before you go."}
        </>
      ),
    }] : []),
    ...(s.weather_unavailable.includes("special_use") ? [{
      key: "special-use-unchecked",
      head: <>Special-use airspace not checked</>,
      body: <>Look for prohibited and restricted areas and MOAs on the chart yourself.</>,
    }] : []),
    ...(s.airspace_transits.length > 0 ? [{
      key: "transits",
      head: <>A radio call on the way: {join(s.airspace_transits.map(t => t.name))}</>,
      body: (
        <>
          Not a ceiling: {join(s.airspace_transits.map(t =>
            `${t.name} (Class ${t.class}, ${t.floor_ft_msl ? `floor ${altFt(t.floor_ft_msl)} ft` : "from the surface"}, ${t.along_track_nm} nm out, ${t.requires})`))}.
        </>
      ),
    }] : []),
  ];

  return (
    <Accordion type="multiple" value={printing ? steps.map(step => step.key) : open} onValueChange={setOpen} data-testid="altitude-steps">
      {steps.map(step => (
        <AccordionItem key={step.key} value={step.key}>
          <AccordionTrigger className={cn("py-3 font-semibold", TEXT.prose)}>
            <span>{step.head}</span>
          </AccordionTrigger>
          <AccordionContent className={cn("pb-3", TEXT.prose)}>{step.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
