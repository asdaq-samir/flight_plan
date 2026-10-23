import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Check, CloudOff, GraduationCap, Loader2, OctagonAlert, Save, TriangleAlert } from "lucide-react";
import { DropdownMenuItem } from "../../../../components/ui/dropdown-menu";
import { ResponsivePopoverContent } from "../../../../components/ResponsivePopover";
import { ReviewAskForm, type ReviewAsk } from "../../../pilot/ReviewAsk";
import { localDay } from "../../../../lib/clock";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { GROUP_HEADING, TEXT } from "../../../../lib/text";
import { api } from "../../../../lib/api/client";
import { aircraftListQuery, currencyQuery, pilotQuery, trainingQuery } from "../../../../lib/queryClient";
import AltitudeReasoning from "../AltitudeReasoning";
import type {
  Briefing, Candidate, Course, Leg, NavLogAltitude, SaveFlightRequest, Totals,
} from "../../../../lib/api/types";
import type { FrameworkNarrative } from "../../hooks/useNarratives";
import type { BriefingState } from "../../hooks/usePlan";
import { altFt, ceilingAndVisibility, clockTime, PLAN_NAME, reportedWind, windAloft } from "../../format";
import { flightLevel, grouped } from "../../../../lib/units";
import { identOf, isAirwayToken, withoutAltitude } from "../../../../lib/identSchema";
import { navLogRows, savedCheckpoints } from "../navlog/rows";
import { useLoad } from "../../hooks/useLoad";
import { TakeoffLandingSection, WeightBalanceSection } from "./PreflightSections";
import { underMinimums } from "../../../../lib/minimums";
import { usePreferences } from "../../../../lib/preferences";
import { faaWords, gairmetAltitudes, gairmetTitle, sigmetHazard, suaAltitudes, tfrAltitudes, tfrTimes } from "../../../../lib/advisories";
import { passLine, passTime, suaWhen, tfrWhen, type SuaWhen, type TfrWhen } from "../../../../lib/passTimes";
import { pickedEnd, runwayFlown, runwayNumber } from "../../../../lib/pattern";
import { useRunwayPicks } from "../../../../lib/useRunwayPicks";
import { runwayChecks } from "../../../../lib/runwayCheck";
import { FINDING_TONE, worstOf, type Finding } from "../../../../lib/status";
import { useVerdict, verdictItems, type VerdictItem } from "../../../../lib/verdict";
import { callSign, fieldPhases } from "../../../../lib/radio";
import { useGlance, type BriefGlance, type FieldGlance } from "../../../../lib/glance";
import { shortName } from "../../../../lib/aircraftChoice";
import AirportSections from "./AirportSections";
import BriefChecks from "./BriefChecks";
import { Accordion } from "../../../../components/ui/accordion";
import { SectionsOpen } from "../../../../components/sectionLayout";
import { usePrinting } from "../../../../lib/usePrinting";
import PassengerBriefing from "./PassengerBriefing";
import { passengerMessage } from "../../../../lib/passengers";
import WeatherAlongRoute from "./WeatherAlongRoute";
import { fieldCategory } from "./fieldWeather";
import AlternateSection from "./AlternateSection";
import FuelSection from "./FuelSection";
import FlightPlanSection from "./FlightPlanSection";
import { flightPlanForms, type FiledProcedure } from "../../../../lib/flightPlanForm";
import { alternateFinding, useAlternate } from "../../hooks/useAlternate";
import { icingAtAltitude, icingLine } from "../../../../lib/icing";
import RiskAssessment from "./RiskAssessment";
import FindingIcon from "../../../../components/FindingIcon";
import MockOral from "./MockOral";
import { planFacts } from "../../../../lib/oral";
import { assess, riskLine, useRisk } from "../../../../lib/frat";
import { PLANNING_AID } from "../../../../lib/limits";
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
  /** Every stop as the route has it, flown through or landed at, airways
   *  among them: the flight plan's route. */
  route?: string[];
  /** The departure and the arrival picked at the route's ends, for the
   *  flight plan's route under IFR. */
  procedures?: { departure: FiledProcedure | null; arrival: FiledProcedure | null };
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
  // On paper only, at paper's own 14: no finger, no type scale.
  return (
    <div className="hidden break-inside-avoid-page border-b border-border px-4 py-3 print:block print:break-inside-avoid">
      {langgraph && (
        <>
          <h2 className={GROUP_HEADING}>Narrative</h2>
          <p className="mt-2 text-sm text-muted-foreground">{langgraph}</p>
        </>
      )}
      {crewai && (
        <>
          <h2 className={cn(GROUP_HEADING, langgraph && "mt-3")}>
            Second narrative
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
 * An item of the route's Share menu (PlanWorkspace puts it there, at the
 * pilot's ask, with Print and the rest: beside the chips only the
 * Approaches and Share), its state its glyph and its name: Save,
 * Saving…, Saved; said in a note once saved, the menu having gone. It
 * was a round button beside Share and Print, and before that a line of
 * its own at the head of the sections, with the airplane the flight would be filed
 * in spelled out beside it; that airplane is the header's own picker, a
 * line above.
 */
/** The flights saved, one mutation key for every Save item (SaveFlightButton). */
const SAVE_FLIGHT = ["saveFlight"];

/** A plan as Save compares it: the same plan with its risk assessment
 *  made again is not another (SaveFlightButton). */
const planOf = (r: SaveFlightRequest) => JSON.stringify({ ...r, risk: null });

/** The plan on screen as a flight to save: what Save files, and what a
 *  solo cross-country's review is asked of (ReviewAskSheet). */
export interface FlightToSave {
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
  /** The address's other picks for the flight (lib/flightLink picksOf):
   *  filed too, so it opens again as it was planned. */
  picks?: string;
}

/** What would be filed, and only once there is a whole plan to file: the
 *  course (the airports' own idents and places, not a route being
 *  switched to), the nav log and its totals. Save used to be offered
 *  mid-stream, or after a stream failed, and filed null totals. */
function useSaveRequest({ course, totals, nav, legs, selected, aircraftId, depart, altitudes = "", picks = "" }: FlightToSave): SaveFlightRequest | null {
  // The briefing's risk assessment (lib/frat), filed with the flight.
  const risk = useRisk(s => s.assessment);
  return useMemo((): SaveFlightRequest | null => {
    if (!course || !nav || !totals) return null;
    return {
      aircraftId,
      // A present position without the moment's altitude (withoutAltitude).
      departureIdent: withoutAltitude(course.departure.ident),
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
      picks: picks || null,
    };
  }, [course, nav, totals, aircraftId, depart, selected, legs, risk, altitudes, picks]);
}

export function SaveFlightButton(flight: FlightToSave) {
  const queryClient = useQueryClient();
  // The one ["pilot"] query the console and the header share: signed out
  // after a Log out, back after a failed check is retried. A private
  // one-shot lookup here used to hide the section for the session after
  // one failed check, and keep offering Save after a Log out.
  const { data: pilot } = useQuery(pilotQuery);
  const request = useSaveRequest(flight);

  // Kept by the query client, not the item: the menu's content goes when
  // the menu closes, and with a mutation of the item's own the menu
  // opened again offered Save for a plan just saved -- a second click
  // filed it twice.
  const save = useMutation({
    mutationKey: SAVE_FLIGHT,
    mutationFn: api.flights.save,
    // The pilot console's list of flights, which it keeps; said in a
    // note, the menu it was saved from having gone.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
      toast.success("Flight saved");
    },
  });
  // "Saved" belongs to the plan that was saved: another route, time,
  // airplane or altitude is a new request, and Save is offered again.
  // It used to stay "Saved" for the session, and a click filed a
  // duplicate of whatever was on screen by then. The same plan with its
  // risk assessment made again is not another: the briefing is asked for
  // again with the flight's time en route once the nav log has it, a
  // second or two after Save is offered, and "Saved" went back to Save.
  const plan = useMemo(() => request && planOf(request), [request]);
  const filedPlans = useMutationState({
    filters: { mutationKey: SAVE_FLIGHT, status: "success" },
    select: m => planOf(m.state.variables as SaveFlightRequest),
  });
  const saving = useIsMutating({ mutationKey: SAVE_FLIGHT }) > 0;
  const saved = !!plan && filedPlans.includes(plan);

  if (!pilot) return null;

  return (
    <DropdownMenuItem onSelect={() => request && save.mutate(request)} disabled={!request || saving || saved} data-testid="save-flight-button">
      {saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : <Save />}
      {saving ? "Saving…" : saved ? "Saved" : "Save this flight"}
    </DropdownMenuItem>
  );
}

/**
 * "Ask for a solo cross-country review", an item of the route's Share
 * menu beside Save: for a student whose instructor has taken them on
 * (CheckridePage), once there is a whole plan to file. It opens the sheet
 * (ReviewAskSheet) the menu's own state keeps, the menu having gone.
 */
export function ReviewAskItem({ flight, onAsk }: { flight: FlightToSave; onAsk: () => void }) {
  const { data: pilot } = useQuery(pilotQuery);
  const { data: training } = useQuery({ ...trainingQuery, enabled: !!pilot });
  const request = useSaveRequest(flight);
  if (!pilot || !training?.instructors.some(l => l.accepted)) return null;
  return (
    <DropdownMenuItem disabled={!request} onSelect={onAsk} data-testid="ask-review">
      <GraduationCap />Ask for a solo cross-country review
    </DropdownMenuItem>
  );
}

/**
 * The review asked from the route itself: the plan on screen saved as a
 * flight -- with Save's own mutation, so Save says Saved after -- and put
 * to the instructor chosen, as a saved flight's page puts one
 * (ReviewAskForm), for 14 CFR 61.93(c)(3)'s review of its planning.
 */
export function ReviewAskSheet({ flight, onDone }: { flight: FlightToSave; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { data: training } = useQuery(trainingQuery);
  const request = useSaveRequest(flight);
  const save = useMutation({ mutationKey: SAVE_FLIGHT, mutationFn: api.flights.save });
  // The flights saved this session, by their plan: one already saved is
  // asked about as it is, not filed again.
  const filed = useMutationState({
    filters: { mutationKey: SAVE_FLIGHT, status: "success" },
    select: m => ({ plan: planOf(m.state.variables as SaveFlightRequest), id: (m.state.data as { id: number }).id }),
  });
  const ask = useMutation({
    mutationFn: async (a: ReviewAsk) => {
      const plan = planOf(request!);
      const flightId = filed.find(f => f.plan === plan)?.id ?? (await save.mutateAsync(request!)).id;
      return api.training.askReview({ flightId, ...a });
    },
    onSuccess: next => {
      queryClient.setQueryData(["training"], next);
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
      toast.success("Asked for a review");
      onDone();
    },
  });
  const theirs = training?.instructors.filter(l => l.accepted) ?? [];
  return (
    <ResponsivePopoverContent
      title="Solo cross-country review" align="end" className="w-96 max-w-[calc(100vw-2rem)] p-3" data-testid="review-sheet"
      // Opened as the Share menu goes, whose focus goes back to its button
      // as it closes: taken for a move outside, it shut the sheet just
      // opened, now and then. A tap outside or Escape still closes it.
      onFocusOutside={e => e.preventDefault()}
      description="Your instructor reviews its planning and the weather, and endorses it for the airplane and the day (14 CFR 61.93(c)(3), (d))."
    >
      <div className="space-y-3">
        <ReviewAskForm
          instructors={theirs} pending={ask.isPending || !request} onAsk={a => ask.mutate(a)}
          initialDay={localDay(flight.depart ? new Date(flight.depart) : new Date())}
        />
        {ask.error && <p role="alert" className={cn("px-1", FINDING_TONE.stop, TEXT.prose)} data-testid="review-problem">{ask.error.message}</p>}
      </div>
    </ResponsivePopoverContent>
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
const NO_STOPS: string[] = [];

// Drawn again only when its plan changes (memo): every tab is one of
// these, and the page draws again at every row picked in the nav log.
/** Preflight's sections its checks' tiles open (BriefChecks): the
 *  airspace's, the risk's and the loading's. */
const TILE_SECTIONS = ["TFRs & Special Use", "Risk Assessment", "Fuel", "Weight & Balance"];

export default memo(function FlightBriefingView({
  part, publish = false, nav, legs, dep, dest, stops = NO_STOPS, route = NO_STOPS, procedures, course = null, totals = null, depart = "",
  briefing: briefingState,
  langgraphNarrative, crewaiNarrative, narrative, problem = null,
}: Props) {
  // The load's weights, for the takeoff and landing distances.
  const { loading, load, result: loaded } = useLoad(nav?.aircraft, totals?.fuel_gal ?? null);
  // The runways the pilot picked in FPL, flown in the oral's facts and
  // checked for length (runwayFlown).
  const picks = useRunwayPicks();
  // Every airport the flight lands at, each once: a round trip's
  // departure is its destination.
  const landings = [...new Set([dep, ...stops, dest])];
  const stretches = windStretches(legs);
  // "VFR flight not recommended" (AIM 7-1-5) and its reasons are the
  // planner's call (vfr.weather), made against 14 CFR 91.155's minimums
  // in one place; this page states them.
  const briefing = briefingState.state === "ready" ? briefingState.data : null;
  const failed = briefingState.state === "failed" ? briefingState.detail : null;
  // Under IFR "VFR flight not recommended" is no reason not to go: its
  // weather check is the destination's and the alternate's (14 CFR
  // 91.169), not VFR's minimums.
  const ifr = usePreferences(p => p.flightRules) === "ifr";
  const vnrReasons = ifr ? [] : briefing?.vfr_not_recommended ?? [];
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
  // and their times of use read for when the flight passes each, in the
  // area's own time zone.
  const specialUse = (nav?.altitude_selection.special_use ?? []).map(area => {
    const pass = passAt(area.along_track_nm);
    return { area, pass, when: pass ? suaWhen(area.times_of_use, pass, area.time_zone) : "unknown" as SuaWhen };
  });
  // The call sign the radio calls use: the pilot's own airplane's
  // registration where they fly one, and its make from its profile.
  const flying = usePreferences(s => s.aircraft);
  const make = nav?.aircraft.type?.split(" ")[0] || "Airplane";
  const ownCallSign = callSign(make, flying.aircraftId != null ? shortName(flying.label) : null);
  // The risk assessment (lib/frat): the briefing's, the nav log's and the
  // logbook's factors, and what the pilot ticks. Published for the Save
  // button, which files it with the flight.
  const { data: pilot } = useQuery(pilotQuery);
  const { data: currency } = useQuery({ ...currencyQuery, enabled: !!pilot });
  // The pilot's own airplane being flown, for its inspections and, under
  // IFR, its VOR check.
  const flyingId = usePreferences(p => p.aircraft.aircraftId);
  const { data: ownAircraft } = useQuery({ ...aircraftListQuery, enabled: !!pilot && flyingId != null });
  const flownOwn = flyingId == null ? undefined : ownAircraft?.find(a => a.id === flyingId);
  const ticked = useRisk(s => s.ticked);
  const setAssessment = useRisk(s => s.setAssessment);
  const margins = [totals?.fuel_margin_gal, ...(totals?.hops ?? []).map(h => h.totals.fuel_margin_gal)]
    .filter((n): n is number => n != null);
  // Under IFR, in cloud at or above the freezing level (lib/icing).
  const icing = ifr && nav && briefing ? icingAtAltitude(nav.altitude_selection, legs.map(l => l.altitude_ft), briefing.pireps) : null;
  const hazardNames = briefing ? [...briefing.hazards.map(h => sigmetHazard(h.hazard, h.type ?? "SIGMET")), ...briefing.gairmets.map(gairmetTitle)] : [];
  const assessment = briefing ? assess({
    vfrNotRecommended: vnrReasons.length > 0,
    underMinimums: underMine,
    tfrOnRoute: tfrsCrossed.length > 0,
    hazards: unchecked("hazards") && unchecked("gairmets") ? 0 : hazardNames.length,
    night: totals?.night === true,
    fuelMarginGal: margins.length ? Math.min(...margins) : null,
    ifr,
    vorCheck: flownOwn === undefined ? undefined : flownOwn.vorCheck
      ? { goodThrough: flownOwn.vorCheck.goodThrough, withinLimit: flownOwn.vorCheck.withinLimit } : null,
    inspections: flownOwn?.inspections,
    squawks: flownOwn?.openSquawks,
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
      const picked = pickedEnd(picks, i, i === dep ? "takeoff" : "landing", i === dep);
      const inUse = runwayFlown(a.runways, picked);
      return { ident: i, name: a.name, airspaceClass: a.airspace_class, patternFt: a.pattern?.altitude_ft, runway: inUse && (picked || inUse.byWind) ? runwayNumber(inUse.end.ident) : null };
    }),
    aircraft: nav?.aircraft.type ?? nav?.aircraft.name, cruiseFt: nav?.altitude_ft,
    distanceNm: totals?.distance_nm ?? course?.distance_nm, eteMin: totals?.ete_min, fuelGal: totals?.fuel_gal,
    reserveMin: totals?.reserve_min, night: totals?.night,
    depart: depart ? format(new Date(depart), "EEE d MMM, HH:mm") : null,
    metars: landings.flatMap(i => (briefing.metars[i]?.raw ? [{ ident: i, raw: briefing.metars[i]!.raw! }] : [])),
    destinationForecast: destStation ? ceilingAndVisibility(destStation.ceiling_ft, destStation.visibility_sm) : null,
    hazards: hazardNames,
    specialUse: specialUse.map(({ area }) => `${faaWords(area.name)} (${area.kind}), ${suaAltitudes(area)}`),
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
  const checks = runwayChecks(nav?.aircraft, briefing, course, loaded?.takeoff.weightLb ?? null, loaded?.landing.weightLb ?? null, picks);
  const hops = totals?.hops ?? [];
  // Under IFR, the alternate (AlternateSection): its ETA the nav log's.
  const etaIso = totals?.ete_min != null ? new Date(new Date(depart || opened).getTime() + totals.ete_min * 60_000).toISOString() : null;
  const alternateWhere = { dest, eta: ifr ? etaIso : null, tasKt: nav?.aircraft.cruise_tas_kt ?? 110 };
  const alternateCheck = useAlternate(alternateWhere);
  const alternateFound = ifr ? alternateFinding(alternateCheck.data) : null;
  const verdictFound: VerdictItem[] = verdictItems({
    weather: {
      pending: !briefing && !failed, failed,
      vfrNotRecommended: vnrReasons, underMinimums: underMine, icing: icing && icingLine(icing), hazards: hazardNames,
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
      flown: !nav ? null : nav.flown === "custom" ? `${flightLevel(nav.altitude_ft)}, your own` : `${altitudeRange(nav)}${chosen ? ` · ${PLAN_NAME[chosen.kind]} plan` : ""}`,
    },
    fuel: {
      pending: !totals,
      marginGal: margins.length ? Math.min(...margins) : null,
      requiredGal: totals?.fuel_required_gal ?? (hops.length ? Math.max(...hops.map(h => h.totals.fuel_required_gal ?? 0)) : null),
      reserveMin: totals?.reserve_min ?? hops[0]?.totals.reserve_min ?? null,
      ifr,
    },
    runways: {
      pending: !nav || !briefing, worked: !nav || (!!nav.aircraft.takeoff && !!nav.aircraft.landing),
      short: [...new Set(checks.filter(c => c.distances.some(d => d.over)).map(c => c.field.ident))],
      crosswind: [...new Set(checks.filter(c => c.crosswindOver).map(c => c.field.ident))],
    },
    balance: {
      pending: !nav, worked: !!loading && !!loaded,
      problems: loaded?.problems ?? [],
      takeoff: loaded ? `${grouped(loaded.takeoff.weightLb)} lb at ${loaded.takeoff.armIn.toFixed(1)} in` : null,
    },
    risk: assessment ? { level: assessment.level, line: riskLine(assessment) } : null,
  });
  // Published once, for the tabs' marks (PlanWorkspace), as the risk is.
  const setItems = useVerdict(v => v.setItems);
  // The alternate is the weather's to say, where the weather says nothing
  // worse: a caution or a stop of its own, opening its section.
  const items: VerdictItem[] = alternateFound
    ? verdictFound.map(i => (i.key === "weather" && (i.finding === "ok" || (alternateFound.finding === "stop" && i.finding !== "stop"))
      ? { ...i, ...alternateFound, tab: "arrive", section: "Alternate" } : i))
    : verdictFound;
  const itemsKey = items.map(i => `${i.key}:${i.finding}:${i.detail}`).join("|");
  useEffect(() => {
    if (publish) setItems(items);
    // Keyed on what they say, not the array made each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, setItems, publish]);
  useEffect(() => () => { if (publish) setItems([]); }, [setItems, publish]);

  // The Brief's glance (lib/glance): each part of the flight in a few
  // figures, from what the pages say -- the runway checks, the radio's
  // first call, the forecast at each field and along the way -- published
  // by the one instance outside the pages, as the findings are.
  const glance: BriefGlance | null = publish ? (() => {
    const leaving = new Date(depart || opened);
    const fieldAt = (ident: string, kind: "departure" | "arrival", at: Date | null): FieldGlance => {
      const check = checks.find(c => c.field.ident === ident && (kind === "departure" ? c.role === "Departure" : c.role === "Destination"));
      const distance = check?.distances.find(d => d.kind === (kind === "departure" ? "takeoff" : "landing"));
      const metar = briefing?.metars[ident];
      const said = metar ? reportedWind(metar.wind_dir_true_deg ?? null, metar.wind_speed_kt ?? null, metar.wind_gust_kt ?? null) : null;
      const phase = briefing ? fieldPhases(briefing, landings, legs, ownCallSign, ident, picks).find(p => p.kind === kind) : undefined;
      const call = phase?.calls.find(c => c.mhz != null);
      return {
        ident,
        category: briefing && course ? fieldCategory(briefing, course, ident) : null,
        at: at ? at.toISOString() : null,
        runway: check?.end ? runwayNumber(check.end) : null,
        runwayFt: check?.runway?.length_ft ?? null,
        overFiftyFt: distance ? Math.round(distance.totalFt) : null,
        wind: said === "calm" ? "Calm" : said ? `${said.dir.replace(/T$/, "")}/${said.speed}` : null,
        radio: call ? { to: call.to, mhz: call.mhz! } : null,
        finding: !check ? "unknown" : distance?.over ? "stop" : check.crosswindOver ? "caution" : "ok",
      };
    };
    const byKey = (keys: VerdictItem["key"][]) => worstOf(items.filter(i => keys.includes(i.key)).map(i => i.finding));
    const wind = stretches[0]?.wind;
    return {
      before: {
        risk: assessment ? { score: assessment.score, level: assessment.level } : null,
        spareGal: margins.length ? Math.min(...margins) : null,
        balance: loaded ? { within: loaded.problems.length === 0, problem: loaded.problems[0] ?? null } : null,
        finding: byKey(["risk", "fuel", "balance", "airspace"]),
      },
      depart: course ? fieldAt(dep, "departure", leaving) : null,
      enroute: {
        ceilingFt: briefing?.forecast.min_ceiling_ft ?? null,
        visibilitySm: briefing?.forecast.min_visibility_sm ?? null,
        wind: wind ? `${String(wind.dir).padStart(3, "0")}°/${wind.speed}` : null,
        eteMin: totals?.ete_min ?? null,
        line: items.find(i => i.key === "weather")?.detail ?? null,
        finding: byKey(["weather", "altitude"]),
      },
      arrive: course ? fieldAt(dest, "arrival", totals?.ete_min != null ? new Date(leaving.getTime() + totals.ete_min * 60_000) : null) : null,
    };
  })() : null;
  const setGlance = useGlance(g => g.set);
  const glanceKey = glance ? JSON.stringify(glance) : "";
  useEffect(() => {
    if (publish) setGlance(glance);
    // Keyed on what it says, not the object made each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glanceKey, setGlance, publish]);
  useEffect(() => () => { if (publish) setGlance(null); }, [setGlance, publish]);

  // Preflight's sections a tile opens and the paperwork, folded on screen
  // under the checks (BriefChecks), each opened by its tile or a tap on
  // its title; on paper, laid open.
  const printing = usePrinting();
  const [folds, setFolds] = useState<string[]>([]);

  if (part === null) return null;

  // The flight plan's airplane: the pilot's own by its registration and
  // the type designator they gave it, or a stock profile's type; item 9's
  // wake category from the profile's maximum takeoff weight only where
  // the profile is that type's.
  const ownType = flying.aircraftId != null ? flying.label.split(" · ")[1] ?? null : null;
  const profileType = nav?.aircraft.designator ?? null;
  const planType = flying.aircraftId != null ? ownType : profileType;
  const planForms = part === "preflight" ? flightPlanForms({
    rules: ifr ? "ifr" : "vfr", dep, dest, route, landings: stops,
    isAirway: stop => isAirwayToken(stop) && !course?.stops?.some(s => s.ident === stop),
    legs, totals, depart: depart ? new Date(depart) : null, now: new Date(opened),
    aircraft: {
      ident: flying.aircraftId != null ? shortName(flying.label) : null,
      type: planType,
      maxTakeoffLb: planType && planType === profileType ? nav?.aircraft.loading?.max_takeoff_lb ?? null : null,
      // Items 10 and 19's colour, from the pilot's own airplane's page.
      equipment: flownOwn?.equipment ?? null, surveillance: flownOwn?.surveillance ?? null, colour: flownOwn?.colour ?? null,
    },
    // Item 19's pilot in command, from their own page (Pilot details, in Setup).
    pilot: pilot ? { name: pilot.fullName ?? null, phone: pilot.phone ?? null, homeBase: pilot.homeBase ?? null } : null,
    fuelGal: load?.fuelGal ?? null,
    alternate: totals?.alternate?.ident ?? null,
    departureProcedure: procedures?.departure, arrivalProcedure: procedures?.arrival,
  }) : [];

  return (
    // No header, title or scroller of its own: the planning panel's tabs
    // (NavLogView) hold the nav log's own and these, one part to a tab --
    // laid open (SectionsOpen) -- and every part, one after another, for
    // the printer.
    <>
      {briefingState.state === "ready" && briefingState.refreshError && (
        // The last briefing stays up after a refresh that failed -- say
        // so, and how old it is, as the map's airport chips do.
        <p className={cn("border-b py-2 text-caution-ink print:hidden", TEXT.prose)}>
          Could not refresh the briefing ({briefingState.refreshError}); showing the one fetched at{" "}
          {clockTime(new Date(briefingState.fetchedAt))}.
        </p>
      )}

      {/* Preflight: the go / no-go first, then what is done before
          leaving -- the airspace, the risk, the paperwork, the loading. */}
      {part === "preflight" && (
        <>
          {/* The narrative, printed only: on screen it is the tab's own
              section (BriefNarrative), whose framework is a setting. */}
          <BriefingNarrativePrintBlock langgraph={langgraphNarrative.text} crewai={crewaiNarrative.text} />

          <BriefChecks
            items={items} flight={`${landings.join("-")}|${depart}`} here={TILE_SECTIONS}
            onOpen={section => setFolds(open => (open.includes(section) ? open : [...open, section]))}
          />
          {/* What a tile opens, and what is done before leaving -- the
              paperwork, the passengers -- a row each, at the owner's pick
              of the redesign: they were laid open, ten screens of them
              under the Go / No-Go. */}
          <h3 className={cn("mt-2 px-1 print:hidden", GROUP_HEADING)}>Before you go</h3>
          <SectionsOpen.Provider value={printing}>
          <Accordion type="multiple" value={folds} onValueChange={setFolds} data-testid="before-you-go">
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
                    {/* Times of use as the FAA publishes them, LOCAL read as
                        this device's time: whether each is active is flight
                        service's or the controlling agency's to say. */}
                    <ListGroup title="Special-use airspace">
                      {specialUse.map(({ area, pass, when }) => (
                        <ListRow
                          key={area.name}
                          media={<FindingIcon finding={SUA_FINDING[when] === "stop" ? "caution" : SUA_FINDING[when]} />}
                          title={`${faaWords(area.name)} · ${area.kind}`}
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

          {/* The loading, done at home: its envelope and what it changes. */}
          <FuelSection totals={totals} />
          <WeightBalanceSection aircraft={nav?.aircraft} tripFuelGal={totals?.fuel_gal ?? null} />

          {/* The FAA's flight plan form filled in from the plan, from an
              airport: a present position is a flight already flying. */}
          {identOf(dep) && totals && (
            <FlightPlanSection forms={planForms} ifr={ifr} />
          )}

          {/* The passengers' briefing (91.107), and the flight to send them. */}
          <PassengerBriefing
            flight={`${landings.join("-")}|${depart}`}
            message={passengerMessage({
              dep, dest, destName: briefing?.airports[dest]?.name ?? null,
              depart: depart ? new Date(depart) : null, eteMin: totals?.ete_min ?? null,
              weather: briefing?.metars[dest] ? [briefing.metars[dest]!.flight_category,
                ceilingAndVisibility(briefing.metars[dest]!.ceiling_ft ?? null, briefing.metars[dest]!.visibility_sm ?? null)]
                .filter(Boolean).join(", ") : null,
            })}
          />

          {/* The mock oral, the developer's until a CFI has reviewed its
              answers; never on paper. */}
          {pilot?.developer && briefing && (
            <div className="print:hidden">
              <AccordionSection title="Mock Oral">
                <MockOral plan={planText} />
              </AccordionSection>
            </div>
          )}
          </Accordion>
          </SectionsOpen.Provider>
        </>
      )}

      {/* Depart: only what leaving needs, in the order it is used -- the
          field's weather, the takeoff, then the field: its radio, its
          runways and its pattern. */}
      {part === "depart" && (
        <>
          {briefing && course ? (
            <WeatherAlongRoute briefing={briefing} course={course} legs={legs} departIso={depart || opened} unchecked={unchecked} phase="depart" />
          ) : (
            <AccordionSection title="Weather"><Pending>{briefingPendingMessage}</Pending></AccordionSection>
          )}
          <TakeoffLandingSection
            aircraft={nav?.aircraft} briefing={briefing} course={course} phase="depart"
            takeoff={loaded?.takeoff.weightLb ?? null} landing={loaded?.landing.weightLb ?? null}
          />
          {briefing ? <AirportSections briefing={briefing} landings={landings} legs={legs} callSign={ownCallSign} phase="depart" />
            : <AccordionSection title="Airport"><Pending>{briefingPendingMessage}</Pending></AccordionSection>}
        </>
      )}

      {/* En route's first: the altitude the side view shows. */}
      {part === "profile" && (
        // The plan flown, with its time and fuel, then the floor and the
        // ceiling it was chosen within, each with its reason, and the rest
        // of how the planner got there -- a row a step, its working folded
        // under it, the steps the FL chip's popover shows (AltitudeReasoning).
        // From `nav.altitude_selection`, which arrives with the nav log.
        <AccordionSection title="Cruise Altitude">
          {!nav ? <Pending>Waiting on the nav log&apos;s altitude…</Pending> : <AltitudeReasoning nav={nav} legs={legs} />}
        </AccordionSection>
      )}

      {/* En route, under the legs and the side view: the weather on the way
          -- adverse conditions first (AIM 7-1-5), then stretch by stretch,
          then the winds -- and any stops. */}
      {part === "enroute" && (
        <>
          <AccordionSection
            title="Adverse Conditions"
            // On the title, seen before anything under it: VFR not
            // recommended, or short of that, under the pilot's own minimums.
            aside={vnrReasons.length > 0 ? <Flag finding="stop" testId="vnr-flag">VFR not recommended</Flag>
              : underMine.length > 0 ? <Flag finding="stop" testId="minimums-flag">Under your minimums</Flag>
                : icing ? <Flag finding="caution" testId="icing-flag">Icing possible</Flag>
                : hazardNames.length > 0 ? <Flag finding="caution" testId="hazards-flag">{hazardNames.length === 1 ? "A hazard" : `${hazardNames.length} hazards`}</Flag> : undefined}
          >
            {/* Its own standard element (AIM 7-1-5(b)), stated first, the
                way a live briefer states it before the detail that
                justifies it. Red on pale red at 7:1, in both themes. */}
            {vnrReasons.length > 0 && (
              <Alert className={cn("mb-2 border-destructive/30 bg-destructive/10 text-destructive-ink", TEXT.prose)}>
                <OctagonAlert />
                <AlertTitle>VFR flight not recommended</AlertTitle>
                <ul className="col-start-2 list-disc space-y-0.5 pl-4 [&>li]:first-letter:uppercase">
                  {vnrReasons.map(reason => <li key={reason}>{reason}</li>)}
                </ul>
              </Alert>
            )}
            {underMine.length > 0 && (
              <Alert className={cn("mb-2 border-destructive/30 bg-destructive/10 text-destructive-ink", TEXT.prose)} data-testid="minimums-alert">
                <OctagonAlert />
                <AlertTitle>Under your personal minimums</AlertTitle>
                <ul className="col-start-2 list-disc space-y-0.5 pl-4 [&>li]:first-letter:uppercase">
                  {underMine.map(reason => <li key={reason}>{reason}</li>)}
                </ul>
              </Alert>
            )}
            {icing && (
              // Under IFR, in cloud at or above the freezing level.
              <Alert className={cn("mb-2 border-caution/30 bg-caution-wash text-caution-ink", TEXT.prose)} data-testid="icing-alert">
                <TriangleAlert />
                <AlertTitle>Icing possible at {altFt(icing.altitudeFt)} ft</AlertTitle>
                <AlertDescription className={cn("text-caution-ink", TEXT.prose)}>
                  <p>
                    The freezing level is {icing.atOrBelow ? "at or below" : "at"} {altFt(icing.freezingLevelFt)} ft, with cloud
                    or an icing AIRMET forecast along the route{icing.reports
                      ? `, and ${icing.reports} pilot report${icing.reports === 1 ? "" : "s"} of icing near it` : ""}.
                    Most light airplanes&apos; flight manuals prohibit flight into known icing, and the manual&apos;s
                    limitations bind (14 CFR 91.9(a)): plan below the freezing level, or an airplane certified for it.
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {!briefing ? <Pending>{briefingPendingMessage}</Pending>
              : unchecked("hazards") && unchecked("gairmets") ? (
                <p className="text-caution-ink">
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
              <p className={cn("pt-2 text-caution-ink", TEXT.detail)}>
                {unchecked("hazards") ? "SIGMETs" : "G-AIRMETs"} could not be checked — verify separately before flight.
              </p>
            )}
          </AccordionSection>

          {briefing && course ? (
            <WeatherAlongRoute briefing={briefing} course={course} legs={legs} departIso={depart || opened} unchecked={unchecked} phase="enroute" />
          ) : (
            <AccordionSection title="Along the Route"><Pending>{briefingPendingMessage}</Pending></AccordionSection>
          )}

          {/* The route's winds and temperatures by stretch: consecutive legs
              that fly in the same forecast at the same altitude, one row
              each. The temperature is what the legs' true airspeeds are
              worked out from. */}
          <AccordionSection title="Winds Aloft">
            {!stretches.some(st => st.wind) ? (
              <p>{legs.length ? "No winds-aloft data available for this route." : "Waiting on the nav log's legs…"}</p>
            ) : (
              // The forecast winds and temperatures each stretch of legs is
              // flown in, from the nearest winds-aloft station.
              <ListGroup>
                {stretches.map((st, i) => (
                  <ListRow
                    key={i}
                    title={<span className="line-clamp-1">{st.from} → {st.to}</span>}
                    description={`${altFt(st.altitudeFt)} ft`}
                    value={`${st.wind ? `${windAloft(st.wind.dir, st.wind.speed)} kt` : "no wind data"}${st.oatC === null ? "" : ` · ${st.oatC} °C`}`}
                  />
                ))}
              </ListGroup>
            )}
          </AccordionSection>
        </>
      )}

      {part === "enroute" && stops.length > 0 && (
        <>
          <TakeoffLandingSection
            aircraft={nav?.aircraft} briefing={briefing} course={course} phase="enroute"
            takeoff={loaded?.takeoff.weightLb ?? null} landing={loaded?.landing.weightLb ?? null}
          />
          {briefing ? <AirportSections briefing={briefing} landings={landings} legs={legs} callSign={ownCallSign} phase="enroute" />
            : <AccordionSection title="Airport"><Pending>{briefingPendingMessage}</Pending></AccordionSection>}
        </>
      )}

      {/* Arrive: the destination when the flight gets there -- its
          weather, the landing, the field -- and under IFR the alternate. */}
      {part === "arrive" && (
        <>
          {briefing && course ? (
            <WeatherAlongRoute briefing={briefing} course={course} legs={legs} departIso={depart || opened} unchecked={unchecked} phase="arrive" />
          ) : (
            <AccordionSection title="Weather"><Pending>{briefingPendingMessage}</Pending></AccordionSection>
          )}
          <TakeoffLandingSection
            aircraft={nav?.aircraft} briefing={briefing} course={course} phase="arrive"
            takeoff={loaded?.takeoff.weightLb ?? null} landing={loaded?.landing.weightLb ?? null}
          />
          {briefing ? <AirportSections briefing={briefing} landings={landings} legs={legs} callSign={ownCallSign} phase="arrive" />
            : <AccordionSection title="Airport"><Pending>{briefingPendingMessage}</Pending></AccordionSection>}
          {ifr && <AlternateSection {...alternateWhere} />}
        </>
      )}
    </>
  );
});

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
      <Alert className={cn("border-caution/30 bg-caution-wash text-caution-ink", TEXT.prose)}>
        <CloudOff />
        <AlertTitle>Could not check {gaps.join(", ")}</AlertTitle>
        <AlertDescription className={cn("text-caution-ink", TEXT.prose)}>
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
      {PLANNING_AID}
    </p>
  );
}
