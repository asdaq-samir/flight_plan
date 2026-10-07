import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Check, CloudOff, Loader2, OctagonAlert, Save, TriangleAlert } from "lucide-react";
import IconButton from "../../../../components/IconButton";
import { ROUND_BUTTON } from "../../../../components/mapChrome";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { TEXT } from "../../../../lib/text";
import { api } from "../../../../lib/api/client";
import { pilotQuery } from "../../../../lib/queryClient";
import AltitudeReasoning from "../AltitudeReasoning";
import type {
  Briefing, Candidate, Course, Leg, NavLogAltitude, SaveFlightRequest, Totals,
} from "../../../../lib/api/types";
import type { FrameworkNarrative } from "../../hooks/useNarratives";
import type { BriefingState } from "../../hooks/usePlan";
import { altFt, ceilingAndVisibility, clockTime, deg, describeFuel, describeSteps, describeTime } from "../../format";
import { flightLevel } from "../../../../lib/units";
import { navLogRows, savedCheckpoints } from "../navlog/rows";
import { useLoad } from "../../hooks/useLoad";
import { TakeoffLandingSection, WeightBalanceSection } from "./PreflightSections";
import { underMinimums } from "../../../../lib/minimums";
import { usePreferences } from "../../../../lib/preferences";
import { faaWords, gairmetAltitudes, gairmetTitle, sigmetHazard, suaAltitudes, tfrAltitudes, tfrTimes } from "../../../../lib/advisories";
import { passLine, passTime, suaWhen, tfrWhen, type SuaWhen, type TfrWhen } from "../../../../lib/passTimes";
import { runwayInUse, runwayNumber } from "../../../../lib/pattern";
import { runwayChecks } from "../../../../lib/runwayCheck";
import { FINDING_TONE, type Finding } from "../../../../lib/status";
import { useVerdict, verdictItems, type VerdictItem } from "../../../../lib/verdict";
import { callSign } from "../../../../lib/radio";
import { shortName } from "../../../../lib/aircraftChoice";
import AirportSections from "./AirportSections";
import BriefVerdict from "./BriefVerdict";
import PreflightAction from "./PreflightAction";
import WeatherAlongRoute from "./WeatherAlongRoute";
import RiskAssessment from "./RiskAssessment";
import FindingIcon from "../../../../components/FindingIcon";
import MockOral from "./MockOral";
import { planFacts } from "../../../../lib/oral";
import { assess, riskLine, useRisk } from "../../../../lib/frat";
import type { BriefingPart } from "./sections";

interface Props {
  /** Which of the panel's tabs this is drawn in: its sections only; null,
   *  nothing drawn -- the one kept out of the tabs that `publish`es. */
  part: BriefingPart | null;
  /** Publishes the risk assessment (useRisk) for Save and the Brief tab's
   *  mark. One instance, outside the tabs: each tab's own, hidden and shown
   *  under Activity, cleared it and set it again on every switch, and the
   *  whole panel drew again with each. */
  publish?: boolean;
  nav: NavLogAltitude | null;
  legs: Leg[];
  dep: string;
  dest: string;
  /** The airports landed at on the way, in order. */
  stops?: string[];
  /** The course, for the airports' elevations, and the trip's totals,
   *  for the fuel burned by the landing (Weight & Balance). */
  course?: Course | null;
  totals?: Totals | null;
  /** The departure time picked, ISO; empty for now. For when the flight
   *  passes each TFR and special-use area. */
  depart?: string;
  /** Where the briefing stands (see `usePlan`'s BriefingState). The
   *  page keeps its standard sections visible and says which state
   *  applies, rather than making a failed briefing indistinguishable
   *  from a slow one. */
  briefing: BriefingState;
  /** LangGraph's (nav-log-agent) and CrewAI's (crewai-agent) own
   *  briefing narratives -- read-only here, only for
   *  `BriefingNarrativePrintBlock` below. Generating them is the Brief
   *  tab's (BriefNarrative), not this component's. */
  langgraphNarrative: FrameworkNarrative;
  crewaiNarrative: FrameworkNarrative;
  /** The Brief's narrative (BriefNarrative), under its Go / No-Go. */
  narrative?: ReactNode;
  /** No VFR altitude fits the route, in a line (usePlan's Unflyable). */
  problem?: string | null;
}

/**
 * Whichever narrative(s) a pilot actually generated, print only. On
 * screen each is the Brief tab's (BriefNarrative), whose framework
 * switch is no use on paper, so a printed copy has its own text sitting
 * directly in the page. Prints neither,
 * one, or both, whichever the pilot actually asked for on screen --
 * generating a framework's narrative just to have it for a printout
 * nobody asked for would be a real, billed Claude call spent on
 * nothing.
 */
function BriefingNarrativePrintBlock({ langgraph, crewai }: { langgraph: string | null; crewai: string | null }) {
  if (!langgraph && !crewai) return null;
  return (
    <div className="hidden break-inside-avoid-page border-b border-border px-4 py-3 print:block print:break-inside-avoid">
      {langgraph && (
        <>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">LangGraph Narrative</h2>
          <p className="mt-2 text-sm text-muted-foreground">{langgraph}</p>
        </>
      )}
      {crewai && (
        <>
          <h2 className={cn("text-xs font-semibold uppercase tracking-wide text-muted-foreground", langgraph && "mt-3")}>
            CrewAI Narrative
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{crewai}</p>
        </>
      )}
    </div>
  );
}

