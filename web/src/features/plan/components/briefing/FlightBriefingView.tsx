import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "../../../../components/ui/table";
import CollapsibleSection from "../../../../components/CollapsibleSection";
import { ApiError, api } from "../../../../lib/api/client";
import type {
  Aircraft, Briefing, Candidate, Course, Leg, NavLog, Pilot, SaveFlightRequest, Totals,
} from "../../../../lib/api/types";
import { type Description, type FrameworkNarrative, descriptionKey } from "../../hooks/usePlanState";
import { altFt, deg, one, signed, totalsParts } from "../../format";

interface Props {
  course: Course | null;
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  legs: Leg[];
  navError: string | null;
  dep: string;
  dest: string;
  selected: Candidate[];
  depElevationFt: number | null;
  destElevationFt: number | null;
  /** Whatever the sidebar's own per-checkpoint "how to spot it" notes
   *  currently hold -- copied over read-only, not re-editable here. */
  descriptions: Record<string, Description>;
  /** Null while the fetch is still in flight or has failed. The page
   *  keeps its standard sections visible and identifies which state
   *  applies, rather than making a failed briefing indistinguishable
   *  from a slow response. */
  briefing: Briefing | null;
  briefingError: string | null;
  loadingBriefing: boolean;
  /** LangGraph's (nav-log-agent) and CrewAI's (crewai-agent) own
   *  briefing narratives -- read-only here, only for
   *  `BriefingNarrativePrintBlock` below. Generating them is
   *  `NavLogActions`' own job now, from PlanView's persistent header
   *  (trailing content next to the Map/Brief tabs while Brief is
   *  active), not this component's -- this page no longer draws its
   *  own separate header at all, see this component's own top-level
   *  comment. */
  langgraphNarrative: FrameworkNarrative;
  crewaiNarrative: FrameworkNarrative;
}

const FLIGHT_CATEGORY_COLOR: Record<string, string> = {
  VFR: "#1a7f37", MVFR: "#1e6fd9", IFR: "#b3261e", LIFR: "#9333ea",
};

/**
 * A plain, read-only copy of the sidebar's own nav log table --
 * deliberately not that component: this page is a document to hand a
 * pilot or print, not a workspace, so there's no click-to-select, no
 * per-checkpoint description column to edit, and no map to link a
 * selection to. Same columns, same formatting, same waypoint-per-row
 * shape as NavLogView's table -- just without any of the interactivity
 * that doesn't belong on a printed page.
 */
