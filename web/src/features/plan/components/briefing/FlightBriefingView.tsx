import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import CollapsibleSection from "../../../../components/CollapsibleSection";
import { api, describeError } from "../../../../lib/api/client";
import AltitudeReasoning from "../AltitudeReasoning";
import type {
  Briefing, Candidate, Course, Leg, NavLog, Pilot, SaveFlightRequest, Totals,
} from "../../../../lib/api/types";
import type { FrameworkNarrative } from "../../hooks/usePlanState";
import { altFt, deg } from "../../format";

interface Props {
  course: Course | null;
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  legs: Leg[];
  dep: string;
  dest: string;
  selected: Candidate[];
  /** Null while the fetch is still in flight or has failed. The page
   *  keeps its standard sections visible and identifies which state
   *  applies, rather than making a failed briefing indistinguishable
   *  from a slow response. */
  briefing: Briefing | null;
  briefingError: string | null;
  loadingBriefing: boolean;
  /** Whether the drawer is open wide: then every section starts open
   *  -- the whole briefing laid out, the document -- where the narrow
   *  drawer, the nav log, keeps them closed under the table. */
  expanded: boolean;
  /** LangGraph's (nav-log-agent) and CrewAI's (crewai-agent) own
   *  briefing narratives -- read-only here, only for
   *  `BriefingNarrativePrintBlock` below. Generating them is
   *  `NavLogActions`' own job, from the nav log drawer's own header
   *  while it is open wide, not this component's. */
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

const FLIGHT_CATEGORY_COLOR: Record<string, string> = {
  VFR: "#1a7f37", MVFR: "#1e6fd9", IFR: "#b3261e", LIFR: "#9333ea",
};

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
          <h2 className={clsx("text-sm font-semibold uppercase tracking-wide text-muted-foreground", langgraph && "mt-3")}>
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

/**
 * "VFR Flight Not Recommended" -- its own named, standard element of
 * an FAA briefing (AIM 7-1-5), not something this app was inventing:
 * a standard briefing states it explicitly whenever conditions warrant
 * it, stated plainly rather than something a pilot has to read the
 * Current Conditions detail closely to work out themselves -- which is
 * where it's shown, first thing inside that section, since that's the
 * data it's actually computed from. Computed from data this page
 * already has -- either endpoint's current METAR reporting IFR/LIFR,
 * or the along-route forecast dropping below basic VFR minimums
 * (14 CFR 91.155: 3 sm visibility, 1,000 ft ceiling) -- not a second
 * fetch.
 */
const WEATHER_SOURCE_LABEL: Record<Briefing["weather_unavailable"][number], string> = {
  hazards: "SIGMETs",
  forecast: "the TAF forecast",
  metars: "current METARs",
};

function vfrNotRecommendedReasons(briefing: Briefing, dep: string, dest: string): string[] {
  const reasons: string[] = [];
  for (const ident of [dep, dest]) {
    const category = briefing.metars[ident]?.flight_category;
    if (category === "IFR" || category === "LIFR") {
      reasons.push(`${ident} currently reporting ${category}`);
    }
  }
  const { min_ceiling_ft, min_visibility_sm } = briefing.forecast;
  if (min_ceiling_ft !== null && min_ceiling_ft < 1000) {
    reasons.push(`forecast ceiling as low as ${altFt(min_ceiling_ft)} ft along the route`);
  }
  if (min_visibility_sm !== null && min_visibility_sm < 3) {
    reasons.push(`forecast visibility as low as ${min_visibility_sm} sm along the route`);
  }
  return reasons;
}

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
 * origin, same pattern the Playground's own panels use), independent
 * of planning-service entirely. Hidden while signed out rather than
 * shown disabled -- there is nothing a signed-out pilot could do
 * about it from here, and a disabled button with no explanation reads
 * as broken rather than as "sign in first."
 */
function SaveFlightSection({
  course, totals, nav, legs, dep, dest, selected, aircraftId, aircraftLabel, depart,
}: {
  course: Course | null;
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  legs: Leg[];
  dep: string;
  dest: string;
  selected: Candidate[];
  aircraftId: number | null;
  aircraftLabel: string;
  depart: string;
}) {
  const [pilot, setPilot] = useState<Pilot | null | "loading">("loading");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => { void api.me().then(setPilot); }, []);