/** The altitude range a hazard covers, worded around whichever bound
 *  is actually known -- an advisory with no upper limit reported (or
 *  no lower one) is common, and "—-35,000 ft" reads like a typo. */
function hazardAltitudeRange(lowFt: number | null, highFt: number | null): string | null {
  if (lowFt == null && highFt == null) return null;
  if (lowFt == null) return `up to ${altFt(highFt)} ft`;
  if (highFt == null) return `${altFt(lowFt)} ft and above`;
  return `${altFt(lowFt)}-${altFt(highFt)} ft`;
}

/** What each weather source is called when a pilot is told it could
 *  not be checked. */
const WEATHER_SOURCE_LABEL: Record<Briefing["weather_unavailable"][number], string> = {
  hazards: "SIGMETs",
  forecast: "the TAF forecast",
  metars: "current METARs",
  tfrs: "TFRs",
  pireps: "pilot reports",
  gairmets: "G-AIRMETs",
};

interface Stretch {
  from: string;
  to: string;
  altitudeFt: number;
  wind: { dir: number; speed: number } | null;
  /** The forecast temperature there, whole degrees; null where none was
   *  near (a standard day was flown). */
  oatC: number | null;
}

/** Consecutive legs flown in the same wind and temperature at the same
 *  altitude, as one stretch of the route: many legs share their nearest
 *  winds-aloft station, and so report the same forecast. From the nav
 *  log's own per-leg winds and temperatures -- a summary of what it
 *  already fetched, not a second call. */
function windStretches(legs: Leg[]): Stretch[] {
  const stretches: Stretch[] = [];
  for (const leg of legs) {
    const wind = leg.wind ? { dir: Math.round(leg.wind.wind_dir_true_deg), speed: Math.round(leg.wind.wind_speed_kt) } : null;
    const oatC = leg.oat_c == null ? null : Math.round(leg.oat_c);
    const last = stretches[stretches.length - 1];
    const same = last && last.altitudeFt === leg.altitude_ft && last.oatC === oatC
      && (last.wind === null ? wind === null : wind !== null && last.wind.dir === wind.dir && last.wind.speed === wind.speed);
    if (same) last.to = leg.to;
    else stretches.push({ from: leg.from, to: leg.to, altitudeFt: leg.altitude_ft, wind, oatC });
  }
  return stretches;
}

const PLAN_LABEL: Record<string, string> = { lowest: "Lowest", highest: "Highest", fastest: "Fastest", economical: "Economical" };

/** What sets the whole route's ceiling: the clouds (14 CFR 91.155's
 *  distance under the lowest one forecast near a leg), a Class B shelf,
 *  or the airplane. */
function ceilingReason(s: NavLogAltitude["altitude_selection"]): string {
  if (s.cloud_ceiling_ft != null && s.cloud_ceiling_ft === s.band_ceiling_ft) return `Under the clouds near ${s.cloud_station}`;
  if (s.airspace_ceiling_ft != null && s.airspace_ceiling_ft === s.band_ceiling_ft) return "The Class B shelf";
  return "The airplane's service ceiling";
}

/** The altitudes a plan flies as the nav log's header gives them: one
 *  figure, or its lowest and highest. */
function altitudeRange(nav: NavLogAltitude): string {
  const chosen = nav.options.find(o => o.kind === nav.flown);
  const alts = chosen ? chosen.steps.map(s => s.altitude_ft) : nav.altitude_ft != null ? [nav.altitude_ft] : [];
  if (alts.length === 0) return "No altitude";
  const low = Math.min(...alts), high = Math.max(...alts);
  return low === high ? `${altFt(low)} ft` : `${altFt(low)}–${altFt(high)} ft`;
}

/**
 * "Save this flight" -- files the nav log Spring Boot already has a
 * schema for (`flights`/`flight_checkpoints`) but, until this, no
 * caller ever populated. Not a print-page concern; this reads/writes
 * `/api/aircraft` and `/api/flights` directly (same Spring Boot
 * origin, same pattern the account panels use), independent
 * of planning-service entirely. Hidden while signed out rather than
 * shown disabled -- there is nothing a signed-out pilot could do
 * about it from here, and a disabled button with no explanation reads
 * as broken rather than as "sign in first."
 *
 * A round button at the end of the panel's row, beside Share and Print
 * (PlanWorkspace puts it there), its state its glyph and its name: Save,
 * Saving…, Saved. It was a line of its own at the head of the
 * sections, with the airplane the flight would be filed in spelled
 * out beside it; that airplane is the header's own picker, a line
 * above.
 */
