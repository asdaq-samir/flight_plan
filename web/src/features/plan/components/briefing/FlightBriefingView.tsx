import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Check, CloudOff, Loader2, Save, TriangleAlert } from "lucide-react";
import ToolbarButton from "../../../../components/ToolbarButton";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Badge } from "../../../../components/ui/badge";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { api } from "../../../../lib/api/client";
import { pilotQuery } from "../../../../lib/queryClient";
import AltitudeReasoning from "../AltitudeReasoning";
import type {
  Briefing, Candidate, Course, Leg, NavLogAltitude, SaveFlightRequest, Totals,
} from "../../../../lib/api/types";
import type { FrameworkNarrative } from "../../hooks/useNarratives";
import type { BriefingState } from "../../hooks/usePlan";
import { altFt, clockTime, deg, describeFuel, describeSteps, describeTime } from "../../format";
import { navLogRows, savedCheckpoints } from "../navlog/rows";
import { CATEGORY_RANK, categoryOf, colourOf } from "../../../../lib/map/flightCategory";

interface Props {
  nav: NavLogAltitude | null;
  legs: Leg[];
  dep: string;
  dest: string;
  /** Where the briefing stands (see `usePlan`'s BriefingState). The
   *  page keeps its standard sections visible and says which state
   *  applies, rather than making a failed briefing indistinguishable
   *  from a slow one. */
  briefing: BriefingState;
  /** LangGraph's (nav-log-agent) and CrewAI's (crewai-agent) own
   *  briefing narratives -- read-only here, only for
   *  `BriefingNarrativePrintBlock` below. Generating them is
   *  `NavLogActions`' own job, from the drawer's own header, not this
   *  component's. */
  langgraphNarrative: FrameworkNarrative;
  crewaiNarrative: FrameworkNarrative;
}

/**
 * Whichever narrative(s) a pilot actually generated, print only. On
 * screen each lives in `NavLogActions`' own `Popover` instead (next to
 * the buttons that produce it, in the drawer's header, not a scroll
 * away) -- but a closed Popover renders nothing, so a printed copy
 * needs its own text sitting directly in the page. Prints neither,
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

/** Ceiling and visibility the way a briefer says them. */
function ceilingAndVisibility(ceilingFt: number | null | undefined, visibilitySm: number | null | undefined): string {
  return `${ceilingFt == null ? "no ceiling" : `${altFt(ceilingFt)} ft`} · ${visibilitySm == null ? "—" : `${visibilitySm} sm`}`;
}

/** A flight category as a badge in its own colour. */
function CategoryBadge({ category }: { category: string | null | undefined }) {
  if (!category) return null;
  return <Badge style={{ backgroundColor: colourOf(category), color: "white" }}>{category}</Badge>;
}

/** Frequency types by what a pilot calls them. The FAA's own
 *  description beside each is often the type again ("TWR (TWR)"), and
 *  is shown only when it adds something. */
const FREQUENCY_NAMES: Record<string, string> = {
  TWR: "Tower", GND: "Ground", ATIS: "ATIS", UNIC: "UNICOM", UNICOM: "UNICOM", CTAF: "CTAF",
  APP: "Approach", APCH: "Approach", DEP: "Departure", "A/D": "Approach and departure",
  CLD: "Clearance delivery", CD: "Clearance delivery", AWOS: "AWOS", ASOS: "ASOS", AFIS: "AFIS",
  FSS: "Flight service", MULT: "MULTICOM", MULTICOM: "MULTICOM", RDO: "Radio",
};

function frequencyName(type: string | null | undefined, description: string | null | undefined): { name: string; detail: string | null } {
  const code = (type ?? "").trim().toUpperCase();
  const name = FREQUENCY_NAMES[code] ?? type ?? description ?? "Frequency";
  const detail = description?.trim() ?? "";
  const redundant = !detail || [code, name.toUpperCase()].includes(detail.toUpperCase());
  return { name, detail: redundant ? null : detail };
}

/** The frequency a pilot calls first there: the tower, else the CTAF,
 *  else UNICOM. */
function primaryFrequency(frequencies: { type?: string | null; frequency_mhz?: number | null }[]): string | null {
  for (const code of ["TWR", "CTAF", "UNIC"]) {
    const f = frequencies.find(x => (x.type ?? "").toUpperCase() === code && x.frequency_mhz != null);
    if (f) return `${FREQUENCY_NAMES[code]} ${f.frequency_mhz}`;
  }
  return null;
}

