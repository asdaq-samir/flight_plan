import { Fragment, useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import CollapsibleSection from "../../../../components/CollapsibleSection";
import { FIELD_INPUT } from "../../../../components/fieldInput";
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
        <tr className="border-b border-slate-200">
          <th className="px-2 py-1 text-left">Waypoint</th>
          <th className="border-l border-slate-200 px-2 py-1">Alt</th>
          <th className="border-l border-slate-200 px-2 py-1">Dist</th>
          <th className="border-l border-slate-200 px-2 py-1">TC</th>
          <th className="border-l border-slate-200 px-2 py-1">Wind</th>
          <th className="border-l border-slate-200 px-2 py-1">WCA</th>
          <th className="border-l border-slate-200 px-2 py-1">TH</th>
          <th className="border-l border-slate-200 px-2 py-1">Var</th>
          <th className="border-l border-slate-200 px-2 py-1">MH</th>
          <th className="border-l border-slate-200 px-2 py-1">GS</th>
          <th className="border-l border-slate-200 px-2 py-1">ETE</th>
          <th className="border-l border-slate-200 px-2 py-1">Fuel</th>
        </tr>
      </thead>
      <tbody>
        {navError && (
          <tr><td className="px-2 py-1 text-left text-red-600" colSpan={12}>{navError}</td></tr>
        )}
        {!navError && selected.length === 0 && (
          <tr><td className="px-2 py-1 text-left text-slate-500" colSpan={12}>No route planned yet</td></tr>
        )}
        {selected.length > 0 && (
          <tr className="border-b border-slate-100 text-slate-400">
            <td className="px-2 py-1 text-left">{dep}</td>
            <td className="border-l border-slate-200 px-2 py-1">{altFt(depElevationFt)}</td>
            {Array.from({ length: 10 }, (_, i) => (
              <td key={i} className="border-l border-slate-200 px-2 py-1">—</td>
            ))}
          </tr>
        )}
        {waypoints.map(({ cp, name, leg }, i) => {
          const description = cp && descriptions[descriptionKey(cp.lat, cp.lon)];
          return (
            <Fragment key={i}>
              <tr className={clsx(!description && "border-b border-slate-100", !leg?.wind && "text-slate-400")}>
                <td className="px-2 py-1 text-left">{name}</td>
                <td className="border-l border-slate-200 px-2 py-1">{altFt(cp ? nav?.altitude_ft : destElevationFt)}</td>
                <td className="border-l border-slate-200 px-2 py-1">{leg ? leg.distance_nm.toFixed(1) : "—"}</td>
                <td className="border-l border-slate-200 px-2 py-1">{leg ? deg(leg.true_course_deg) : "—"}</td>
                <td className="border-l border-slate-200 px-2 py-1">{leg
                  ? (leg.wind ? `${deg(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)}` : "no data")
                  : "—"}</td>
                <td className="border-l border-slate-200 px-2 py-1">{leg ? signed(leg.wca_deg) : "—"}</td>
                <td className="border-l border-slate-200 px-2 py-1">{leg ? deg(leg.true_heading_deg) : "—"}</td>
                <td className="border-l border-slate-200 px-2 py-1">{leg ? signed(leg.magnetic_variation_deg) : "—"}</td>
                <td className="border-l border-slate-200 px-2 py-1">{leg ? deg(leg.magnetic_heading_deg) : "—"}</td>
                <td className="border-l border-slate-200 px-2 py-1">
                  {leg ? (leg.groundspeed_kt === null ? "—" : Math.round(leg.groundspeed_kt)) : "—"}
                </td>
                <td className="border-l border-slate-200 px-2 py-1">
                  {leg ? (leg.ete_min === null ? "unflyable" : one(leg.ete_min)) : "—"}
                </td>
                <td className="border-l border-slate-200 px-2 py-1">{leg ? one(leg.fuel_gal) : "—"}</td>
              </tr>
              {/* Copied over from the sidebar's own nav log, read-only --
                  a pilot's typed (or generated) "how to spot it" note is
                  worth having on the printed page, but isn't editable
                  here: this page is a document to hand over or print,
                  not the workspace that note was written in. */}
              {description && description.text && (
                <tr className="border-b border-slate-100">
                  {/* pl-6, not px-2 like the waypoint cell above it --
                      indented so it reads as that row's own note, not
                      another row at the same level. */}
                  <td colSpan={12} className="bg-slate-50/60 py-1 pl-6 pr-2 text-left whitespace-normal italic text-slate-500">
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
 * The narrative's own section: a "Generate" button until one exists,
 * then the text plus a browser-TTS "Listen" toggle. `window.speechSynthesis`
 * rather than a cloud voice, for now -- free, no new service, no API
 * key; a more natural-sounding voice is a later upgrade, not a
 * blocker for having this at all.
 */
function BriefingNarrativeSection({
  narrative, loadingNarrative, onGenerate,
}: {
  narrative: string | null;
  loadingNarrative: boolean;
  onGenerate: () => void;
}) {
  const [speaking, setSpeaking] = useState(false);

  // Leaving the briefing page (or the browser tab going elsewhere)
  // shouldn't leave a voice talking to an empty room.
  useEffect(() => () => window.speechSynthesis.cancel(), []);

  const toggleSpeak = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    if (!narrative) return;
    const utterance = new SpeechSynthesisUtterance(narrative);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  return (
    <CollapsibleSection title="Briefing Narrative">
      {!narrative && (
        <Button onClick={onGenerate} disabled={loadingNarrative} className="print:hidden">
          {loadingNarrative ? "Generating…" : "Generate narrative"}
        </Button>
      )}
      {narrative && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">{narrative}</p>
          <Button onClick={toggleSpeak} className="print:hidden">{speaking ? "Stop" : "Listen"}</Button>
        </div>
      )}
    </CollapsibleSection>
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
      <select
        value={aircraftId} onChange={e => setAircraftId(e.target.value)}
        aria-label="Aircraft flown" className={FIELD_INPUT}
      >
        <option value="">No aircraft on file</option>
        {aircraftList.map(a => <option key={a.id} value={a.id}>{a.tailNumber}</option>)}
      </select>
      <Button onClick={save} disabled={status === "saving" || !course}>
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Save this flight"}
      </Button>
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}

/**
 * The Flight Briefing page: the FAA's own standard-briefing sequence
 * (AIM/FAA-H-8083-25) -- adverse conditions, current conditions,
 * forecast, winds aloft, NOTAMs, airport information -- around the
 * nav log, laid out to print cleanly. Two pieces of that sequence are
 * deliberately absent rather than faked: a synoptic narrative (needs
 * real meteorological analysis, not a data fetch) and embedded NOTAMs
 * (the official FAA NOTAM API is gated to certain commercial/public
 * operators via emailed credentials -- this links out to a real
 * briefing service instead).
 */
export default function FlightBriefingView({
  course, totals, nav, legs, navError, dep, dest, selected, depElevationFt, destElevationFt, descriptions,
  briefing, narrative, loadingNarrative, onGenerateNarrative,
}: Props) {
  const parts = totals ? totalsParts(totals) : null;
  const winds = windsAloftSummary(legs);

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
    <div className="h-full overflow-y-auto bg-white print:h-auto print:overflow-visible">
      <div className="border-b border-slate-200 px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight text-slate-900">Flight Briefing</h1>
        <p className="text-sm text-slate-500">{dep} → {dest}</p>
      </div>

      <CollapsibleSection title="Flight Plan Summary">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-400">Route</div>
            <div className="font-semibold">{course?.departure.ident} → {course?.destination.ident}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Distance</div>
            <div className="font-semibold">{course ? `${course.distance_nm} nm, ${deg(course.bearing_deg)}` : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Altitude</div>
            <div className="font-semibold">
              {nav ? `${altFt(nav.altitude_ft)} ft ${nav.altitude_selection ? "(auto)" : "(set)"}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Aircraft</div>
            <div className="font-semibold">{nav?.aircraft.name ?? "—"}</div>
          </div>
          {parts && (
            <>
              <div>
                <div className="text-xs text-slate-400">Total time</div>
                <div className="font-semibold">{parts.time}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Fuel</div>
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
      <BriefingNarrativeSection
        narrative={narrative} loadingNarrative={loadingNarrative} onGenerate={onGenerateNarrative}
      />

      <CollapsibleSection title="Adverse Conditions">
        {!briefing ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : briefing.hazards.length === 0 ? (
          <p className="text-sm text-slate-600">No SIGMETs or AIRMETs reported along this route.</p>
        ) : (
          <ul className="space-y-2">
            {briefing.hazards.map((h, i) => (
              <li key={i} className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm">
                <div className="font-semibold text-amber-800">
                  {h.hazard ?? h.type ?? "Hazard"}
                  {hazardAltitudeRange(h.altitude_low_ft, h.altitude_high_ft) &&
                    ` — ${hazardAltitudeRange(h.altitude_low_ft, h.altitude_high_ft)}`}
                </div>
                {h.raw && <div className="mt-0.5 whitespace-pre-wrap font-mono text-xs text-slate-600">{h.raw}</div>}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Current Conditions">
        {!briefing ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {[dep, dest].map(ident => {
              const metar = briefing.metars[ident];
              return (
                <div key={ident} className="rounded border border-slate-200 px-2 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{ident}</span>
                    {metar?.flight_category && (
                      <Badge style={{ backgroundColor: FLIGHT_CATEGORY_COLOR[metar.flight_category] ?? "#5b6b76", color: "white" }}>
                        {metar.flight_category}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap font-mono text-xs text-slate-600">
                    {metar?.raw ?? "No current report available."}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Forecast">
        {!briefing ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Along the route: ceiling {altFt(briefing.forecast.min_ceiling_ft)} ft,
              visibility {briefing.forecast.min_visibility_sm ?? "—"} sm (worst nearby TAF period).
            </p>
            {briefing.forecast.stations.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                {briefing.forecast.stations.map(st => (
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
          <p className="text-sm text-slate-600">No winds-aloft data available for this route.</p>
        ) : (
          <p className="text-sm text-slate-600">
            {winds.map(w => `${deg(w.dir)}/${w.speed}kt`).join(", ")} at {altFt(nav?.altitude_ft)} ft
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="NOTAMs">
        <p className="text-sm text-slate-600">
          Not fetched here (the official FAA NOTAM API requires operator credentials) --
          check current NOTAMs directly before you fly:{" "}
          <a
            href="https://www.1800wxbrief.com" target="_blank" rel="noreferrer"
            className="text-blue-600 underline print:text-slate-600"
          >
            1800wxbrief.com
          </a>{" "}or{" "}
          <a
            href="https://notams.aim.faa.gov/notamSearch/" target="_blank" rel="noreferrer"
            className="text-blue-600 underline print:text-slate-600"
          >
            notams.aim.faa.gov
          </a>.
        </p>
      </CollapsibleSection>

      <CollapsibleSection title="Airport Information">
        {!briefing ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {[dep, dest].map(ident => {
              const info = briefing.airports[ident];
              return (
                <div key={ident} className="rounded border border-slate-200 px-2 py-1.5 text-sm">
                  <div className="mb-1 font-semibold">{ident}</div>
                  {info?.frequencies.length ? (
                    <ul className="space-y-0.5">
                      {info.frequencies.map((f, i) => (
                        <li key={i} className="text-slate-600">
                          {f.type ?? "—"}{f.description ? ` (${f.description})` : ""}: {f.frequency_mhz ?? "—"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-500">No published frequencies.</p>
                  )}
                  {info?.runways.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {info.runways.map((r, i) => (
                        <li key={i} className="text-slate-600">
                          {r.ends ?? "—"}: {r.length_ft ?? "—"}×{r.width_ft ?? "—"} ft, {r.surface ?? "unknown surface"}
                          {r.lighted ? ", lighted" : ""}{r.closed ? " (closed)" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-500">No published runway data.</p>
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