  // The same row shape the nav log table draws (departure, no leg --
  // then one row per selected checkpoint and one for the destination,
  // each carrying the leg that arrived there) -- just as a plain
  // request payload instead of table cells.
  const buildCheckpoints = useCallback((): SaveFlightRequest["checkpoints"] => {
    if (!course) return [];
    const rows: SaveFlightRequest["checkpoints"] = [{
      sequenceNo: 0, name: dep, category: "departure",
      lat: course.departure.lat, lon: course.departure.lon, alongTrackNm: 0,
      legDistanceNm: null, trueCourseDeg: null, magneticHeadingDeg: null,
      groundspeedKt: null, eteMin: null, fuelGal: null, altitudeFt: null,
    }];
    selected.forEach((cp, i) => {
      const leg = legs[i];
      rows.push({
        sequenceNo: i + 1, name: cp.name || cp.category, category: cp.category,
        lat: cp.lat, lon: cp.lon, alongTrackNm: cp.along_track_nm,
        legDistanceNm: leg?.distance_nm ?? null, trueCourseDeg: leg?.true_course_deg ?? null,
        magneticHeadingDeg: leg?.magnetic_heading_deg ?? null, groundspeedKt: leg?.groundspeed_kt ?? null,
        eteMin: leg?.ete_min ?? null, fuelGal: leg?.fuel_gal ?? null,
        // Each leg's own altitude: a plan may step, so the flight's one
        // cruise altitude is not the whole story.
        altitudeFt: leg?.altitude_ft ?? null,
      });
    });
    const finalLeg = legs[selected.length];
    rows.push({
      sequenceNo: selected.length + 1, name: dest, category: "destination",
      lat: course.destination.lat, lon: course.destination.lon, alongTrackNm: course.distance_nm,
      legDistanceNm: finalLeg?.distance_nm ?? null, trueCourseDeg: finalLeg?.true_course_deg ?? null,
      magneticHeadingDeg: finalLeg?.magnetic_heading_deg ?? null, groundspeedKt: finalLeg?.groundspeed_kt ?? null,
      eteMin: finalLeg?.ete_min ?? null, fuelGal: finalLeg?.fuel_gal ?? null,
      altitudeFt: finalLeg?.altitude_ft ?? null,
    });
    return rows;
  }, [course, dep, dest, selected, legs]);

  if (pilot === "loading" || pilot === null) return null;

  const save = () => {
    if (!course) return;
    setStatus("saving");
    api.flights.save({
      aircraftId,
      departureIdent: dep,
      destinationIdent: dest,
      cruiseAltitudeFt: nav?.altitude_ft ?? null,
      totalDistanceNm: totals?.distance_nm ?? null,
      totalEteMin: totals?.ete_min ?? null,
      totalFuelGal: totals?.fuel_gal ?? null,
      plannedFor: depart || null,
      checkpoints: buildCheckpoints(),
    })
      .then(() => setStatus("saved"))
      .catch(err => {
        setStatus("error");
        toast.error(describeError(err, "Could not save this flight"));
      });
  };