const SURFACE_NAMES: Record<string, string> = {
  ASP: "asphalt", ASPH: "asphalt", CON: "concrete", CONC: "concrete", TURF: "turf", GRS: "grass", GRASS: "grass",
  GRVL: "gravel", GRAVEL: "gravel", DIRT: "dirt", WATER: "water", SNOW: "snow",
};

function surfaceName(surface: string | null | undefined): string | null {
  if (!surface) return null;
  const code = (surface.split(/[-/ ]/)[0] ?? "").toUpperCase();
  return SURFACE_NAMES[code] ?? surface.toLowerCase();
}

const PLAN_LABEL: Record<string, string> = { lowest: "Lowest", highest: "Highest", fastest: "Fastest", economical: "Economical" };

/** What sets the whole route's ceiling: the clouds (14 CFR 91.155's
 *  distance under the lowest one forecast near a leg), a Class B shelf,
 *  or the aeroplane. */
function ceilingReason(s: NavLogAltitude["altitude_selection"]): string {
  if (s.cloud_ceiling_ft != null && s.cloud_ceiling_ft === s.band_ceiling_ft) return `Under the clouds near ${s.cloud_station}`;
  if (s.airspace_ceiling_ft != null && s.airspace_ceiling_ft === s.band_ceiling_ft) return "The Class B shelf";
  return "The aeroplane's service ceiling";
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
 * A toolbar button in the drawer's header, beside the narrative and
 * Print (PlanWorkspace puts it there), its state its word: Save,
 * Saving…, Saved. It was a line of its own at the head of the
 * sections, with the aeroplane the flight would be filed in spelled
 * out beside it; that aeroplane is the header's own picker, a line
 * above.
 */
export function SaveFlightButton({
  course, totals, nav, legs, selected, aircraftId, depart,
}: {
  course: Course | null;
  totals: Totals | null;
  nav: NavLogAltitude | null;
  legs: Leg[];
  selected: Candidate[];
  /** The aeroplane the nav log was computed for: a pilot's own, or
   *  null for a stock profile. */
  aircraftId: number | null;
  /** The departure time as an ISO instant, or "" -- what the saved
   *  flight is planned for. */
  depart: string;
}) {
  const queryClient = useQueryClient();
  // The one ["pilot"] query the console and the header share: signed out
  // after a Log out, back after a failed check is retried. A private
  // one-shot lookup here used to hide the section for the session after
  // one failed check, and keep offering Save after a Log out.
  const { data: pilot } = useQuery(pilotQuery);

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
      cruiseAltitudeFt: nav.altitude_ft,
      totalDistanceNm: totals.distance_nm,
      totalEteMin: totals.ete_min,
      totalFuelGal: totals.fuel_gal,
      plannedFor: depart || null,
      // The nav log's own rows (navLogRows), as the checkpoints Spring files.
      checkpoints: savedCheckpoints(navLogRows(course, selected, legs), course.distance_nm),
    };
  }, [course, nav, totals, aircraftId, depart, selected, legs]);

  const save = useMutation({
    mutationFn: api.flights.save,
    // The pilot console's list of flights, which it keeps.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["flights"] }),
  });
  // "Saved" belongs to the plan that was saved: another route, time,
  // aeroplane or altitude is a new request, and Save is offered again.
  // It used to stay "Saved" for the session, and a click filed a
  // duplicate of whatever was on screen by then.
  const saved = save.isSuccess && save.variables === request;

  if (!pilot) return null;

  const text = save.isPending ? "Saving…" : saved ? "Saved" : "Save";
  return (
    <ToolbarButton
      text={text}
      label={save.isPending || saved ? text : "Save this flight"}
      icon={save.isPending ? <Loader2 className="animate-spin" /> : saved ? <Check /> : <Save />}
      onClick={() => request && save.mutate(request)}
      disabled={!request || save.isPending || saved}
      data-testid="save-flight-button"
    />
  );
}

/**
 * The briefing's sections: the FAA's own standard-briefing sequence
 * (AIM 7-1-5) -- VFR-not-recommended, adverse conditions, current
 * conditions, destination and en route forecast, winds aloft, NOTAMs,
 * ATC delays, airport information -- rendered under the nav log table
 * inside the nav log drawer once it is opened wide (see `NavLogView`'s
 * `children`), and laid out to print cleanly with it. Not a page or a
 * scroller of its own: the drawer scrolls the table and these sections
 * together. One element of that sequence is genuinely absent rather
 * than faked: a synoptic narrative (needs real meteorological
 * analysis, not a data fetch). NOTAMs and ATC delays are both named
 * but not embedded -- the official NOTAM API and ATC flow-control data
 * are both gated to certain commercial/public operators, so each
 * section says so and links out to a real briefing service instead of
 * silently disappearing the way an unnamed gap would.
 */
