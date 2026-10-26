import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../../components/ui/accordion";
import { usePrinting } from "../../../lib/usePrinting";
import type { AltitudeSegment, Leg, NavLogAltitude } from "../../../lib/api/types";
import { CRUISE_REFERENCE_FT } from "../../../lib/performance";
import { TEXT } from "../../../lib/text";
import { flightLevel } from "../../../lib/units";
import { faaWords, suaAltitudes } from "../../../lib/advisories";
import { altFt, bearing, cruiseByAltitude, describeFuel, describeSteps, describeTime, PLAN_NAME } from "../format";

interface Props {
  /** The nav log's own altitude and, unless the pilot typed one, the
   *  planner's breakdown of how it chose it and the four plans. */
  nav: NavLogAltitude;
  /** The legs flown, as they stream in: each one's cruise in its own
   *  air, which the performance step says. */
  legs: Leg[];
  /** The four plans are said above the steps, as the FL chip's buttons
   *  (AltitudeGroup): their step comes after the rule, and says how
   *  they were made. Without it (the Brief) the plan flown comes first,
   *  with its time and fuel, as the answer. */
  plansAbove?: boolean;
}

/** One step: its name, the reason in a line under it, and its figure at
 *  the end, as a list's row has them (ListRow); how it was reached folds
 *  under it. */
interface Step {
  key: string;
  title: ReactNode;
  detail?: ReactNode;
  value?: string;
  body: ReactNode;
}

/** The two halves of the direction of flight, in the rule's own words:
 *  "a magnetic course of zero degrees through 179 degrees", "180 degrees
 *  through 359 degrees" (14 CFR 91.159(a), 91.179(b)). */
const EASTBOUND = "eastbound (0° through 179°)";
const WESTBOUND = "westbound (180° through 359°)";

/** A course as the rule sorts it: cut to the whole degree, not rounded,
 *  as the planner sorts the exact course (vfr.altitude.is_eastbound) --
 *  a course of 179.6° rounded read "180° is eastbound" -- north as 360,
 *  as every bearing is written (lib/units' bearing). */
const ruleCourse = (course: number) => bearing(Math.floor(course));

