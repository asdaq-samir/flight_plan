import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { toast } from "sonner";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import BriefingSection from "./BriefingSection";
import { api } from "../../../../lib/api/client";
import { pilotQuery } from "../../../../lib/queryClient";
import AltitudeReasoning from "../AltitudeReasoning";
import type {
  Briefing, Candidate, Course, Leg, NavLog, SaveFlightRequest, Totals,
} from "../../../../lib/api/types";
import type { BriefingState, FrameworkNarrative } from "../../hooks/usePlan";
import { altFt, clockTime, deg } from "../../format";
import { navLogRows, savedCheckpoints } from "../navlog/rows";
import { colourOf } from "../../../../lib/map/flightCategory";

interface Props {
  course: Course | null;
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  legs: Leg[];
  dep: string;
  dest: string;
  selected: Candidate[];
  /** Whether the drawer holding this is open. The view stays mounted
   *  beside a desktop map whether or not it is. */
  open: boolean;
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
  /** The aeroplane the nav log was computed for (chosen in the nav log's
   *  own header): its label for the summary, and its id -- a pilot's
   *  own, or null for a stock profile -- for the saved flight. */
  aircraftLabel: string;
  aircraftId: number | null;
  /** The departure time as an ISO instant, or "" -- what a saved
   *  flight is planned for. */
  depart: string;
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">LangGraph Narrative</h2>
          <p className="mt-2 text-sm text-muted-foreground">{langgraph}</p>
        </>
      )}
      {crewai && (
        <>
          <h2 className={cn("text-sm font-semibold uppercase tracking-wide text-muted-foreground", langgraph && "mt-3")}>
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

/** The distinct (direction, speed) pairs actually present among the
 *  nav log's own per-leg wind data -- not every leg individually
 *  (many share the same nearest winds-aloft station and so report
 *  identical wind), and not a second aviationweather.gov call: this
 *  is a summary of what the nav log already fetched. */
function windsAloftSummary(legs: Leg[]): { dir: number; speed: number }[] {
  const seen = new Set<string>();
  const distinct: { dir: number; speed: number }[] = [];
  for (const leg of legs) {
    if (!leg.wind) continue;
    const dir = Math.round(leg.wind.wind_dir_true_deg);
    const speed = Math.round(leg.wind.wind_speed_kt);
    const key = `${dir},${speed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push({ dir, speed });
  }
  return distinct;
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
 */
function SaveFlightSection({
  course, totals, nav, legs, selected, aircraftId, aircraftLabel, depart,
}: {
  course: Course | null;
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  legs: Leg[];
  selected: Candidate[];
  aircraftId: number | null;
  aircraftLabel: string;
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

  return (
    // One line and a button at the top of the sections, ruled off
    // from them the way the accordion rules its own items apart.
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-sm print:hidden">
      {/* The aeroplane is whatever the nav log was computed for (its
          own header's picker), not a second choice made here -- a
          filed flight should record the numbers on the page. */}
      <span className="text-muted-foreground">
        {aircraftId === null ? `Planned for a stock ${aircraftLabel}; no aeroplane of yours on file for it` : `Flown in ${aircraftLabel}`}
      </span>
      <Button onClick={() => request && save.mutate(request)} disabled={!request || save.isPending || saved}>
        {save.isPending ? "Saving…" : saved ? "Saved" : "Save this flight"}
      </Button>
    </div>
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
  course, totals, nav, legs, dep, dest, selected,
  open, briefing: briefingState,
  langgraphNarrative, crewaiNarrative, aircraftLabel, aircraftId, depart,
}: Props) {
  const winds = windsAloftSummary(legs);
  // "VFR flight not recommended" (AIM 7-1-5) and its reasons are the
  // planner's call (vfr.weather), made against 14 CFR 91.155's minimums
  // in one place; this page states them.
  const briefing = briefingState.state === "ready" ? briefingState.data : null;
  const vnrReasons = briefing?.vfr_not_recommended ?? [];
  const briefingPendingMessage =
    briefingState.state === "waiting" ? "The briefing follows once the route's course is drawn."
      : briefingState.state === "failed" ? `Briefing data is unavailable (${briefingState.detail}).`
        : "Loading briefing data…";

  // "Planning aid only" used to be a permanently docked banner at the
  // top of the briefing, pushing every section below it down a line
  // whether a pilot needed the reminder again or not. A toast instead
  // -- same sonner instance (main.tsx) PlanWorkspace's own progress/error
  // toasts use -- says it once, prominently, each time the drawer
  // opens, then gets out of the way. On opening, not on mounting: beside
  // a desktop map this view is mounted for the whole visit, and the
  // warning used to pop up on page load, over a map with no drawer open.
  useEffect(() => {
    if (!open) return;
    toast.warning("Planning aid only.", {
      id: "briefing-planning-aid-only",
      description: "Before flight, obtain an official briefing and verify current weather, NOTAMs, TFRs, airport status, aircraft performance, and applicable regulations.",
      duration: 8000,
    });
    // sonner's own Toaster is mounted once at the app root (main.tsx),
    // not inside this view: closing the drawer takes the warning with it.
    return () => { toast.dismiss("briefing-planning-aid-only"); };
  }, [open]);

  // The briefing's own conclusions, announced once when they arrive.
  // The sections below carry the same facts for the printed page, but a
  // pilot should not have to scroll to learn that a weather source was
  // missing or that VFR is not recommended.
  useEffect(() => {
    if (!briefing) return;
    if (briefing.weather_unavailable.length > 0) {
      const missing = briefing.weather_unavailable.map(source => WEATHER_SOURCE_LABEL[source]).join(", ");
      toast.warning(`Could not check ${missing}.`, {
        id: "briefing-weather-gaps",
        description: "aviationweather.gov didn’t respond. Verify separately before flight.",
        duration: 10000,
      });
    }
    if (briefing.vfr_not_recommended.length > 0) {
      toast.warning("VFR flight not recommended", {
        id: "briefing-vnr", description: briefing.vfr_not_recommended.join(" · "), duration: 10000,
      });
    }
    return () => {
      toast.dismiss("briefing-weather-gaps");
      toast.dismiss("briefing-vnr");
    };
  }, [briefing]);

  return (
    // No header, title or scroller of its own: the flight planning
    // drawer's header (the aeroplane, the departure time, the
    // narrative and Print) is the briefing's, on screen and on paper
    // alike, and the drawer's accordion holds the nav log's own
    // section and these together (and opens every one for the
    // printer -- see NavLogView).
    <>
      {/* No summary section: the drawer's own header already carries
          the route's totals, the altitude and the aeroplane, and a
          second copy of them behind a fold was the same facts twice.
          "Save this flight" is what that section had of its own, and it
          leads the sections on its own line. Every weather section
          below stays collapsed -- skim the titles, open what applies. */}
      <SaveFlightSection
        course={course} totals={totals} nav={nav} legs={legs} selected={selected}
        aircraftId={aircraftId} aircraftLabel={aircraftLabel} depart={depart}
      />
      {briefingState.state === "ready" && briefingState.refreshError && (
        // The last briefing stays up after a refresh that failed -- say
        // so, and how old it is, as the map's airport chips do.
        <p className="border-b py-2 text-sm text-amber-700 dark:text-amber-400 print:hidden">
          Could not refresh the briefing ({briefingState.refreshError}); showing the one fetched at{" "}
          {clockTime(new Date(briefingState.fetchedAt))}.
        </p>
      )}

      {/* Not gated behind `briefing` -- narrative is its own separate,
          user-triggered fetch, and NOTAMs/Winds Aloft need only
          `legs`/`nav`, already loaded well before the briefing fetch
          even starts. Each section below that DOES need `briefing`
          still renders immediately (a pilot can see and open every
          section from the moment the page mounts) and shows its own
          loading line in place of real content until that one fetch
          resolves -- rather than the whole batch of them staying
          entirely absent from the page until every field of one
          response is in, which is what made this page read as slow
          to populate. */}
      <BriefingNarrativePrintBlock langgraph={langgraphNarrative.text} crewai={crewaiNarrative.text} />

      {/* Neither loading nor a failed fetch has a banner here: PlanWorkspace's
          toasts report both (the failure's toast carries the Try-again
          action), so the sections below only ever show their own
          content or a placeholder line. */}

      <BriefingSection title="Adverse Conditions">
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : briefing.weather_unavailable.includes("hazards") ? (
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
      </BriefingSection>

      <BriefingSection title="Current Conditions">
        {/* Its own standard element (AIM 7-1-5(b)), stated up front
            inside the section it's actually drawn from (current METAR
            categories, plus the route's own forecast minimums) rather
            than a separate banner above every other section --
            impossible to miss while this one's open, the way a live
            briefer states it before working through the detail that
            justifies it. */}
        {vnrReasons.length > 0 && (
          <div role="alert" className="mb-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
            <p className="font-semibold">VFR flight not recommended</p>
            <ul className="mt-0.5 list-inside list-disc">
              {vnrReasons.map(reason => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : briefing.weather_unavailable.includes("metars") ? (
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
                    {metar?.flight_category && (
                      <Badge style={{ backgroundColor: colourOf(metar.flight_category), color: "white" }}>
                        {metar.flight_category}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                    {metar?.raw ?? "No current report available."}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </BriefingSection>

      {/* Split into its own two standard elements (AIM 7-1-5(e)/(f))
          rather than one blended list -- a briefer states the
          destination's own forecast as its own line, not one entry
          among however many en route stations happen to have a TAF,
          since it's the one that actually decides go/no-go on arrival. */}
      <BriefingSection title="Destination Forecast">
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : briefing.weather_unavailable.includes("forecast") ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Forecast data could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
          </p>
        ) : (() => {
          const destStation = briefing.forecast.stations.find(st => st.icaoId === dest);
          return destStation ? (
            <p className="text-sm text-muted-foreground">
              {dest}: ceiling {altFt(destStation.ceiling_ft)} ft, visibility {destStation.visibility_sm ?? "—"} sm.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No TAF published for {dest}.</p>
          );
        })()}
      </BriefingSection>

      <BriefingSection title="En Route Forecast">
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : briefing.weather_unavailable.includes("forecast") ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Forecast data could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Along the route: ceiling {altFt(briefing.forecast.min_ceiling_ft)} ft,
              visibility {briefing.forecast.min_visibility_sm ?? "—"} sm (worst nearby TAF period).
            </p>
            {briefing.forecast.stations.filter(st => st.icaoId !== dest).length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {briefing.forecast.stations.filter(st => st.icaoId !== dest).map(st => (
                  <li key={st.icaoId}>
                    {st.icaoId}: ceiling {altFt(st.ceiling_ft)} ft, visibility {st.visibility_sm ?? "—"} sm
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </BriefingSection>

      {/* Not gated behind `briefing` -- everything here comes from
          `nav.altitude_selection`, the same "altitude" stream message
          the drawer header's own altitude line already used, not a
          second fetch. Grouped here with Winds Aloft/NOTAMs rather
          than first, for the same reason those two sit down here:
          none of the three depend on
          `briefing`, so none of them belong next to the "loading
          briefing data" status banner above (which IS about the
          briefing fetch) -- placing this one there read as if that
          banner were reporting on it too, even though this section's
          own data had already arrived by the time the banner showed.
          Used to live behind Settings' own "Altitude Selection
          Breakdown" demo panel (type any route in, see the reasoning
          for it) -- moved here instead, since a pilot wants this
          reasoning for the route they're actually flying, not a
          one-off lookup independent of it. */}
      {/* The planner's own reasoning, step by step -- the same steps
          the nav log header's "why" popover shows, here for the paper
          (a popover prints nothing) and for a pilot reading the
          briefing top to bottom. A grid of bare figures used to sit
          here; the steps carry every one of those figures with the
          rule that used it. */}
      <BriefingSection title="Cruise Altitude">
        {!nav ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <AltitudeReasoning nav={nav} />
        )}
      </BriefingSection>

      <BriefingSection title="Winds Aloft">
        {winds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No winds-aloft data available for this route.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {winds.map(w => `${deg(w.dir)}/${w.speed}kt`).join(", ")} at {altFt(nav?.altitude_ft)} ft
          </p>
        )}
      </BriefingSection>

      <BriefingSection title="NOTAMs">
        <p className="text-sm text-muted-foreground">
          Not fetched here (the official FAA NOTAM API requires operator credentials) --
          check current NOTAMs directly before you fly:{" "}
          <a
            href="https://www.1800wxbrief.com" target="_blank" rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            1800wxbrief.com
          </a>{" "}or{" "}
          <a
            href="https://notams.aim.faa.gov/notamSearch/" target="_blank" rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            notams.aim.faa.gov
          </a>.
        </p>
      </BriefingSection>

      {/* The last of the AIM 7-1-5 standard elements this page can name
          but not actually fetch -- ATC flow-control advisories need a
          live feed this app has no access to, the same reasoning
          NOTAMs above already explains. Named and pointed somewhere
          real rather than silently dropped, which is the one thing
          that made those two elements different from every other one
          on this page before this section existed. */}
      <BriefingSection title="ATC Delays">
        <p className="text-sm text-muted-foreground">
          Not fetched here -- check current delays and flow-control advisories:{" "}
          <a
            href="https://www.fly.faa.gov" target="_blank" rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            fly.faa.gov
          </a>.
        </p>
      </BriefingSection>

      <BriefingSection title="Airport Information">
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {[dep, dest].map(ident => {
              const info = briefing.airports[ident];
              return (
                <div key={ident} className="rounded border border-border px-2 py-1.5 text-sm">
                  <div className="mb-1 font-semibold">{ident}</div>
                  {info?.frequencies.length ? (
                    <ul className="space-y-0.5">
                      {info.frequencies.map((f, i) => (
                        <li key={i} className="text-muted-foreground">
                          {f.type ?? "—"}{f.description ? ` (${f.description})` : ""}: {f.frequency_mhz ?? "—"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No published frequencies.</p>
                  )}
                  {info?.runways.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {info.runways.map((r, i) => (
                        <li key={i} className="text-muted-foreground">
                          {r.ends ?? "—"}: {r.length_ft ?? "—"}×{r.width_ft ?? "—"} ft, {r.surface ?? "unknown surface"}
                          {r.lighted ? ", lighted" : ""}{r.closed ? " (closed)" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted-foreground">No published runway data.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </BriefingSection>
    </>
  );
}