  return (
    // Its own card at the top of the sections, the same chrome as
    // CollapsibleSection's, without the fold: one line and a button.
    <div className="mx-2 my-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-sm shadow-xs ring-1 ring-foreground/10 print:hidden">
      {/* The aeroplane is whatever the nav log was computed for (its
          own header's picker), not a second choice made here -- a
          filed flight should record the numbers on the page. */}
      <span className="text-muted-foreground">
        {aircraftId === null ? `Planned for a stock ${aircraftLabel}; no aeroplane of yours on file for it` : `Flown in ${aircraftLabel}`}
      </span>
      <Button onClick={save} disabled={status === "saving" || !course}>
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save this flight"}
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
  briefing, briefingError, loadingBriefing,
  langgraphNarrative, crewaiNarrative, aircraftLabel, aircraftId, depart, expanded,
}: Props) {
  const winds = windsAloftSummary(legs);
  const vnrReasons = briefing ? vfrNotRecommendedReasons(briefing, dep, dest) : [];
  // On the very first render after mount, loadingBriefing is still false --
  // PlanView's own effect (which calls loadBriefing) hasn't run yet -- so
  // "not loading" alone can't mean "unavailable". Only briefingError (a
  // fetch that actually finished and failed), or having no dep/dest to
  // fetch with at all, means there is truly nothing pending.
  const briefingNotStarted = !briefing && !briefingError && !!dep && !!dest;
  const briefingPendingMessage = loadingBriefing || briefingNotStarted
    ? "Loading briefing data…"
    : "Briefing data is unavailable.";

  // "Planning aid only" used to be a permanently docked banner at the
  // top of the briefing, pushing every section below it down a line
  // whether a pilot needed the reminder again or not. A toast instead
  // -- same sonner instance (main.tsx) PlanView's own progress/error
  // toasts use, so the same bottom-center position without having to
  // say so again here -- says it once, prominently, each time this
  // mounts (the drawer opening wide), then gets out of the way rather
  // than sitting there for the whole session.
  useEffect(() => {
    toast.warning("Planning aid only.", {
      id: "briefing-planning-aid-only",
      description: "Before flight, obtain an official briefing and verify current weather, NOTAMs, TFRs, airport status, aircraft performance, and applicable regulations.",
      duration: 8000,
    });
    // sonner's own Toaster is mounted once at the app root (main.tsx),
    // not inside this view -- without this, its 8s duration keeps
    // counting down regardless of navigation, so narrowing the drawer
    // back to the nav log (or leaving for Dev) within that window
    // still shows a briefing-specific warning on whatever is on screen
    // next.
    return () => { toast.dismiss("briefing-planning-aid-only"); };
  }, []);

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
    const reasons = vfrNotRecommendedReasons(briefing, dep, dest);
    if (reasons.length > 0) {
      toast.warning("VFR flight not recommended", { id: "briefing-vnr", description: reasons.join(" · "), duration: 10000 });
    }
    return () => {
      toast.dismiss("briefing-weather-gaps");
      toast.dismiss("briefing-vnr");
    };
  }, [briefing, dep, dest]);

  return (
    // No header, title or scroller of its own: the nav log drawer's own
    // header (the totals, the altitude, the aeroplane, the narrative
    // and Print) is the briefing's, on screen and on paper alike, and
    // the drawer scrolls the nav log's own section and these together
    // (and shows every section for the print -- index.css's own rule
    // over the whole `.flight-briefing` scroller).
    <>
      {/* No summary section: the drawer's own header already carries
          the route's totals, the altitude and the aeroplane, and a
          second copy of them behind a fold was the same facts twice.
          "Save this flight" is what that section had of its own, and it
          leads the sections on its own line. Every weather section
          below stays collapsed -- skim the titles, open what applies. */}
      <SaveFlightSection
        course={course} totals={totals} nav={nav} legs={legs} dep={dep} dest={dest} selected={selected}
        aircraftId={aircraftId} aircraftLabel={aircraftLabel} depart={depart}
      />

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

      {/* Neither loading nor a failed fetch has a banner here: PlanView's
          toasts report both (the failure's toast carries the Try-again
          action), so the sections below only ever show their own
          content or a placeholder line. */}

      <CollapsibleSection defaultOpen={expanded} title="Adverse Conditions">
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
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={expanded} title="Current Conditions">
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
                      <Badge style={{ backgroundColor: FLIGHT_CATEGORY_COLOR[metar.flight_category] ?? "#5b6b76", color: "white" }}>
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
      </CollapsibleSection>

      {/* Split into its own two standard elements (AIM 7-1-5(e)/(f))
          rather than one blended list -- a briefer states the
          destination's own forecast as its own line, not one entry
          among however many en route stations happen to have a TAF,
          since it's the one that actually decides go/no-go on arrival. */}
      <CollapsibleSection defaultOpen={expanded} title="Destination Forecast">
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
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={expanded} title="En Route Forecast">
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
      </CollapsibleSection>

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
      <CollapsibleSection defaultOpen={expanded} title="Cruise Altitude">
        {!nav ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <AltitudeReasoning nav={nav} bearingDeg={course?.bearing_deg ?? null} />
        )}
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={expanded} title="Winds Aloft">
        {winds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No winds-aloft data available for this route.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {winds.map(w => `${deg(w.dir)}/${w.speed}kt`).join(", ")} at {altFt(nav?.altitude_ft)} ft
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={expanded} title="NOTAMs">
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
      </CollapsibleSection>

      {/* The last of the AIM 7-1-5 standard elements this page can name
          but not actually fetch -- ATC flow-control advisories need a
          live feed this app has no access to, the same reasoning
          NOTAMs above already explains. Named and pointed somewhere
          real rather than silently dropped, which is the one thing
          that made those two elements different from every other one
          on this page before this section existed. */}
      <CollapsibleSection defaultOpen={expanded} title="ATC Delays">
        <p className="text-sm text-muted-foreground">
          Not fetched here -- check current delays and flow-control advisories:{" "}
          <a
            href="https://www.fly.faa.gov" target="_blank" rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            fly.faa.gov
          </a>.
        </p>
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={expanded} title="Airport Information">
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
      </CollapsibleSection>
    </>
  );
}
