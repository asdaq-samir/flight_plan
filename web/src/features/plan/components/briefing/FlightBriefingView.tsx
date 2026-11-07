import { memo, type ReactNode } from "react";
import { cn } from "cn";
import { CloudOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import AccordionSection from "../../../../components/AccordionSection";
import { TEXT } from "../../../../lib/text";
import AltitudeReasoning from "../AltitudeReasoning";
import type { Course, Leg, NavLogAltitude, Totals } from "../../../../lib/api/types";
import type { BriefingState } from "../../hooks/usePlan";
import { useFlightBriefing, WEATHER_SOURCE_LABEL } from "../../hooks/useFlightBriefing";
import { clockTime } from "../../format";
import { TakeoffLandingSection } from "./PreflightSections";
import AirportSections from "./AirportSections";
import WeatherAlongRoute from "./WeatherAlongRoute";
import AlternateSection from "./AlternateSection";
import type { FiledProcedure } from "../../../../lib/flightPlanForm";
import { PLANNING_AID } from "../../../../lib/limits";
import type { BriefingPart } from "./sections";
import { Pending } from "./BriefingBits";
import PreflightPart from "./PreflightPart";
import EnroutePart from "./EnroutePart";

// Save and the review asked from the route, at the path the Share menu,
// the flight watch and the routePanel chunk import them from.
export { planOf, ReviewAskItem, ReviewAskSheet, SAVE_FLIGHT, SaveFlightButton, useSaveRequest, type FlightToSave } from "./SaveFlight";

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
  /** The narrative's text, once the pilot has had it written -- read-only
   *  here, only for `BriefingNarrativePrintBlock` (BriefingBits). Writing
   *  it is the Brief tab's (BriefNarrative), not this component's. */
  narrativeText: string | null;
  /** The Brief's narrative (BriefNarrative), under its Go / No-Go. */
  narrative?: ReactNode;
  /** No VFR altitude fits the route, in a line (usePlan's Unflyable). */
  problem?: string | null;
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
 *
 * The view only: what it shows is worked out, and published, by its view
 * model (useFlightBriefing).
 */
const NO_STOPS: string[] = [];

// Drawn again only when its plan changes (memo): every tab is one of
// these, and the page draws again at every row picked in the nav log.
export default memo(function FlightBriefingView(props: Props) {
  const {
    part, nav, legs, dep, dest, stops = NO_STOPS, course = null, totals = null, depart = "",
    briefing: briefingState, narrativeText, narrative,
  } = props;
  const vm = useFlightBriefing(props);
  const { briefing, briefingPendingMessage, unchecked, opened, landings, ownCallSign, loaded, ifr, alternateWhere } = vm;

  if (part === null) return null;

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
        <PreflightPart
          vm={vm} nav={nav} totals={totals} dep={dep} dest={dest} depart={depart}
          narrativeText={narrativeText} narrative={narrative}
        />
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
      {part === "enroute" && <EnroutePart vm={vm} course={course} legs={legs} depart={depart} />}

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