/** "a, b and c" -- the ceiling is the lowest of up to three things. */
function join(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** What sets the whole route's VFR ceiling, the lowest of three
 *  (vfr.altitude's band_ceiling): the clouds (14 CFR 91.155's distance
 *  under the lowest forecast near a leg), a Class B shelf, or the
 *  airplane. */
function ceilingReason(s: NavLogAltitude["altitude_selection"]): string | null {
  if (s.band_ceiling_ft == null) return null;
  if (s.cloud_ceiling_ft != null && s.cloud_ceiling_ft === s.band_ceiling_ft) return `Under the clouds near ${s.cloud_station}`;
  if (s.airspace_ceiling_ft != null && s.airspace_ceiling_ft === s.band_ceiling_ft) return "The Class B shelf";
  return "The airplane's service ceiling";
}

/** Words set in a sentence's middle: their first letter small, unless
 *  it starts a code ("NOTAM"). */
/** The airplane as its profile names it, "Cessna 172", and its own
 *  name where the profile gives no type: never put in capitals, which
 *  turned a profile's "c172" into a shout in the middle of a sentence. */
const airplaneName = (nav: NavLogAltitude) => nav.aircraft.type ?? nav.aircraft.name;
const midSentence = (words: string) => (/^[A-Z][a-z]/.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words);

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
 * the chart -- the FL chip's popover and the Brief's Cruise Altitude
 * section are both this.
 *
 * A row a step, in a list's box: its name, its reason and its figure
 * ("Floor · Terrain and obstacles, with margin · 2,600 ft"), with how it
 * was reached folded under it. In the Brief the plan flown comes first,
 * and these are the whole section, at the owner's pick of the redesign
 * (each fact said once): a list of the plan, the floor and the ceiling
 * sat over the steps, which said all three again.
 */
export default function AltitudeReasoning({ nav, legs, plansAbove = false }: Props) {
  const s = nav.altitude_selection;
  // Under IFR the floor, the ceiling and the rule are IFR's (the
  // planner's vfr.ifr): said in their words below.
  const ifr = s.rules === "ifr";
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
    ? `the ${airplaneName(nav)}'s service ceiling, ${altFt(bookCeiling)} ft density altitude, which is ${
      altFt(ceilingToday)} ft in the forecast temperatures`
    : `the ${airplaneName(nav)}'s service ceiling of ${altFt(bookCeiling)} ft`);
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
  const needOxygen = nav.options.filter(o => o.needs_oxygen).map(o => PLAN_NAME[o.kind].toLowerCase());

  const cloudsLeaveNone = !s.cloud_clearance_kept && s.cloud_base_ft != null;
  const checkedSummary = s.weather_unavailable.includes("ceiling_visibility")
    ? "forecast not checked"
    : `ceiling ${s.min_ceiling_ft === null ? "none" : `${altFt(s.min_ceiling_ft)} ft`}, ${s.min_visibility_sm ?? "—"} sm`;
  const specialUse = s.special_use ?? [];

  // Each step's conclusion is its row, the figure in it; how it was
  // reached folds under it (the stock accordion), so the steps read in a
  // glance and a pilot opens the one they doubt. They were paragraphs of
  // seven to fifteen lines each. On paper every step is open.
  // The highest obstacle a leg's IFR floor rests on, and whether any leg
  // is over a mountainous area (14 CFR Part 95).
  const highest = s.segments.reduce<AltitudeSegment | null>(
    (top, seg) => (seg.highest_ft != null && (top === null || (seg.highest_ft ?? 0) > (top.highest_ft ?? 0)) ? seg : top), null);
  // The airways flown, each with its published altitudes, once: a V100
  // flown over three segments of the same MEA is one line.
  const airways = s.segments.flatMap(seg => (seg.airway ? [seg.airway] : []))
    .filter((a, i, all) => all.findIndex(b => b.id === a.id && b.mea_ft === a.mea_ft && b.maa_ft === a.maa_ft) === i);
  // Under IFR the ceiling is the airplane's service ceiling, or an
  // airway's MAA under it (vfr.altitude's band): no shelf or cloud.
  const ifrCeilingReason = s.band_ceiling_ft == null ? null
    : s.band_ceiling_ft === (ceilingToday ?? bookCeiling) ? "The airplane's service ceiling"
      : airways.some(a => a.maa_ft === s.band_ceiling_ft) ? "The airway's MAA" : null;
  const ceilingValue = s.band_ceiling_ft !== null ? `${altFt(s.band_ceiling_ft)} ft` : "none";
  const ifrSteps: Step[] = [
    {
      key: "floor",
      title: "Minimum IFR altitude",
      // 14 CFR 91.177(a): an airway's MEA, else 1,000 ft (2,000 in the
      // mountains) over the highest obstacle within 4 nm of the course.
      detail: airways.length > 0 ? "The airway's MEA, or obstacles within 4 nm" : "Obstacles within 4 nm, with margin",
      value: `${altFt(s.floor_ft)} ft`,
      body: (
        <>
          1,000 ft above the highest obstacle within 4 nm of the course, 2,000 ft over a mountainous area the FAA
          designates (14 CFR 91.177(a)(2), Part 95){s.mountainous ? ", as part of this route is" : ""}, rounded up to
          the next 100 ft: the ground from USGS heights, and the FAA&apos;s obstacle file.
          {highest && ` The highest, ${altFt(highest.highest_ft ?? 0)} ft, is ${highest.highest_is_obstacle ? "a charted obstacle" : "the ground"} from ${highest.from_nm} to ${highest.to_nm} nm.`}
          {" "}Worked out leg by leg, so a leg over lower ground may fly lower.
          {airways.length > 0
            ? airways.map(a => ` Along ${a.id} from ${a.from} the published MEA, ${altFt(a.mea_ft ?? a.gnss_mea_ft ?? 0)} ft${
              a.mea_ft == null ? " (GNSS)" : ""}, is the floor instead (91.177(a)(1))${
              a.moca_ft != null ? `; its MOCA, ${altFt(a.moca_ft)} ft, is legal within 22 nm of the VOR, not planned` : ""}${
              a.maa_ft != null ? `; nothing above its MAA, ${altFt(a.maa_ft)} ft` : ""}.`).join("")
            : " Off an airway the route is planned direct: on one, its published MEA governs (91.177(a)(1))."}
        </>
      ),
    },
    {
      key: "ceiling",
      title: "Ceiling",
      detail: ifrCeilingReason,
      value: ceilingValue,
      body: (
        <>
          {ceilingToday != null && Math.abs(ceilingToday - bookCeiling) >= 100
            ? `The ${airplaneName(nav)}'s service ceiling, ${altFt(bookCeiling)} ft density altitude, which is ${altFt(ceilingToday)} ft in the forecast temperatures. `
            : `The ${airplaneName(nav)}'s service ceiling of ${altFt(bookCeiling)} ft. `}
          Under IFR no Class B shelf, cloud or Class A caps it: the clearance takes the flight into each.
        </>
      ),
    },
    {
      key: "rule",
      title: `${s.eastbound ? "Eastbound: odd" : "Westbound: even"} thousands (14 CFR 91.179)`,
      body: (
        <>
          {`A magnetic course of ${ruleCourse(s.course_magnetic_deg)} is ${s.eastbound ? EASTBOUND : WESTBOUND}. `}
          ATC assigns the altitude in controlled airspace (91.179(a)), by this same direction of flight (FAA Order JO
          7110.65, 4-5-2); in uncontrolled airspace it is the rule (91.179(b)).{" "}
          {s.candidates_ft.length > 0
            ? `Legal for the whole route: ${s.candidates_ft.map(a => altFt(a)).join(", ")} ft`
            : "No one altitude is legal for the whole route"}
          {otherHalf.length > 0 &&
            `. ${otherHalf.length === 1 ? "One leg flies" : `${otherHalf.length} legs fly`} a magnetic course in the other half and ${otherHalf.length === 1 ? "is" : "are"} rounded to its altitudes`}
          .
        </>
      ),
    },
  ];
  const vfrSteps: Step[] = [
    {
      key: "floor",
      title: "Floor",
      detail: "Terrain and obstacles, with margin",
      value: `${altFt(s.floor_ft)} ft`,
      body: (
        <>
          {/* 14 CFR 91.119(b) and (c), as the planner keeps them (vfr.terrain): towns are the Census Bureau's urban
              areas and places (vfr.congested). */}
          The ground along the course and every charted obstacle within 5 nm of it, each plus 1,000 ft over or within
          2,000 ft of a town (14 CFR 91.119(b)) and 500 ft elsewhere (91.119(c)), the highest of those rounded up to the
          next 100 ft. Worked out leg by leg as well, so a leg over lower ground may fly lower.
        </>
      ),
    },
    {
      key: "ceiling",
      title: "Ceiling",
      detail: (
        <>
          {ceilingReason(s)}
          {cloudsLeaveNone && (
            <span className="block text-destructive">
              Under the clouds near {s.cloud_station}, no VFR altitude on {s.segments.some(seg => seg.cloud_clearance_kept) ? "some legs" : "the route"}
            </span>
          )}
        </>
      ),
      value: ceilingValue,
      body: (
        <>
          The lowest of {join(ceilingParts)}.
          {runsText && ` Leg by leg: ${runsText}. A shelf or a cloud caps only the legs under it.`}
          {cloudsLeaveNone && (
            <span className="text-destructive">
              {" "}No altitude keeps {(s.cloud_ceiling_ft ?? 0) >= 10000 ? "1,000" : "500"} ft below the clouds forecast at {altFt(s.cloud_base_ft!)} ft near {s.cloud_station} on
              {" "}{s.segments.some(seg => seg.cloud_clearance_kept) ? "some legs" : "the route"}: VFR is not possible there as
              forecast, and the altitudes there leave the clouds out.
            </span>
          )}
        </>
      ),
    },
    {
      key: "rule",
      title: `${s.eastbound ? "Eastbound: odd" : "Westbound: even"} thousands plus 500 ft (14 CFR 91.159)`,
      body: (
        <>
          {`A magnetic course of ${ruleCourse(s.course_magnetic_deg)} is `}
          {s.eastbound ? EASTBOUND : WESTBOUND}
          {s.hemispheric_rule_from_ft != null && s.hemispheric_rule_from_ft >= s.floor_ft
            ? `. The rule applies above ${altFt(s.hemispheric_rule_from_ft)} ft, 3,000 ft over the lowest ground; below that every 500 ft is legal too. `
            : ". "}
          {s.candidates_ft.length > 0
            ? `Legal for the whole route: ${s.candidates_ft.map(a => altFt(a)).join(", ")} ft`
            : "No one altitude is legal for the whole route"}
          {otherHalf.length > 0 &&
            `. ${otherHalf.length === 1 ? "One leg flies" : `${otherHalf.length} legs fly`} a magnetic course in the other half (${
              otherHalf.map(seg => `${ruleCourse(seg.course_magnetic_deg ?? 0)} from ${seg.from_nm} nm`).join(", ")
            }) and ${otherHalf.length === 1 ? "is" : "are"} rounded to its altitudes`}
          {Number.isFinite(highestLegal) && highestLegal > (s.candidates_ft[s.candidates_ft.length - 1] ?? -Infinity)
            ? `; leg by leg, up to ${altFt(highestLegal)} ft.`
            : "."}
        </>
      ),
    },
  ];
  // The plans, how the four were made: the plan flown first in the Brief,
  // with its time and fuel; after the rule where they are the buttons
  // over the steps (`plansAbove`).
  const plans: Step = nav.options.length > 0 ? {
    key: "plans",
    ...(plansAbove ? {
      title: `Four plans${nav.flown === "custom" ? `: flying ${altFt(nav.altitude_ft)} ft, your own` : nav.flown === null
        ? ": none flown, the winds aloft could not be read" : chosen ? `: flying the ${PLAN_NAME[chosen.kind].toLowerCase()}` : ""}`,
    } : {
      title: nav.flown === "custom" ? "Your own" : chosen ? `${PLAN_NAME[chosen.kind]} plan` : "No plan",
      detail: nav.flown === "custom" ? `${flightLevel(nav.altitude_ft)} all the way` : chosen ? describeSteps(chosen) : "The winds aloft could not be read",
      value: chosen ? `${describeTime(chosen)} · ${describeFuel(chosen)}` : undefined,
    }),
    body: (
      <>
        Lowest and highest keep to the bottom and the top of the legal altitudes; fastest takes the winds aloft for
        the least time, and economical for the least fuel, every climb counted.{" "}
        {nav.options.map(o => (
          `${PLAN_NAME[o.kind]}: ${describeSteps(o)}, ${describeTime(o)}, ${describeFuel(o)}`
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
    title: "No plan",
    detail: "The winds aloft could not be read",
    body: <>No plan can be made or flown without them. Try again shortly.</>,
  };
  const steps: Step[] = [
    ...(plansAbove ? [] : [plans]),
    ...(ifr ? ifrSteps : vfrSteps),
    ...(plansAbove ? [plans] : []),
    ...(cruiseInItsAir.length > 0 ? [{
      key: "performance",
      title: "Performance in the day's air",
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
      title: `Checked as well: ${checkedSummary}`,
      body: (
        <>
          {s.weather_unavailable.includes("ceiling_visibility")
            ? `The forecast ceiling and visibility could not be checked${ifr ? ". " : ", so no altitude is kept under the clouds. "}`
            : `Forecast for the flight, its temporary changes included: ceiling ${
              s.min_ceiling_ft === null ? "none" : `${altFt(s.min_ceiling_ft)} ft`}, visibility ${s.min_visibility_sm ?? "—"} sm${
              s.low_ceiling_or_visibility && !ifr ? ", below VFR minimums (1,000 ft, 3 sm) somewhere on the way" : ""
            }. `}
          {hazards.charAt(0).toUpperCase() + hazards.slice(1)}. {freezing}
        </>
      ),
    },
    ...(specialUse.length > 0 ? [{
      key: "special-use",
      title: `Special-use airspace: ${join(specialUse.map(a => a.name))}`,
      body: (
        <>
          {join(specialUse.map(a =>
            `${a.name} (${a.kind}, ${suaAltitudes(a, { midSentence: true })}, ${a.along_track_nm} nm out${
              a.type === "P" ? ", no altitude through it" : a.times_of_use ? `, in use ${midSentence(faaWords(a.times_of_use))}` : ""})`))}.
          {specialUse.some(a => a.type !== "P") &&
            " Check whether each is active with its controlling agency or flight service before you go."}
        </>
      ),
    }] : []),
    ...(s.weather_unavailable.includes("special_use") ? [{
      key: "special-use-unchecked",
      title: "Special-use airspace not checked",
      body: <>Look for prohibited and restricted areas and MOAs on the chart yourself.</>,
    }] : []),
    ...(s.airspace_transits.length > 0 ? [{
      key: "transits",
      // Class B takes a clearance, not a call (14 CFR 91.131(a)(1)): it was
      // headed "A radio call on the way" with the rest.
      title: `${s.airspace_transits.some(t => t.class === "B") ? "A clearance on the way" : "A radio call on the way"}: ${
        join(s.airspace_transits.map(t => t.name))}`,
      body: (
        <>
          Not a ceiling: {join(s.airspace_transits.map(t =>
            `${t.name} (Class ${t.class}, ${t.floor_ft_msl ? `floor ${altFt(t.floor_ft_msl)} ft` : "from the surface"}, ${t.along_track_nm} nm out, ${t.requires})`))}.
          {s.airspace_transits.some(t => t.class === "B") && (
            <>
              {" "}Class B also takes a transponder with altitude reporting and ADS-B Out (14 CFR 91.131(d)), and a private
              pilot certificate, or a student, sport or recreational pilot's endorsement for it (91.131(b)).
            </>
          )}
        </>
      ),
    }] : []),
  ];

  return (
    // A list's box (ListGroup's), a row a step at a row's sizes (ListRow's):
    // its name in the text's colour, its reason and its figure in grey, the
    // whole row the fold's tap, 44 at the least.
    <Accordion
      type="multiple" value={printing ? steps.map(step => step.key) : open} onValueChange={setOpen}
      className="rounded-lg border border-border bg-card" data-testid="altitude-steps"
    >
      {steps.map(step => (
        <AccordionItem key={step.key} value={step.key}>
          <AccordionTrigger className="min-h-11 items-center gap-2.5 rounded-none px-3 py-2 font-normal hover:bg-muted/50 hover:no-underline">
            <span className="min-w-0 flex-1">
              <span className={cn("block", TEXT.row)}>{step.title}</span>
              {step.detail && <span className={cn("mt-0.5 block text-muted-foreground", TEXT.detail)}>{step.detail}</span>}
            </span>
            {step.value && <span className={cn("shrink-0 text-right text-muted-foreground tabular-nums", TEXT.row)}>{step.value}</span>}
          </AccordionTrigger>
          <AccordionContent className={cn("px-3 pb-3", TEXT.prose)}>{step.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