export function SaveFlightButton({
  course, totals, nav, legs, selected, aircraftId, depart, altitudes = "",
}: {
  course: Course | null;
  totals: Totals | null;
  nav: NavLogAltitude | null;
  legs: Leg[];
  selected: Candidate[];
  /** The airplane the nav log was computed for: a pilot's own, or
   *  null for a stock profile. */
  aircraftId: number | null;
  /** The departure time as an ISO instant, or "" -- what the saved
   *  flight is planned for. */
  depart: string;
  /** The altitudes the pilot set at points of the route, as the URL's
   *  `altitudes` writes them ("VPBNG:4500"), or "": filed with the
   *  flight, so opened again it is planned at them. */
  altitudes?: string;
}) {
  const queryClient = useQueryClient();
  // The one ["pilot"] query the console and the header share: signed out
  // after a Log out, back after a failed check is retried. A private
  // one-shot lookup here used to hide the section for the session after
  // one failed check, and keep offering Save after a Log out.
  const { data: pilot } = useQuery(pilotQuery);
  // The briefing's risk assessment (lib/frat), filed with the flight.
  const risk = useRisk(s => s.assessment);

  // What would be filed, and only once there is a whole plan to file:
  // the course (the airports' own idents and places, not a route being
  // switched to), the nav log and its totals. Save used to be offered
  // mid-stream, or after a stream failed, and filed null totals.
  const request = useMemo((): SaveFlightRequest | null => {
    if (!course || !nav || !totals) return null;
    return {
      aircraftId,
      departureIdent: course.departure.ident,
      destinationIdent: course.destination.ident,
      stops: (course.stops ?? []).map(stop => stop.ident),
      cruiseAltitudeFt: nav.altitude_ft,
      totalDistanceNm: totals.distance_nm,
      totalEteMin: totals.ete_min,
      totalFuelGal: totals.fuel_gal,
      plannedFor: depart || null,
      // The nav log's own rows (navLogRows), as the checkpoints Spring files.
      checkpoints: savedCheckpoints(navLogRows(course, selected, legs), course.distance_nm),
      risk: risk ? { score: risk.score, level: risk.level, factors: risk.factors.map(f => f.label) } : null,
      altitudes: altitudes || null,
    };
  }, [course, nav, totals, aircraftId, depart, selected, legs, risk, altitudes]);

  const save = useMutation({
    mutationFn: api.flights.save,
    // The pilot console's list of flights, which it keeps.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["flights"] }),
  });
  // "Saved" belongs to the plan that was saved: another route, time,
  // airplane or altitude is a new request, and Save is offered again.
  // It used to stay "Saved" for the session, and a click filed a
  // duplicate of whatever was on screen by then.
  const saved = save.isSuccess && save.variables === request;

  if (!pilot) return null;

  // A round button of glass, as Share and Print beside it and the route's
  // close are: its state its glyph and its name -- Save, Saving…, Saved.
  return (
    <IconButton
      label={save.isPending ? "Saving…" : saved ? "Saved" : "Save this flight"}
      variant="secondary" className={`size-9 ${ROUND_BUTTON}`}
      onClick={() => request && save.mutate(request)}
      disabled={!request || save.isPending || saved}
      data-testid="save-flight-button"
    >
      {save.isPending ? <Loader2 className="size-5 animate-spin" /> : saved ? <Check className="size-5" strokeWidth={2} /> : <Save className="size-5" strokeWidth={2} />}
    </IconButton>
  );
}

/** What a special-use area's times of use say for the pass (lib/passTimes). */
const SUA_WORDS: Record<SuaWhen, string> = {
  "active": "scheduled in use then",
  "by-notam": "not scheduled then, but a NOTAM can activate it",
  "not-scheduled": "not scheduled then",
  "unknown": "read its times against yours",
};
const SUA_FINDING: Record<SuaWhen, Finding> = {
  "active": "stop",
  "by-notam": "caution",
  "not-scheduled": "ok",
  "unknown": "caution",
};
const TFR_WORDS: Record<TfrWhen, string> = {
  "in-force": "in force then",
  "before": "before it starts",
  "after": "after it ends",
};

/** When the flight gets to a TFR, and whether it is in force then: red
 *  where it is. */
function PassNote({ when }: { when: { pass: Date; state: TfrWhen } | null }) {
  if (!when) return null;
  return (
    <span className={cn("block", when.state === "in-force" && cn("font-semibold", FINDING_TONE.stop))} data-testid="tfr-pass">
      {`You pass about ${passLine(when.pass)}, ${TFR_WORDS[when.state]}`}
    </span>
  );
}

/** A warning on a section's title, seen before its content: in red for
 *  what stops the flight as planned, amber for what to look at. */