export default function FlightBriefingView({
  nav, legs, dep, dest,
  briefing: briefingState,
  langgraphNarrative, crewaiNarrative,
}: Props) {
  const stretches = windStretches(legs);
  // "VFR flight not recommended" (AIM 7-1-5) and its reasons are the
  // planner's call (vfr.weather), made against 14 CFR 91.155's minimums
  // in one place; this page states them.
  const briefing = briefingState.state === "ready" ? briefingState.data : null;
  const vnrReasons = briefing?.vfr_not_recommended ?? [];
  const briefingPendingMessage =
    briefingState.state === "waiting" ? "The briefing follows once the route's course is drawn."
      : briefingState.state === "failed" ? `Briefing data is unavailable (${briefingState.detail}).`
        : "Fetching METARs, forecasts, hazards, runways and frequencies…";
  const unchecked = (source: Briefing["weather_unavailable"][number]) => briefing?.weather_unavailable.includes(source) ?? false;

  // Each section in one line, under its title, so the drawer reads
  // without opening all of them: what the briefing found there, or
  // nothing while it is still coming.
  const destStation = briefing?.forecast.stations.find(st => st.icaoId === dest);
  const enRoute = (briefing?.forecast.stations ?? [])
    .filter(st => st.icaoId !== dest)
    .map(st => ({ ...st, category: categoryOf(st.ceiling_ft, st.visibility_sm) }))
    .sort((a, b) =>
      (CATEGORY_RANK[b.category ?? ""] ?? -1) - (CATEGORY_RANK[a.category ?? ""] ?? -1)
      || (a.ceiling_ft ?? Infinity) - (b.ceiling_ft ?? Infinity)
      || (a.visibility_sm ?? Infinity) - (b.visibility_sm ?? Infinity));
  const chosen = nav?.options.find(o => o.kind === nav.flown);
  const destFrequency = briefing ? primaryFrequency(briefing.airports[dest]?.frequencies ?? []) : null;
  const summaries = {
    adverse: !briefing ? undefined
      : unchecked("hazards") ? "Not checked"
        : briefing.hazards.length === 0 ? "None along the route"
          : `${briefing.hazards.length} SIGMET${briefing.hazards.length === 1 ? "" : "s"} or AIRMET${briefing.hazards.length === 1 ? "" : "s"}`,
    current: !briefing ? undefined
      : unchecked("metars") ? "Not checked"
        : [dep, dest].map(ident => `${ident} ${briefing.metars[ident]?.flight_category ?? "no report"}`).join(" · "),
    destination: !briefing ? undefined
      : unchecked("forecast") ? "Not checked"
        : destStation ? `${dest} ${ceilingAndVisibility(destStation.ceiling_ft, destStation.visibility_sm)}` : `No TAF for ${dest}`,
    enRoute: !briefing ? undefined
      : unchecked("forecast") ? "Not checked"
        : `Worst ${ceilingAndVisibility(briefing.forecast.min_ceiling_ft, briefing.forecast.min_visibility_sm)}`,
    cruise: !nav ? undefined
      : nav.flown === "custom" ? `${altFt(nav.altitude_ft)} ft, your own`
        : `${altitudeRange(nav)}${chosen ? ` · ${PLAN_LABEL[chosen.kind]}` : ""}`,
    winds: chosen?.tailwind_kt != null
      ? `${Math.abs(Math.round(chosen.tailwind_kt))} kt ${chosen.tailwind_kt >= 0 ? "tailwind" : "headwind"} on average`
      : stretches.some(st => st.wind) ? `${stretches.filter(st => st.wind).length} stretches of wind` : undefined,
    airports: !briefing ? undefined : destFrequency ? `${dest} ${destFrequency}` : `${dep} · ${dest}`,
  };

  return (
    // No header, title or scroller of its own: the flight planning
    // drawer's header (the aeroplane, the departure time, the
    // narrative and Print) is the briefing's, on screen and on paper
    // alike, and the drawer's accordion holds the nav log's own
    // section and these together (and opens every one for the
    // printer -- see NavLogView).
    <>
      {briefingState.state === "ready" && briefingState.refreshError && (
        // The last briefing stays up after a refresh that failed -- say
        // so, and how old it is, as the map's airport chips do.
        <p className="border-b py-2 text-sm text-amber-700 dark:text-amber-400 print:hidden">
          Could not refresh the briefing ({briefingState.refreshError}); showing the one fetched at{" "}
          {clockTime(new Date(briefingState.fetchedAt))}.
        </p>
      )}

      {/* The narrative, printed only: on screen it is the drawer
          header's popover, which prints nothing. */}
      <BriefingNarrativePrintBlock langgraph={langgraphNarrative.text} crewai={crewaiNarrative.text} />

      <AccordionSection title="Adverse Conditions" summary={summaries.adverse}>
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : unchecked("hazards") ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            SIGMET/AIRMET data could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
          </p>
        ) : briefing.hazards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No SIGMETs or AIRMETs reported along this route.</p>
        ) : (
          <ul className="space-y-2">
            {briefing.hazards.map((h, i) => (
              <li key={i} className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                <div className="font-semibold text-amber-800 dark:text-amber-200">
                  {h.hazard ?? h.type ?? "Hazard"}
                  {hazardAltitudeRange(h.altitude_low_ft, h.altitude_high_ft) &&
                    ` — ${hazardAltitudeRange(h.altitude_low_ft, h.altitude_high_ft)}`}
                </div>
                {h.raw && <div className="mt-0.5 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{h.raw}</div>}
              </li>
            ))}
          </ul>
        )}
      </AccordionSection>

      <AccordionSection
        title="Current Conditions"
        summary={summaries.current}
        // Seen with the section folded: the reasons are inside it, but
        // that VFR is not recommended is on its title, not behind a tap.
        aside={vnrReasons.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400" data-testid="vnr-flag">
            <TriangleAlert className="size-3.5" aria-hidden />
            VFR not recommended
          </span>
        ) : undefined}
      >
        {/* Its own standard element (AIM 7-1-5(b)), stated first inside
            the section it is drawn from -- current METAR categories and
            the route's own forecast minimums -- the way a live briefer
            states it before the detail that justifies it. Red on pale
            red at 7:1, in both themes. */}
        {vnrReasons.length > 0 && (
          <Alert className="mb-2 border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <TriangleAlert />
            <AlertTitle>VFR flight not recommended</AlertTitle>
            <ul className="col-start-2 list-disc space-y-0.5 pl-4 text-sm">
              {vnrReasons.map(reason => <li key={reason}>{reason}</li>)}
            </ul>
          </Alert>
        )}
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : unchecked("metars") ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Current conditions could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {[dep, dest].map(ident => {
              const metar = briefing.metars[ident];
              return (
                <div key={ident} className="rounded border border-border px-2 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{ident}</span>
                    <CategoryBadge category={metar?.flight_category} />
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                    {metar?.raw ?? "No current report available."}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AccordionSection>

      {/* Split into its own two standard elements (AIM 7-1-5(e)/(f))
          rather than one blended list -- a briefer states the
          destination's own forecast as its own line, since it is the
          one that decides go/no-go on arrival. */}
      <AccordionSection title="Destination Forecast" summary={summaries.destination}>
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : unchecked("forecast") ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Forecast data could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
          </p>
        ) : destStation ? (
          <ListGroup footer="The worst forecast period of its TAF.">
            <ListRow title="Ceiling" value={destStation.ceiling_ft == null ? "none" : `${altFt(destStation.ceiling_ft)} ft`} />
            <ListRow title="Visibility" value={destStation.visibility_sm == null ? "—" : `${destStation.visibility_sm} sm`} />
            <ListRow title="Category"><CategoryBadge category={categoryOf(destStation.ceiling_ft, destStation.visibility_sm)} /></ListRow>
          </ListGroup>
        ) : (
          <p className="text-sm text-muted-foreground">No TAF published for {dest}.</p>
        )}
      </AccordionSection>

      {/* Every station with a TAF near the route, the worst first: its
          ceiling and visibility at the end of its row, and the category
          they make as a badge, which is what is read at a glance. It was
          a line of prose per station. */}
      <AccordionSection title="En Route Forecast" summary={summaries.enRoute}>
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : unchecked("forecast") ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Forecast data could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
          </p>
        ) : enRoute.length === 0 ? (
          <p className="text-sm text-muted-foreground">No TAF published near the route.</p>
        ) : (
          <ListGroup footer="The worst forecast period of each TAF near the route, worst first." >
            {enRoute.map(st => (
              <ListRow key={st.icaoId} title={st.icaoId} value={ceilingAndVisibility(st.ceiling_ft, st.visibility_sm)}>
                <CategoryBadge category={st.category} />
              </ListRow>
            ))}
          </ListGroup>
        )}
      </AccordionSection>

      {/* The plan being flown and the figures it was made within, first;
          then how the planner got there, step by step -- the same steps
          the nav log header's "why" popover shows, here for the paper
          (a popover prints nothing) and for a pilot reading the
          briefing top to bottom. From `nav.altitude_selection`, which
          arrives with the nav log, not with the briefing. */}
      <AccordionSection title="Cruise Altitude" summary={summaries.cruise}>
        {!nav ? (
          <p className="text-sm text-muted-foreground">Waiting on the nav log's altitude…</p>
        ) : (
          <div className="space-y-3">
            <ListGroup>
              <ListRow
                title={nav.flown === "custom" ? "Your own" : chosen ? `${PLAN_LABEL[chosen.kind]} plan` : "No plan"}
                description={nav.flown === "custom" ? `${altFt(nav.altitude_ft)} ft all the way` : chosen ? describeSteps(chosen) : "The winds aloft could not be read."}
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
              <h3 className="px-1 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">How it was chosen</h3>
              <AltitudeReasoning nav={nav} legs={legs} />
            </div>
          </div>
        )}
      </AccordionSection>

      {/* The route's winds and temperatures by stretch: consecutive legs
          that fly in the same forecast at the same altitude, one row
          each. It was a list of directions and speeds with no way to
          tell where each blew. The temperature is what the legs' true
          airspeeds are worked out from (the Cruise Altitude section's
          performance step). */}
      <AccordionSection title="Winds Aloft" summary={summaries.winds}>
        {!stretches.some(st => st.wind) ? (
          <p className="text-sm text-muted-foreground">No winds-aloft data available for this route.</p>
        ) : (
          <ListGroup>
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

      {/* The standard elements this app can name but not fetch -- the
          official NOTAM API and ATC flow-control data are gated to
          certain operators -- in one place, each a link to where a pilot
          gets it. They were two sections that could only ever say "Not
          fetched here". */}
      <AccordionSection title="Check before you fly" summary="NOTAMs, TFRs and ATC delays">
        <ListGroup footer="The FAA's NOTAM and flow-control feeds need operator credentials, so these are not fetched here.">
          <ListRow title="NOTAMs" description="1800wxbrief.com" href="https://www.1800wxbrief.com" />
          <ListRow title="NOTAM search" description="notams.aim.faa.gov" href="https://notams.aim.faa.gov/notamSearch/" />
          <ListRow title="Temporary flight restrictions" description="tfr.faa.gov" href="https://tfr.faa.gov" />
          <ListRow title="ATC delays" description="fly.faa.gov" href="https://www.fly.faa.gov" />
        </ListGroup>
      </AccordionSection>

      {/* Each airport's frequencies by what a pilot calls them, and its
          runways, a row each. They were "TWR (TWR): 118.3" lines. */}
      <AccordionSection title="Airport Information" summary={summaries.airports}>
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {[dep, dest].map(ident => {
              const info = briefing.airports[ident];
              return (
                <ListGroup key={ident} title={ident}>
                  {info?.frequencies.length
                    ? info.frequencies.map((f, i) => {
                      const { name, detail } = frequencyName(f.type, f.description);
                      return <ListRow key={`f${i}`} title={name} description={detail ?? undefined} value={f.frequency_mhz ?? "—"} />;
                    })
                    : <ListRow title={<span className="text-muted-foreground">No published frequencies</span>} />}
                  {info?.runways.length
                    ? info.runways.map((r, i) => (
                      <ListRow
                        key={`r${i}`}
                        title={`Runway ${r.ends ?? "—"}`}
                        description={[surfaceName(r.surface), r.lighted && "lighted", r.closed && "closed"].filter(Boolean).join(" · ") || undefined}
                        value={`${r.length_ft != null ? altFt(r.length_ft) : "—"} × ${r.width_ft ?? "—"} ft`}
                      />
                    ))
                    : <ListRow title={<span className="text-muted-foreground">No published runway data</span>} />}
                </ListGroup>
              );
            })}
          </div>
        )}
      </AccordionSection>
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
      <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <CloudOff />
        <AlertTitle>Could not check {gaps.join(", ")}</AlertTitle>
        <AlertDescription className="text-amber-900 dark:text-amber-200">
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
    <p className="py-3 text-xs text-muted-foreground" data-testid="planning-aid-note">
      <span className="font-semibold">Planning aid only.</span> Before flight, obtain an official briefing and verify current weather, NOTAMs, TFRs, airport status, aircraft performance, and applicable regulations.
    </p>
  );
}