function NavLogTable({
  nav, legs, selected, dep, dest, depElevationFt, destElevationFt, navError, descriptions,
}: {
  nav: Omit<NavLog, "legs" | "totals"> | null;
  legs: Leg[];
  selected: Candidate[];
  dep: string;
  dest: string;
  depElevationFt: number | null;
  destElevationFt: number | null;
  navError: string | null;
  descriptions: Record<string, Description>;
}) {
  const waypoints = [...selected, null].map((cp, i) => ({
    cp,
    name: cp ? (cp.name || cp.category) : dest,
    leg: legs[i] as Leg | undefined,
  }));

  return (
    // print:overflow-visible, not the stock `overflow-x-auto` alone --
    // this page's own outer scroller (`flight-briefing`, further down)
    // is deliberately y-only (print pagination needs every column
    // actually laid out, not clipped to a scrollable viewport a printed
    // page can't scroll), but that means on screen this table needs its
    // own scroll for anything narrower than all twelve columns, since
    // nothing else here provides one.
    <Table containerClassName="overflow-x-auto print:overflow-visible" className="text-right text-xs whitespace-nowrap">
      <TableCaption className="sr-only">
        Navigation log from {dep} to {dest}
      </TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-left">Waypoint</TableHead>
          <TableHead className="border-l border-border">Alt</TableHead>
          <TableHead className="border-l border-border">Dist</TableHead>
          <TableHead className="border-l border-border">TC</TableHead>
          <TableHead className="border-l border-border">Wind</TableHead>
          <TableHead className="border-l border-border">WCA</TableHead>
          <TableHead className="border-l border-border">TH</TableHead>
          <TableHead className="border-l border-border">Var</TableHead>
          <TableHead className="border-l border-border">MH</TableHead>
          <TableHead className="border-l border-border">GS</TableHead>
          <TableHead className="border-l border-border">ETE</TableHead>
          <TableHead className="border-l border-border">Fuel</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {navError && (
          <TableRow><TableCell className="text-left text-destructive" colSpan={12}>{navError}</TableCell></TableRow>
        )}
        {!navError && selected.length === 0 && (
          <TableRow><TableCell className="text-left text-muted-foreground" colSpan={12}>No route planned yet</TableCell></TableRow>
        )}
        {selected.length > 0 && (
          <TableRow className="text-muted-foreground">
            <TableCell className="text-left">{dep}</TableCell>
            <TableCell className="border-l border-border">{altFt(depElevationFt)}</TableCell>
            {Array.from({ length: 10 }, (_, i) => (
              <TableCell key={i} className="border-l border-border">—</TableCell>
            ))}
          </TableRow>
        )}
        {waypoints.map(({ cp, name, leg }, i) => {
          const description = cp && descriptions[descriptionKey(cp.lat, cp.lon)];
          return (
            <Fragment key={i}>
              <TableRow className={clsx(!leg?.wind && "text-muted-foreground")}>
                <TableCell className="text-left">{name}</TableCell>
                <TableCell className="border-l border-border">{altFt(cp ? nav?.altitude_ft : destElevationFt)}</TableCell>
                <TableCell className="border-l border-border">{leg ? leg.distance_nm.toFixed(1) : "—"}</TableCell>
                <TableCell className="border-l border-border">{leg ? deg(leg.true_course_deg) : "—"}</TableCell>
                <TableCell className="border-l border-border">{leg
                  ? (leg.wind ? `${deg(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)}` : "no data")
                  : "—"}</TableCell>
                <TableCell className="border-l border-border">{leg ? signed(leg.wca_deg) : "—"}</TableCell>
                <TableCell className="border-l border-border">{leg ? deg(leg.true_heading_deg) : "—"}</TableCell>
                <TableCell className="border-l border-border">{leg ? signed(leg.magnetic_variation_deg) : "—"}</TableCell>
                <TableCell className="border-l border-border">{leg ? deg(leg.magnetic_heading_deg) : "—"}</TableCell>
                <TableCell className="border-l border-border">
                  {leg ? (leg.groundspeed_kt === null ? "—" : Math.round(leg.groundspeed_kt)) : "—"}
                </TableCell>
                <TableCell className="border-l border-border">
                  {leg ? (leg.ete_min === null ? "unflyable" : one(leg.ete_min)) : "—"}
                </TableCell>
                <TableCell className="border-l border-border">{leg ? one(leg.fuel_gal) : "—"}</TableCell>
              </TableRow>
              {/* Copied over from the sidebar's own nav log, read-only --
                  a pilot's typed (or generated) "how to spot it" note is
                  worth having on the printed page, but isn't editable
                  here: this page is a document to hand over or print,
                  not the workspace that note was written in. */}
              {description && description.text && (
                <TableRow>
                  {/* pl-6, not px-2 like the waypoint cell above it --
                      indented so it reads as that row's own note, not
                      another row at the same level. */}
                  <TableCell colSpan={12} className="bg-muted/60 pl-6 text-left whitespace-normal italic text-muted-foreground">
                    {description.text}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Whichever narrative(s) a pilot actually generated, print only. On
 * screen each lives in `NavLogActions`' own `Popover` instead (next to
 * the buttons that produce it, in the header, not a scroll away) -- but
 * a closed Popover renders nothing, so a printed copy needs its own
 * text sitting directly in the page. Same `hidden print:block` pattern
 * this page's own title uses just above, for the same reason. Prints
 * neither, one, or both, whichever the pilot actually asked for on
 * screen -- generating a framework's narrative just to have it for a
 * printout nobody asked for would be a real, billed Claude call spent
 * on nothing.
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
  course, totals, nav, legs, dep, dest, selected,
}: {
  course: Course | null;
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;
  legs: Leg[];
  dep: string;
  dest: string;
  selected: Candidate[];
}) {
  const [pilot, setPilot] = useState<Pilot | null | "loading">("loading");
  const [aircraftList, setAircraftList] = useState<Aircraft[]>([]);
  const [aircraftId, setAircraftId] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => { void api.me().then(setPilot); }, []);
  useEffect(() => {
    if (pilot && pilot !== "loading") void api.aircraft.list().then(setAircraftList).catch(() => setAircraftList([]));
  }, [pilot]);

  // Same row shape NavLogTable already builds (departure, no leg --
  // then one row per selected checkpoint and one for the destination,
  // each carrying the leg that arrived there) -- just as a plain
  // request payload instead of table cells.
  const buildCheckpoints = useCallback((): SaveFlightRequest["checkpoints"] => {
    if (!course) return [];
    const rows: SaveFlightRequest["checkpoints"] = [{
      sequenceNo: 0, name: dep, category: "departure",
      lat: course.departure.lat, lon: course.departure.lon, alongTrackNm: 0,
      legDistanceNm: null, trueCourseDeg: null, magneticHeadingDeg: null,
      groundspeedKt: null, eteMin: null, fuelGal: null,
    }];
    selected.forEach((cp, i) => {
      const leg = legs[i];
      rows.push({
        sequenceNo: i + 1, name: cp.name || cp.category, category: cp.category,
        lat: cp.lat, lon: cp.lon, alongTrackNm: cp.along_track_nm,
        legDistanceNm: leg?.distance_nm ?? null, trueCourseDeg: leg?.true_course_deg ?? null,
        magneticHeadingDeg: leg?.magnetic_heading_deg ?? null, groundspeedKt: leg?.groundspeed_kt ?? null,
        eteMin: leg?.ete_min ?? null, fuelGal: leg?.fuel_gal ?? null,
      });
    });
    const finalLeg = legs[selected.length];
    rows.push({
      sequenceNo: selected.length + 1, name: dest, category: "destination",
      lat: course.destination.lat, lon: course.destination.lon, alongTrackNm: course.distance_nm,
      legDistanceNm: finalLeg?.distance_nm ?? null, trueCourseDeg: finalLeg?.true_course_deg ?? null,
      magneticHeadingDeg: finalLeg?.magnetic_heading_deg ?? null, groundspeedKt: finalLeg?.groundspeed_kt ?? null,
      eteMin: finalLeg?.ete_min ?? null, fuelGal: finalLeg?.fuel_gal ?? null,
    });
    return rows;
  }, [course, dep, dest, selected, legs]);

  if (pilot === "loading" || pilot === null) return null;

  const save = () => {
    if (!course) return;
    setStatus("saving");
    api.flights.save({
      aircraftId: aircraftId ? Number(aircraftId) : null,
      departureIdent: dep,
      destinationIdent: dest,
      cruiseAltitudeFt: nav?.altitude_ft ?? null,
      totalDistanceNm: totals?.distance_nm ?? null,
      totalEteMin: totals?.ete_min ?? null,
      totalFuelGal: totals?.fuel_gal ?? null,
      plannedFor: null,
      checkpoints: buildCheckpoints(),
    })
      .then(() => setStatus("saved"))
      .catch(err => {
        setStatus("error");
        toast.error(err instanceof ApiError ? err.message : "Could not save this flight");
      });
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm print:hidden">
      <Select value={aircraftId || undefined} onValueChange={setAircraftId}>
        <SelectTrigger aria-label="Aircraft flown">
          <SelectValue placeholder="No aircraft on file" />
        </SelectTrigger>
        <SelectContent>
          {aircraftList.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.tailNumber}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button onClick={save} disabled={status === "saving" || !course}>
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save this flight"}
      </Button>
    </div>
  );
}

/**
 * The Flight Briefing page: the FAA's own standard-briefing sequence
 * (AIM 7-1-5) -- VFR-not-recommended, adverse conditions, current
 * conditions, destination and en route forecast, winds aloft, NOTAMs,
 * ATC delays, airport information -- around the nav log, laid out to
 * print cleanly. One element of that sequence is genuinely absent
 * rather than faked: a synoptic narrative (needs real meteorological
 * analysis, not a data fetch). NOTAMs and ATC delays are both named
 * but not embedded -- the official NOTAM API and ATC flow-control data
 * are both gated to certain commercial/public operators, so each
 * section says so and links out to a real briefing service instead of
 * silently disappearing the way an unnamed gap would.
 */
export default function FlightBriefingView({
  course, totals, nav, legs, navError, dep, dest, selected, depElevationFt, destElevationFt, descriptions,
  briefing, briefingError, loadingBriefing,
  langgraphNarrative, crewaiNarrative,
}: Props) {
  const parts = totals ? totalsParts(totals) : null;
  const winds = windsAloftSummary(legs);
  const vnrReasons = briefing ? vfrNotRecommendedReasons(briefing, dep, dest) : [];
  const briefingContainer = useRef<HTMLDivElement>(null);
  // On the very first render after mount, loadingBriefing is still false --
  // PlanView's own effect (which calls loadBriefing) hasn't run yet -- so
  // "not loading" alone can't mean "unavailable". Only briefingError (a
  // fetch that actually finished and failed), or having no dep/dest to
  // fetch with at all, means there is truly nothing pending.
  const briefingNotStarted = !briefing && !briefingError && !!dep && !!dest;
  const briefingPendingMessage = loadingBriefing || briefingNotStarted
    ? "Loading briefing data…"
    : "Briefing data is unavailable.";

  // A collapsed <details> renders nothing to print, `print:` overrides
  // on its own children notwithstanding -- Chromium's own closed-state
  // styling for it isn't plain `display:none` on those children (which
  // an author override could win against) but a zero-size internal
  // content box the children's own display value doesn't affect. The
  // one override that reliably works everywhere is opening every
  // section for the print itself, then restoring whatever the pilot
  // actually had open -- `beforeprint`/`afterprint` fire around both
  // this page's own Print button and a browser's native Ctrl+P alike.
  useEffect(() => {
    const openBeforePrint = new WeakMap<HTMLDetailsElement, boolean>();
    const beforePrint = () => {
      briefingContainer.current?.querySelectorAll<HTMLDetailsElement>("details").forEach(d => {
        openBeforePrint.set(d, d.open);
        d.open = true;
      });
    };
    const afterPrint = () => {
      briefingContainer.current?.querySelectorAll<HTMLDetailsElement>("details").forEach(d => {
        // `?? false`, not `?? d.open` -- by this point every details
        // has already been forced open, so reading its own `open` as
        // the fallback would just keep it open forever. `false` is the
        // right default for one that didn't exist yet at beforePrint
        // (the briefing's own async sections mounting between the two
        // events) -- it was never open in the first place.
        d.open = openBeforePrint.get(d) ?? false;
      });
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  // "Planning aid only" used to be a permanently docked banner at the
  // top of this page, pushing every section below it down a line
  // whether a pilot needed the reminder again or not. A toast instead
  // -- same sonner instance (main.tsx) PlanView's own progress/error
  // toasts use, so the same bottom-center position without having to
  // say so again here -- says it once, prominently, each time this
  // view mounts (opening the Brief tab), then gets out of the way
  // rather than sitting there for the whole session.
  useEffect(() => {
    toast.warning("Planning aid only.", {
      id: "briefing-planning-aid-only",
      description: "Before flight, obtain an official briefing and verify current weather, NOTAMs, TFRs, airport status, aircraft performance, and applicable regulations.",
      duration: 8000,
    });
    // sonner's own Toaster is mounted once at the app root (main.tsx),
    // not inside this view -- without this, its 8s duration keeps
    // counting down regardless of navigation, so leaving this page
    // (back to Map, or away to Label/Settings entirely) within that
    // window still shows a "Brief"-specific warning on whatever page
    // you land on next.
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
    <div ref={briefingContainer} className="flight-briefing h-full overflow-y-auto bg-background print:h-auto print:overflow-visible">
      {/* No header of this page's own any more -- PlanView's persistent
          header (route form, Map/Brief tabs, NavLogActions while Brief
          is active) covers what this used to draw itself (a "Back to
          Map" button, Settings, the narrative actions), and having both
          on screen at once read as two headers stacked rather than one
          page with two views. This print-only title is what's left:
          a printed page has no tabs to switch or button to click back
          with, but still needs its own identifying title, since the
          persistent header above is `print:hidden` in its entirety. */}
      <div className="hidden border-b border-border px-4 py-3 print:block">
        <h1 className="text-lg font-bold tracking-tight text-foreground">Flight Briefing</h1>
        <p className="text-sm text-muted-foreground">{dep} → {dest}</p>
      </div>

      <CollapsibleSection title="Flight Plan Summary">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Route</div>
            <div className="font-semibold">{course?.departure.ident} → {course?.destination.ident}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Distance</div>
            <div className="font-semibold">{course ? `${course.distance_nm} nm, ${deg(course.bearing_deg)}` : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Altitude</div>
            <div className="font-semibold">
              {nav ? `${altFt(nav.altitude_ft)} ft ${nav.altitude_selection ? "(auto)" : "(set)"}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Aircraft</div>
            <div className="font-semibold">{nav?.aircraft.name ?? "—"}</div>
          </div>
          {parts && (
            <>
              <div>
                <div className="text-xs text-muted-foreground">Total time</div>
                <div className="font-semibold">{parts.time}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Fuel</div>
                <div className="font-semibold">{parts.fuel}</div>
              </div>
            </>
          )}
        </div>
        <SaveFlightSection
          course={course} totals={totals} nav={nav} legs={legs} dep={dep} dest={dest} selected={selected}
        />
        <div className="mt-3 overflow-x-auto" data-testid="navlog-scroller">
          <NavLogTable
            nav={nav} legs={legs} selected={selected} dep={dep} dest={dest}
            depElevationFt={depElevationFt} destElevationFt={destElevationFt} navError={navError}
            descriptions={descriptions}
          />
        </div>
      </CollapsibleSection>

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

      <CollapsibleSection title="Adverse Conditions">
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : briefing.weather_unavailable.includes("hazards") ? (
          <p className="text-sm text-amber-700">
            SIGMET/AIRMET data could not be checked — aviationweather.gov didn’t respond. Verify separately before flight.
          </p>
        ) : briefing.hazards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No SIGMETs or AIRMETs reported along this route.</p>
        ) : (
          <ul className="space-y-2">
            {briefing.hazards.map((h, i) => (
              <li key={i} className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm">
                <div className="font-semibold text-amber-800">
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

      <CollapsibleSection title="Current Conditions">
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
          <p className="text-sm text-amber-700">
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
      <CollapsibleSection title="Destination Forecast">
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : briefing.weather_unavailable.includes("forecast") ? (
          <p className="text-sm text-amber-700">
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

      <CollapsibleSection title="En Route Forecast">
        {!briefing ? (
          <p className="text-sm text-muted-foreground">{briefingPendingMessage}</p>
        ) : briefing.weather_unavailable.includes("forecast") ? (
          <p className="text-sm text-amber-700">
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
          the Flight Plan Summary's own headline figure above already
          used, not a second fetch. Grouped here with Winds Aloft/NOTAMs
          rather than right after Flight Plan Summary, for the same
          reason those two sit down here: none of the three depend on
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
      <CollapsibleSection title="Cruise Altitude">
        {!nav ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !nav.altitude_selection ? (
          <p className="text-sm text-muted-foreground">
            This route's cruise altitude was set manually -- nothing was auto-selected to break down.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">Recommended</div>
              <div className="font-semibold">{altFt(nav.altitude_selection.recommended_ft)} ft</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Terrain/obstacle floor</div>
              <div className="font-semibold">{altFt(nav.altitude_selection.floor_ft)} ft</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Airspace ceiling</div>
              <div className="font-semibold">{altFt(nav.altitude_selection.airspace_ceiling_ft)} ft</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Freezing level</div>
              <div className="font-semibold">{altFt(nav.altitude_selection.freezing_level_ft)} ft</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Combined ceiling band</div>
              <div className="font-semibold">{altFt(nav.altitude_selection.band_ceiling_ft)} ft</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Forecast ceiling/visibility</div>
              <div className="font-semibold">
                {altFt(nav.altitude_selection.min_ceiling_ft)} ft, {nav.altitude_selection.min_visibility_sm ?? "—"} sm
                {nav.altitude_selection.weather_unavailable.includes("ceiling_visibility") ? (
                  <Badge className="ml-1 border-transparent bg-muted text-muted-foreground">unknown</Badge>
                ) : nav.altitude_selection.low_ceiling_or_visibility && (
                  <Badge className="ml-1 border-transparent bg-amber-100 text-amber-700">low</Badge>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Hazards along route</div>
              <div className="font-semibold">
                {nav.altitude_selection.hazards.length === 0 ? "none" : nav.altitude_selection.hazards.length}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Airspace transits</div>
              <div className="font-semibold">
                {nav.altitude_selection.airspace_transits.length === 0
                  ? "none" : nav.altitude_selection.airspace_transits.length}
              </div>
            </div>
            {nav.altitude_selection.airspace_transits.length > 0 && (
              <ul className="col-span-full mt-1 space-y-0.5 text-xs text-muted-foreground">
                {nav.altitude_selection.airspace_transits.map((t, i) => (
                  <li key={i}>
                    {t.name} (Class {t.class}), floor {altFt(t.floor_ft_msl)} ft, {t.along_track_nm} nm along route --
                    requires {t.requires}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Winds Aloft">
        {winds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No winds-aloft data available for this route.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {winds.map(w => `${deg(w.dir)}/${w.speed}kt`).join(", ")} at {altFt(nav?.altitude_ft)} ft
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="NOTAMs">
        <p className="text-sm text-muted-foreground">
          Not fetched here (the official FAA NOTAM API requires operator credentials) --
          check current NOTAMs directly before you fly:{" "}
          <a
            href="https://www.1800wxbrief.com" target="_blank" rel="noreferrer"
            className="text-blue-600 underline print:text-muted-foreground"
          >
            1800wxbrief.com
          </a>{" "}or{" "}
          <a
            href="https://notams.aim.faa.gov/notamSearch/" target="_blank" rel="noreferrer"
            className="text-blue-600 underline print:text-muted-foreground"
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
      <CollapsibleSection title="ATC Delays">
        <p className="text-sm text-muted-foreground">
          Not fetched here -- check current delays and flow-control advisories:{" "}
          <a
            href="https://www.fly.faa.gov" target="_blank" rel="noreferrer"
            className="text-blue-600 underline print:text-muted-foreground"
          >
            fly.faa.gov
          </a>.
        </p>
      </CollapsibleSection>

      <CollapsibleSection title="Airport Information">
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
    </div>
  );
}