function Flag({ finding, testId, children }: { finding: "stop" | "caution"; testId: string; children: ReactNode }) {
  const Icon = finding === "stop" ? OctagonAlert : TriangleAlert;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold", FINDING_TONE[finding], TEXT.note)} data-testid={testId}>
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

/** A section's line while what it shows is still coming, or failed. */
function Pending({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground" role="status">{children}</p>;
}

/**
 * The planning panel's tabs' briefing, one part to a tab (`part`), each
 * opening with its conclusion and then going place by place or check by
 * check -- the same marks (lib/status) and the same warnings on the
 * sections' titles in every tab:
 *
 * - The Brief: the Go / No-Go over every tab's findings (lib/verdict),
 *   the narrative, the TFRs and special-use airspace the route meets
 *   when it meets them, the risk assessment, and preflight action (14
 *   CFR 91.103) to tick off, with what is not fetched here -- NOTAMs, ATC
 *   delays -- as links to where a pilot gets them.
 * - The Weather: adverse conditions first, as a briefer gives them (AIM
 *   7-1-5) with VFR not recommended and the pilot's own minimums; then
 *   the route place by place, each forecast read for when the flight is
 *   there; then the winds aloft.
 * - The Performance: the runway check at each field, then the weight
 *   and balance that changes it.
 * - The Airports: a section for each field, in the order flown.
 * - Under the Nav Log's profile, its Cruise Altitude.
 *
 * Not a page or a scroller of its own: the panel scrolls each tab, and
 * on paper every part is laid out one after another. A synoptic
 * narrative, the one element of a standard briefing not here, needs a
 * meteorologist's analysis, not a data fetch.
 */
export default function FlightBriefingView({
  part, publish = false, nav, legs, dep, dest, stops = [], course = null, totals = null, depart = "",
  briefing: briefingState,
  langgraphNarrative, crewaiNarrative, narrative, problem = null,
}: Props) {
  // The load's weights, for the takeoff and landing distances.
  const { loading, result: loaded } = useLoad(nav?.aircraft, totals?.fuel_gal ?? null);
  // Every airport the flight lands at, each once: a round trip's
  // departure is its destination.
  const landings = [...new Set([dep, ...stops, dest])];
  const stretches = windStretches(legs);
  // "VFR flight not recommended" (AIM 7-1-5) and its reasons are the
  // planner's call (vfr.weather), made against 14 CFR 91.155's minimums
  // in one place; this page states them.
  const briefing = briefingState.state === "ready" ? briefingState.data : null;
  const failed = briefingState.state === "failed" ? briefingState.detail : null;
  const vnrReasons = briefing?.vfr_not_recommended ?? [];
  const briefingPendingMessage =
    briefingState.state === "waiting" ? "The briefing follows once the route's course is drawn."
      : failed ? `Briefing data is unavailable (${failed}).`
        : "Fetching METARs, forecasts, hazards, runways and frequencies…";
  const unchecked = (source: Briefing["weather_unavailable"][number]) => briefing?.weather_unavailable.includes(source) ?? false;

  const chosen = nav?.options.find(o => o.kind === nav.flown);
  // Where the weather is under the pilot's own minimums (lib/minimums).
  const minimums = usePreferences(s => s.minimums);
  const underMine = briefing ? underMinimums(minimums, briefing, landings, dest) : [];
  // When the flight passes a point along the route: from the departure
  // picked, or from now, the time the page was opened, for "Now".
  const [opened] = useState(() => new Date().toISOString());
  const passAt = (alongNm: number) => passTime(legs, depart || opened, alongNm);
  // The TFRs the route goes through while they are in force: in force
  // when the flight gets there (half an hour either way), or at some time
  // during the flight where that time is not known yet.
  const tfrsCrossed = briefing?.tfrs.filter(t => {
    if (!t.crosses) return false;
    const pass = passAt(t.along_track_nm);
    return !pass || tfrWhen(t, pass) === "in-force";
  }) ?? [];
  // The special-use areas the legs cross (vfr.sua, with the altitudes),
  // and their times of use read for when the flight passes each.
  const specialUse = (nav?.altitude_selection.special_use ?? []).map(area => {
    const pass = passAt(area.along_track_nm);
    return { area, pass, when: pass ? suaWhen(area.times_of_use, pass) : "unknown" as SuaWhen };
  });
  // The call sign the radio calls use: the pilot's own airplane's
  // registration where they fly one, and its make from its profile.
  const flying = usePreferences(s => s.aircraft);
  const make = nav?.aircraft.type?.split(" ")[0] || "Aircraft";
  const ownCallSign = callSign(make, flying.aircraftId != null ? shortName(flying.label) : null);
  // The risk assessment (lib/frat): the briefing's, the nav log's and the
  // logbook's factors, and what the pilot ticks. Published for the Save
  // button, which files it with the flight.
  const { data: pilot } = useQuery(pilotQuery);
  const { data: currency } = useQuery({ queryKey: ["currency"], queryFn: api.logbook.currency, enabled: !!pilot, staleTime: 60_000 });
  const ticked = useRisk(s => s.ticked);
  const setAssessment = useRisk(s => s.setAssessment);
  const margins = [totals?.fuel_margin_gal, ...(totals?.hops ?? []).map(h => h.totals.fuel_margin_gal)]
    .filter((n): n is number => n != null);
  const hazardNames = briefing ? [...briefing.hazards.map(h => sigmetHazard(h.hazard, h.type ?? "SIGMET")), ...briefing.gairmets.map(gairmetTitle)] : [];
  const assessment = briefing ? assess({
    vfrNotRecommended: vnrReasons.length > 0,
    underMinimums: underMine,
    tfrOnRoute: tfrsCrossed.length > 0,
    hazards: unchecked("hazards") && unchecked("gairmets") ? 0 : hazardNames.length,
    night: totals?.night === true,
    fuelMarginGal: margins.length ? Math.min(...margins) : null,
    currency: currency ?? null,
    day: format(new Date(depart || opened), "yyyy-MM-dd"),
    ticked,
  }) : null;
  const destStation = briefing?.forecast.stations.find(st => st.icaoId === dest);
  // The flight in plain lines, for the mock oral's examiner (lib/oral):
  // what the briefing already holds.
  const planText = briefing ? planFacts({
    route: landings.filter(i => briefing.airports[i]).map(i => {
      const a = briefing.airports[i]!;
      const inUse = runwayInUse(a.runways);
      return { ident: i, name: a.name, airspaceClass: a.airspace_class, patternFt: a.pattern?.altitude_ft, runway: inUse?.byWind ? runwayNumber(inUse.end.ident) : null };
    }),
    aircraft: nav?.aircraft.type ?? nav?.aircraft.name, cruiseFt: nav?.altitude_ft,
    distanceNm: totals?.distance_nm ?? course?.distance_nm, eteMin: totals?.ete_min, fuelGal: totals?.fuel_gal,
    reserveMin: totals?.reserve_min, night: totals?.night,
    depart: depart ? format(new Date(depart), "EEE d MMM, HH:mm") : null,
    metars: landings.flatMap(i => (briefing.metars[i]?.raw ? [{ ident: i, raw: briefing.metars[i]!.raw! }] : [])),
    destinationForecast: destStation ? ceilingAndVisibility(destStation.ceiling_ft, destStation.visibility_sm) : null,
    hazards: hazardNames,
    specialUse: specialUse.map(({ area }) => `${area.name} (${area.kind}), ${suaAltitudes(area)}`),
    tfrs: briefing.tfrs.length,
  }) : "";
  const assessmentKey = assessment ? `${assessment.level}:${assessment.score}:${assessment.factors.map(f => f.key).join(",")}` : "";
  useEffect(() => {
    if (publish) setAssessment(assessment);
    // Keyed on what it says, not the object made each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentKey, setAssessment, publish]);
  useEffect(() => () => { if (publish) setAssessment(null); }, [setAssessment, publish]);

  // The runway check at each field (lib/runwayCheck), for the
  // Performance tab and the Go / No-Go.
  const checks = runwayChecks(nav?.aircraft, briefing, course, loaded?.takeoff.weightLb ?? null, loaded?.landing.weightLb ?? null);
  const hops = totals?.hops ?? [];
  const items: VerdictItem[] = verdictItems({
    weather: {
      pending: !briefing && !failed, failed,
      vfrNotRecommended: vnrReasons, underMinimums: underMine, hazards: hazardNames,
      unchecked: (briefing?.weather_unavailable ?? []).filter(w => w !== "tfrs").map(w => WEATHER_SOURCE_LABEL[w]),
      worst: briefing && (briefing.forecast.min_ceiling_ft != null || briefing.forecast.min_visibility_sm != null)
        ? ceilingAndVisibility(briefing.forecast.min_ceiling_ft, briefing.forecast.min_visibility_sm) : null,
    },
    airspace: {
      pending: !briefing && !failed, unchecked: !!failed || unchecked("tfrs"),
      inForce: tfrsCrossed.map(t => t.notam_id), near: (briefing?.tfrs.length ?? 0) - tfrsCrossed.length,
      specialUse: specialUse.map(({ area, when }) => ({ name: area.name, when })),
    },
    altitude: {
      pending: !nav, problem,
      cautions: nav?.cautions.flatMap(c => c.reasons) ?? [],
      flown: !nav ? null : nav.flown === "custom" ? `${flightLevel(nav.altitude_ft)}, your own` : `${altitudeRange(nav)}${chosen ? ` · ${PLAN_LABEL[chosen.kind]} plan` : ""}`,
    },
    fuel: {
      pending: !totals,
      marginGal: margins.length ? Math.min(...margins) : null,
      requiredGal: totals?.fuel_required_gal ?? (hops.length ? Math.max(...hops.map(h => h.totals.fuel_required_gal ?? 0)) : null),
      reserveMin: totals?.reserve_min ?? hops[0]?.totals.reserve_min ?? null,
    },
    runways: {
      pending: !nav || !briefing, worked: !nav || (!!nav.aircraft.takeoff && !!nav.aircraft.landing),
      short: [...new Set(checks.filter(c => c.distances.some(d => d.over)).map(c => c.field.ident))],
      crosswind: [...new Set(checks.filter(c => c.crosswindOver).map(c => c.field.ident))],
    },
    balance: {
      pending: !nav, worked: !!loading && !!loaded,
      problems: loaded?.problems ?? [],
      takeoff: loaded ? `${Math.round(loaded.takeoff.weightLb).toLocaleString("en-US")} lb at ${loaded.takeoff.armIn.toFixed(1)} in` : null,
    },
    risk: assessment ? { level: assessment.level, line: riskLine(assessment) } : null,
  });
  // Published once, for the tabs' marks (PlanWorkspace), as the risk is.
  const setItems = useVerdict(v => v.setItems);
  const itemsKey = items.map(i => `${i.key}:${i.finding}:${i.detail}`).join("|");
  useEffect(() => {
    if (publish) setItems(items);
    // Keyed on what they say, not the array made each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, setItems, publish]);
  useEffect(() => () => { if (publish) setItems([]); }, [setItems, publish]);

  if (part === null) return null;

  // Preflight action (14 CFR 91.103): what the planner found for each.
  const finding = (key: VerdictItem["key"]) => {
    const item = items.find(i => i.key === key)!;
    return { finding: item.finding, detail: item.detail };
  };
  const longest = (ident: string) => Math.max(0, ...(briefing?.airports[ident]?.runways ?? []).filter(r => !r.closed).map(r => r.length_ft ?? 0));
  const found: Record<string, { finding?: Finding; detail: string }> = {
    notams: { detail: "Not fetched here: read them at 1800wxbrief.com, below" },
    weather: finding("weather"),
    delays: { detail: "Not fetched here: fly.faa.gov, below" },
    runways: !briefing ? { finding: "pending", detail: "Fetching the runways…" }
      : { finding: "ok", detail: landings.map(i => `${i} ${longest(i) ? `${altFt(longest(i))} ft` : "no length published"}`).join(" · ") },
    alternatives: { detail: "Airports near the route are on the chart; a leg's Divert works one out from there" },
    fuel: finding("fuel"),
    distances: finding("runways"),
  };

  return (
    // No header, title or scroller of its own: the planning panel's tabs
    // (NavLogView) hold the nav log's own and these, one part to a tab --
    // laid open (SectionsOpen) -- and every part, one after another, for
    // the printer.
    <>
      {briefingState.state === "ready" && briefingState.refreshError && (
        // The last briefing stays up after a refresh that failed -- say
        // so, and how old it is, as the map's airport chips do.
        <p className={cn("border-b py-2 text-amber-700 dark:text-amber-400 print:hidden", TEXT.prose)}>
          Could not refresh the briefing ({briefingState.refreshError}); showing the one fetched at{" "}
          {clockTime(new Date(briefingState.fetchedAt))}.
        </p>
      )}

      {part === "brief" && (
        <>
          {/* The narrative, printed only: on screen it is the tab's own
              section (BriefNarrative), whose framework is a setting. */}
          <BriefingNarrativePrintBlock langgraph={langgraphNarrative.text} crewai={crewaiNarrative.text} />

          <BriefVerdict items={items} />
          {narrative}

          {/* The TFRs within five miles of the route during the flight,
              from tfr.faa.gov -- one the route goes through when it is in
              force in red -- and the special-use areas the legs cross,
              with when the flight gets to each against its times of use. */}
          <AccordionSection
            title="TFRs & Special Use"
            aside={tfrsCrossed.length > 0 ? <Flag finding="stop" testId="tfr-flag">TFR on the route</Flag>
              : specialUse.some(s => s.when === "active") ? <Flag finding="caution" testId="sua-flag">Area in use</Flag> : undefined}
          >
            {!briefing ? <Pending>{briefingPendingMessage}</Pending> : (
              <div className="space-y-4">
                <div data-testid="tfrs">
                  <ListGroup title="Temporary flight restrictions">
                    {unchecked("tfrs") ? (
                      <ListRow
                        media={<FindingIcon finding="caution" />}
                        title={<span className={FINDING_TONE.caution}>tfr.faa.gov did not answer — check it before flight</span>} href="https://tfr.faa.gov"
                      />
                    ) : briefing.tfrs.length === 0 ? (
                      <ListRow media={<FindingIcon finding="ok" />} title="None within 5 nm of the route during the flight" />
                    ) : briefing.tfrs.map(t => {
                      const pass = passAt(t.along_track_nm);
                      const inForce = t.crosses && (!pass || tfrWhen(t, pass) === "in-force");
                      return (
                        <ListRow
                          key={t.notam_id}
                          media={<FindingIcon finding={inForce ? "stop" : "caution"} />}
                          title={<span className={cn(inForce && cn("font-semibold", FINDING_TONE.stop))}>{`TFR ${t.notam_id}${t.kind ? ` · ${t.kind}` : ""}`}</span>}
                          description={
                            <>
                              {[tfrAltitudes(t), tfrTimes(t)].filter(Boolean).map(line => <span key={line} className="block">{line}</span>)}
                              <PassNote when={pass && { pass, state: tfrWhen(t, pass) }} />
                              {(t.purpose ?? t.rule) && <span className="block">{faaWords(t.purpose ?? t.rule)}</span>}
                            </>
                          }
                          value={t.crosses ? "On the route" : `${Math.round(t.along_track_nm)} nm along`}
                          href={`https://tfr.faa.gov/tfr3/?page=detail_${t.notam_id.replace("/", "_")}`}
                        />
                      );
                    })}
                  </ListGroup>
                </div>
                {specialUse.length > 0 && (
                  <div data-testid="special-use">
                    <ListGroup
                      title="Special-use airspace"
                      footer="Times of use as the FAA publishes them; LOCAL read as this device's time. Ask flight service or the controlling agency whether each is active."
                    >
                      {specialUse.map(({ area, pass, when }) => (
                        <ListRow
                          key={area.name}
                          media={<FindingIcon finding={SUA_FINDING[when] === "stop" ? "caution" : SUA_FINDING[when]} />}
                          title={`${area.name} · ${area.kind}`}
                          // How far along with the altitudes, not at the row's end:
                          // there it left the FAA's times of use three words a line.
                          description={
                            <>
                              <span className="block">{`${suaAltitudes(area)} · ${Math.round(area.along_track_nm)} nm along`}</span>
                              {area.times_of_use && <span className="block">In use: {faaWords(area.times_of_use)}</span>}
                              {pass && <span className="block" data-testid="sua-pass">{`You pass about ${passLine(pass)}: ${SUA_WORDS[when]}`}</span>}
                            </>
                          }
                          data-testid="special-use-area"
                        />
                      ))}
                    </ListGroup>
                  </div>
                )}
              </div>
            )}
          </AccordionSection>

          {/* What the briefing raised, and what only the pilot can say
              (lib/frat). */}
          <AccordionSection
            title="Risk Assessment"
            aside={assessment && assessment.level !== "low" ? (
              <Flag finding={assessment.level === "high" ? "stop" : "caution"} testId="risk-flag">
                {assessment.level === "high" ? "High risk" : "Risk raised"}
              </Flag>
            ) : undefined}
          >
            {!assessment ? <Pending>{briefingPendingMessage}</Pending> : <RiskAssessment assessment={assessment} />}
          </AccordionSection>

          <PreflightAction flight={`${landings.join("-")}|${depart}`} found={found} />

          {/* The mock oral, the developer's until a CFI has reviewed its
              answers; never on paper. */}
          {pilot?.developer && briefing && (
            <div className="print:hidden">
              <AccordionSection title="Mock Oral">
                <MockOral plan={planText} />
              </AccordionSection>
            </div>
          )}
        </>
      )}

      {/* Under the side view: the altitude it shows, and the figures it was chosen within. */}
      {part === "profile" && (
        // The plan being flown and the figures it was made within, first;
        // then how the planner got there, step by step -- the same steps
        // the FL chip's popover shows, here for the paper (a popover
        // prints nothing) and for a pilot reading top to bottom. From
        // `nav.altitude_selection`, which arrives with the nav log.
        <AccordionSection title="Cruise Altitude">
          {!nav ? <Pending>Waiting on the nav log&apos;s altitude…</Pending> : (
            <div className="space-y-3">
              <ListGroup>
                <ListRow
                  title={nav.flown === "custom" ? "Your own" : chosen ? `${PLAN_LABEL[chosen.kind]} plan` : "No plan"}
                  description={nav.flown === "custom" ? `${flightLevel(nav.altitude_ft)} all the way` : chosen ? describeSteps(chosen) : "The winds aloft could not be read."}
                  value={chosen ? `${describeTime(chosen)} · ${describeFuel(chosen)}` : undefined}
                />
                <ListRow title="Floor" description="Terrain and obstacles, with margin" value={`${altFt(nav.altitude_selection.floor_ft)} ft`} />
                <ListRow
                  title="Ceiling"
                  description={ceilingReason(nav.altitude_selection)}
                  value={nav.altitude_selection.band_ceiling_ft == null ? "none" : `${altFt(nav.altitude_selection.band_ceiling_ft)} ft`}
                />
              </ListGroup>
              <div>
                <h3 className={cn("px-1 pb-1.5 font-semibold tracking-wide text-muted-foreground uppercase", TEXT.note)}>How it was chosen</h3>
                <AltitudeReasoning nav={nav} legs={legs} />
              </div>
            </div>
          )}
        </AccordionSection>
      )}

      {/* Weather: adverse conditions first (AIM 7-1-5), then place by place, then the winds. */}
      {part === "weather" && (
        <>
          <AccordionSection
            title="Adverse Conditions"
            // On the title, seen before anything under it: VFR not
            // recommended, or short of that, under the pilot's own minimums.
            aside={vnrReasons.length > 0 ? <Flag finding="stop" testId="vnr-flag">VFR not recommended</Flag>
              : underMine.length > 0 ? <Flag finding="stop" testId="minimums-flag">Under your minimums</Flag>
                : hazardNames.length > 0 ? <Flag finding="caution" testId="hazards-flag">{hazardNames.length === 1 ? "A hazard" : `${hazardNames.length} hazards`}</Flag> : undefined}
          >
            {/* Its own standard element (AIM 7-1-5(b)), stated first, the
                way a live briefer states it before the detail that
                justifies it. Red on pale red at 7:1, in both themes. */}
            {vnrReasons.length > 0 && (
              <Alert className={cn("mb-2 border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200", TEXT.prose)}>
                <OctagonAlert />
                <AlertTitle>VFR flight not recommended</AlertTitle>
                <ul className="col-start-2 list-disc space-y-0.5 pl-4 [&>li]:first-letter:uppercase">
                  {vnrReasons.map(reason => <li key={reason}>{reason}</li>)}
                </ul>
              </Alert>
            )}
            {underMine.length > 0 && (
              <Alert className={cn("mb-2 border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200", TEXT.prose)} data-testid="minimums-alert">
                <OctagonAlert />
                <AlertTitle>Under your personal minimums</AlertTitle>
                <ul className="col-start-2 list-disc space-y-0.5 pl-4 [&>li]:first-letter:uppercase">
                  {underMine.map(reason => <li key={reason}>{reason}</li>)}
                </ul>
              </Alert>
            )}
            {!briefing ? <Pending>{briefingPendingMessage}</Pending>
              : unchecked("hazards") && unchecked("gairmets") ? (
                <p className="text-amber-700 dark:text-amber-300">
                  SIGMET and G-AIRMET data could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
                </p>
              ) : (
                // A row a SIGMET or G-AIRMET, marked with the warning
                // triangle. The G-AIRMETs replaced the text AIRMETs in 2025:
                // the snapshot nearest the departure, one per hazard.
                <ListGroup>
                  {briefing.hazards.length + briefing.gairmets.length === 0 && (
                    <ListRow media={<FindingIcon finding="ok" />} title="No SIGMETs or G-AIRMETs along the route during the flight" />
                  )}
                  {briefing.hazards.map((h, i) => (
                    <ListRow
                      key={`s${i}`}
                      media={<FindingIcon finding="caution" />}
                      title={`${sigmetHazard(h.hazard, h.type)}${hazardAltitudeRange(h.altitude_low_ft, h.altitude_high_ft)
                        ? ` — ${hazardAltitudeRange(h.altitude_low_ft, h.altitude_high_ft)}` : ""}`}
                      description={h.raw && <span className="font-mono whitespace-pre-wrap">{h.raw}</span>}
                    />
                  ))}
                  {briefing.gairmets.map((g, i) => (
                    <ListRow
                      key={`g${i}`}
                      media={<FindingIcon finding="caution" />}
                      title={gairmetTitle(g)}
                      description={[gairmetAltitudes(g), faaWords(g.due_to), g.valid_at && `G-AIRMET for ${clockTime(new Date(g.valid_at))}`]
                        .filter(Boolean).join(" · ")}
                      data-testid="gairmet"
                    />
                  ))}
                </ListGroup>
              )}
            {briefing && unchecked("hazards") !== unchecked("gairmets") && (
              <p className={cn("pt-2 text-amber-700 dark:text-amber-300", TEXT.detail)}>
                {unchecked("hazards") ? "SIGMETs" : "G-AIRMETs"} could not be checked — verify separately before flight.
              </p>
            )}
          </AccordionSection>

          {briefing && course ? (
            <WeatherAlongRoute briefing={briefing} course={course} legs={legs} departIso={depart || opened} unchecked={unchecked} />
          ) : (
            <AccordionSection title="Along the Route"><Pending>{briefingPendingMessage}</Pending></AccordionSection>
          )}

          {/* The route's winds and temperatures by stretch: consecutive legs
              that fly in the same forecast at the same altitude, one row
              each. The temperature is what the legs' true airspeeds are
              worked out from. */}
          <AccordionSection title="Winds Aloft">
            {!stretches.some(st => st.wind) ? (
              <p className="text-muted-foreground">{legs.length ? "No winds-aloft data available for this route." : "Waiting on the nav log's legs…"}</p>
            ) : (
              <ListGroup footer="The forecast winds and temperatures each stretch of legs is flown in, from the nearest winds-aloft station.">
                {stretches.map((st, i) => (
                  <ListRow
                    key={i}
                    title={<span className="line-clamp-1">{st.from} → {st.to}</span>}
                    description={`${altFt(st.altitudeFt)} ft`}
                    value={`${st.wind ? `${deg(st.wind.dir)} ${st.wind.speed} kt` : "no wind data"}${st.oatC === null ? "" : ` · ${st.oatC} °C`}`}
                  />
                ))}
              </ListGroup>
            )}
          </AccordionSection>
        </>
      )}

      {/* Performance: whether the runways will do, then the loading that changes it. */}
      {part === "performance" && (
        <>
          <TakeoffLandingSection
            aircraft={nav?.aircraft} briefing={briefing} course={course}
            takeoff={loaded?.takeoff.weightLb ?? null} landing={loaded?.landing.weightLb ?? null}
          />
          <WeightBalanceSection aircraft={nav?.aircraft} tripFuelGal={totals?.fuel_gal ?? null} />
        </>
      )}

      {/* Each airport, in the order flown. */}
      {part === "airports" && (
        briefing ? <AirportSections briefing={briefing} landings={landings} legs={legs} callSign={ownCallSign} />
          : <AccordionSection title="Airports"><Pending>{briefingPendingMessage}</Pending></AccordionSection>
      )}
    </>
  );
}

/**
 * Which weather sources the briefing could not check, above every
 * section of the flight planning drawer (NavLogView's `notice`): what
 * the briefing did not see is seen on opening the drawer, and on the
 * printed page. It was a toast, gone in ten seconds and stacked behind
 * the planning-aid reminder. (VFR-not-recommended is stated in Current
 * Conditions, and flagged on its title.)
 */
export function BriefingNotices({ briefing: state }: { briefing: BriefingState }) {
  const briefing = state.state === "ready" ? state.data : null;
  const gaps = briefing?.weather_unavailable.map(source => WEATHER_SOURCE_LABEL[source]) ?? [];
  if (gaps.length === 0) return null;
  return (
    <div className="pt-3" data-testid="briefing-notices">
      <Alert className={cn("border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200", TEXT.prose)}>
        <CloudOff />
        <AlertTitle>Could not check {gaps.join(", ")}</AlertTitle>
        <AlertDescription className={cn("text-amber-900 dark:text-amber-200", TEXT.prose)}>
          aviationweather.gov didn’t respond. Verify separately before flight.
        </AlertDescription>
      </Alert>
    </div>
  );
}

/**
 * The reminder a planning aid owes its pilot, at the foot of the drawer
 * and of the printed page: always there, never in the way. As a toast it
 * covered the nav log's last rows each time the drawer opened, and hid
 * the one warning that mattered behind it.
 */
export function PlanningAidNote() {
  return (
    <p className={cn("py-3 text-muted-foreground", TEXT.note)} data-testid="planning-aid-note">
      <span className="font-semibold">Planning aid only.</span> Before flight, obtain an official briefing and verify current weather, NOTAMs, TFRs, airport status, aircraft performance, and applicable regulations.
    </p>
  );
}
