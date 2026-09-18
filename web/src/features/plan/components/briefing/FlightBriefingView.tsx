import { Fragment, useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import CollapsibleSection from "../../../../components/CollapsibleSection";
import SettingsButton from "../../../../components/SettingsButton";
import NavLogActions from "../navlog/NavLogActions";
import { ApiError, api } from "../../../../lib/api/client";
import type {
  Aircraft, Briefing, Candidate, Course, Leg, NavLog, Pilot, SaveFlightRequest, Totals,
} from "../../../../lib/api/types";
import { type Description, descriptionKey } from "../../hooks/usePlanState";
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
  /** Null while the fetch is still in flight or has failed -- both
   *  cases are reported through the floating status popup (the same
   *  place every other background fetch in this app reports), not
   *  inline here, so this page just renders nothing past Flight Plan
   *  Summary until it actually arrives. */
  briefing: Briefing | null;
  /** The spoken/read narrative -- generated on a pilot's own click
   *  (`onGenerateNarrative`), not automatically: every generation is a
   *  real, billed Claude call. Loading/error both surface through the
   *  floating status popup, the same as `briefing` itself. */
  narrative: string | null;
  loadingNarrative: boolean;
  onGenerateNarrative: () => void;
  /** Whether `window.speechSynthesis` is currently reading `narrative`
   *  aloud, and the one handler that starts/stops it -- owned by
   *  `usePlanState` (see its own `speak`/`stopSpeaking`), not local
   *  state here, since the Briefing Narrative section further down
   *  the page triggers the exact same playback and the two need to
   *  agree on whether it's currently running. */
  speaking: boolean;
  onListenClick: () => void;
  /** Leaves the briefing view, back to the map -- the one action
   *  `NavLogActions` needs that isn't already a `usePlanState` value
   *  passed straight through (it reuses `loadingNarrative`/`speaking`/
   *  `onListenClick` above for its own Listen button). */
  onMapClick: () => void;
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
    <table className="border-collapse text-right text-xs whitespace-nowrap">
      <thead>
        <tr className="border-b border-border">
          <th className="px-2 py-1 text-left">Waypoint</th>
          <th className="border-l border-border px-2 py-1">Alt</th>
          <th className="border-l border-border px-2 py-1">Dist</th>
          <th className="border-l border-border px-2 py-1">TC</th>
          <th className="border-l border-border px-2 py-1">Wind</th>
          <th className="border-l border-border px-2 py-1">WCA</th>
          <th className="border-l border-border px-2 py-1">TH</th>
          <th className="border-l border-border px-2 py-1">Var</th>
          <th className="border-l border-border px-2 py-1">MH</th>
          <th className="border-l border-border px-2 py-1">GS</th>
          <th className="border-l border-border px-2 py-1">ETE</th>
          <th className="border-l border-border px-2 py-1">Fuel</th>
        </tr>
      </thead>
      <tbody>
        {navError && (
          <tr><td className="px-2 py-1 text-left text-destructive" colSpan={12}>{navError}</td></tr>
        )}
        {!navError && selected.length === 0 && (
          <tr><td className="px-2 py-1 text-left text-muted-foreground" colSpan={12}>No route planned yet</td></tr>
        )}
        {selected.length > 0 && (
          <tr className="border-b border-border text-muted-foreground">
            <td className="px-2 py-1 text-left">{dep}</td>
            <td className="border-l border-border px-2 py-1">{altFt(depElevationFt)}</td>
            {Array.from({ length: 10 }, (_, i) => (
              <td key={i} className="border-l border-border px-2 py-1">—</td>
            ))}
          </tr>
        )}
        {waypoints.map(({ cp, name, leg }, i) => {
          const description = cp && descriptions[descriptionKey(cp.lat, cp.lon)];
          return (
            <Fragment key={i}>
              <tr className={clsx(!description && "border-b border-border", !leg?.wind && "text-muted-foreground")}>
                <td className="px-2 py-1 text-left">{name}</td>
                <td className="border-l border-border px-2 py-1">{altFt(cp ? nav?.altitude_ft : destElevationFt)}</td>
                <td className="border-l border-border px-2 py-1">{leg ? leg.distance_nm.toFixed(1) : "—"}</td>
                <td className="border-l border-border px-2 py-1">{leg ? deg(leg.true_course_deg) : "—"}</td>
                <td className="border-l border-border px-2 py-1">{leg
                  ? (leg.wind ? `${deg(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)}` : "no data")
                  : "—"}</td>
                <td className="border-l border-border px-2 py-1">{leg ? signed(leg.wca_deg) : "—"}</td>
                <td className="border-l border-border px-2 py-1">{leg ? deg(leg.true_heading_deg) : "—"}</td>
                <td className="border-l border-border px-2 py-1">{leg ? signed(leg.magnetic_variation_deg) : "—"}</td>
                <td className="border-l border-border px-2 py-1">{leg ? deg(leg.magnetic_heading_deg) : "—"}</td>
                <td className="border-l border-border px-2 py-1">
                  {leg ? (leg.groundspeed_kt === null ? "—" : Math.round(leg.groundspeed_kt)) : "—"}
                </td>
                <td className="border-l border-border px-2 py-1">
                  {leg ? (leg.ete_min === null ? "unflyable" : one(leg.ete_min)) : "—"}
                </td>
                <td className="border-l border-border px-2 py-1">{leg ? one(leg.fuel_gal) : "—"}</td>
              </tr>
              {/* Copied over from the sidebar's own nav log, read-only --
                  a pilot's typed (or generated) "how to spot it" note is
                  worth having on the printed page, but isn't editable
                  here: this page is a document to hand over or print,
                  not the workspace that note was written in. */}
              {description && description.text && (
                <tr className="border-b border-border">
                  {/* pl-6, not px-2 like the waypoint cell above it --
                      indented so it reads as that row's own note, not
                      another row at the same level. */}
                  <td colSpan={12} className="bg-muted/60 py-1 pl-6 pr-2 text-left whitespace-normal italic text-muted-foreground">
                    {description.text}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The narrative's own text, print only. On screen it lives in
 * `NavLogActions`' own `Popover` instead (next to the buttons that
 * produce it, in the header, not a scroll away) -- but a closed
 * Popover renders nothing, so a printed copy needs its own text
 * sitting directly in the page. Same `hidden print:block` pattern this
 * page's own title uses just above, for the same reason.
 * `window.speechSynthesis` rather than a cloud voice, for now -- free,
 * no new service, no API key; a more natural-sounding voice is a later
 * upgrade, not a blocker for having this at all.
 */
function BriefingNarrativePrintBlock({ narrative }: { narrative: string | null }) {
  if (!narrative) return null;
  return (
    <div className="hidden break-inside-avoid-page border-b border-border px-4 py-3 print:block print:break-inside-avoid">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Briefing Narrative</h2>
      <p className="mt-2 text-sm text-muted-foreground">{narrative}</p>
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
 * it, separate from (and before) the adverse-conditions/current/
 * forecast detail a pilot would have to read closely to reach the same
 * conclusion themselves. Computed from data this page already has --
 * either endpoint's current METAR reporting IFR/LIFR, or the along-
 * route forecast dropping below basic VFR minimums (14 CFR 91.155:
 * 3 sm visibility, 1,000 ft ceiling) -- not a second fetch.
 */
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
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    api.flights.save({
      aircraftId: aircraftId ? Number(aircraftId) : null,
      routeId: null,
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
        setError(err instanceof ApiError ? err.message : "could not save this flight");
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
      {error && <span className="text-destructive">{error}</span>}
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
  briefing, narrative, loadingNarrative, onGenerateNarrative, speaking, onListenClick, onMapClick,
}: Props) {
  const parts = totals ? totalsParts(totals) : null;
  const winds = windsAloftSummary(legs);
  const vnrReasons = briefing ? vfrNotRecommendedReasons(briefing, dep, dest) : [];

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
      document.querySelectorAll<HTMLDetailsElement>("details").forEach(d => {
        openBeforePrint.set(d, d.open);
        d.open = true;
      });
    };
    const afterPrint = () => {
      document.querySelectorAll<HTMLDetailsElement>("details").forEach(d => {
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

  return (
    <div className="h-full overflow-y-auto bg-background print:h-auto print:overflow-visible">
      {/* A real <header>, not a <div> -- this is exactly what the map
          view's own `mapHeader` (PlanView) is, just this page's own
          version of it. On screen, "Back to Map" replaces the old
          "Flight Briefing" title entirely -- one clear way back, not
          two (this button and NavLogActions' own Map icon used to say
          the same thing twice). The title itself doesn't disappear,
          it's just print-only now: a printed page has no "back"
          anywhere to go, but still needs its own identifying title,
          which is why this is the one thing here that inverts the
          usual print:hidden -- hidden on screen, the only thing left
          once actually printed. */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="hidden print:block">
          <h1 className="text-lg font-bold tracking-tight text-foreground">Flight Briefing</h1>
          <p className="text-sm text-muted-foreground">{dep} → {dest}</p>
        </div>
        <Button
          variant="ghost" size="sm" onClick={onMapClick}
          className="print:hidden" data-testid="nav-back-to-map-button"
        >
          <ArrowLeft className="size-4" />
          Back to Map
        </Button>
        <div className="flex items-center gap-1 print:hidden">
          <NavLogActions
            onGenerateNarrative={onGenerateNarrative}
            narrativeLoading={loadingNarrative}
            hasNarrative={narrative !== null}
            narrative={narrative}
            onListenClick={onListenClick}
            listening={speaking}
          />
          <SettingsButton />
        </div>
      </header>

      {/* Its own standard element (AIM 7-1-5(b)), stated up front and
          impossible to collapse away by accident -- not one more
          CollapsibleSection a pilot might skim past, the way a live
          briefer states it out loud before working through the detail
          that justifies it. */}
      {vnrReasons.length > 0 && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <p className="font-semibold">VFR flight not recommended</p>
          <ul className="mt-0.5 list-inside list-disc">
            {vnrReasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}

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
      <BriefingNarrativePrintBlock narrative={narrative} />

      <CollapsibleSection title="Adverse Conditions">
        {!briefing ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
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
        {!briefing ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
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
          <p className="text-sm text-muted-foreground">Loading…</p>
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
          <p className="text-sm text-muted-foreground">Loading…</p>
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
          <p className="text-sm text-muted-foreground">Loading…</p>
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
