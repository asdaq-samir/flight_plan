import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { identSchema } from "../../lib/identSchema";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling. Imported here (not in main.tsx) so Home/Playground/
// Account, which never touch a map, don't pay for it.
import "leaflet/dist/leaflet.css";
import Shell from "../../Shell";
import CollapsibleToolbar from "../../components/CollapsibleToolbar";
import MapActionButton from "../../components/MapActionButton";
import { usePageStatus } from "../../lib/usePageStatus";
import type { Candidate } from "../../lib/api/types";
import RouteMap from "./components/RouteMap";
import RouteForm from "./components/RouteForm";
import BuildNotice from "./components/BuildNotice";
import NavLogActions from "./components/navlog/NavLogActions";
import NavLogView from "./components/navlog/NavLogView";
import FlightBriefingView from "./components/briefing/FlightBriefingView";
import ScoreLegend from "./components/ScoreLegend";
import { summary } from "./format";
import { usePlanState } from "./hooks/usePlanState";
import { useDocumentTitle } from "../../lib/useDocumentTitle";

// The three stages a plan actually goes through, in order -- there's
// no finer-grained number to report while one of them is running, so
// the status popup shows progress as "whichever of these three just
// finished," not a truly continuous percentage.
const STAGE_PERCENT: Record<"course" | "checkpoints" | "navlog", number> = {
  course: 25, checkpoints: 60, navlog: 90,
};

/**
 * The planner: two idents in, a charted course with checkpoints and a
 * dead-reckoning nav log out.
 *
 * Everything on screen is derived from the store on each render, which is
 * the difference that matters from the page this replaces. That one kept
 * `data` as a mutable object and re-ran whichever render function the
 * author remembered -- and the checkpoint rows had to be drawn a second
 * time by hand once the legs arrived, because nothing recomputed them.
 */
export default function PlanView() {
  useDocumentTitle("Plan a route — VFR Route");
  const s = usePlanState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dep, setDep] = useState(searchParams.get("dep")?.toUpperCase() ?? "");
  const [dest, setDest] = useState(searchParams.get("dest")?.toUpperCase() ?? "");
  const [alt, setAlt] = useState(searchParams.get("altitude_ft") ?? "");
  const controls = useRef<{ fit: () => void; toggleBasemap: () => string } | null>(null);
  // A stable identity, not an inline arrow at the RouteMap call site --
  // that map's own course-load effect lists onReady as a dependency,
  // and a fresh function every render would re-run it (tearing down and
  // rebuilding every map layer) on every unrelated PlanView re-render,
  // not just when the course actually changes.
  const handleMapReady = useCallback((c: { fit: () => void; toggleBasemap: () => string }) => {
    controls.current = c;
  }, []);
  const started = useRef(false);
  // The "Flight Briefing" full-page view (a wider, print-styled swap
  // of the same NavLogView the sidebar already shows) replaces the
  // map itself, the way the old "nav log" tab did -- deliberate,
  // print/handoff-focused, not the everyday map+sidebar experience.
  // RouteMap unmounts (and its Leaflet instance is torn down) whenever
  // this is true, so `controls` is only ever called while it's
  // actually mounted -- see the keyboard shortcuts below.
  const [showBriefing, setShowBriefing] = useState(false);
  // The Guide panel sits in the same bottom-right corner the sidebar
  // opens over -- hide it once the sidebar's open at all, rather than
  // let it float on top of the nav log.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The pilot's own opt-in for the per-checkpoint LLM descriptions --
  // off by default, since each generation is a real API call and
  // the nav log is visible (in the sidebar) from the moment a route's
  // checkpoints are scored, well before a pilot's asked for one.
  const [showDescriptions, setShowDescriptions] = useState(false);

  // Open on whatever corridor exists, so the page is never an empty form
  // with no hint of what it accepts.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const routes = await s.loadRoutes();
      const first = routes[0] ?? { departure_ident: "C81", destination_ident: "KDLH" };
      const d = searchParams.get("dep")?.toUpperCase() || first.departure_ident;
      const a = searchParams.get("dest")?.toUpperCase() || first.destination_ident;
      setDep(d);
      setDest(a);
      void s.plan(d, a, searchParams.get("altitude_ft") ?? undefined);
    })();
    // started.current makes this genuinely run-once on mount regardless
    // of the deps array below; s.loadRoutes/s.plan/searchParams are
    // still listed (loadRoutes/plan are stable, []-deps callbacks in
    // usePlanState; searchParams only matters at this first read) so a
    // future refactor wouldn't silently go stale here undetected.
  }, [s.loadRoutes, s.plan, searchParams]);

  // The nav log (and so the description stream) is always visible in
  // the sidebar now, not opened by a click -- so a fresh route's own
  // checkpoints arriving is what has to (re)start the stream for a
  // pilot who already has the checkbox on, the same restart `openNavLog`
  // used to trigger by hand. describeCheckpoints is a no-op for a
  // route it's already running (or finished) for, so this firing again
  // on every unrelated re-render costs nothing.
  useEffect(() => {
    if (showDescriptions && s.selected.length > 0) {
      void s.describeCheckpoints(dep, dest, alt.trim() || undefined);
    }
  }, [s.selected, showDescriptions, dep, dest, alt, s.describeCheckpoints]);

  // The briefing's own data (hazards, METAR, forecast, runways/
  // frequencies) is only worth fetching once a pilot actually opens
  // the Flight Briefing page -- not on every plan(), which is why this
  // is a separate effect from the course/checkpoints/navlog load above.
  useEffect(() => {
    if (showBriefing && dep && dest) void s.loadBriefing(dep, dest);
  }, [showBriefing, dep, dest, s.loadBriefing]);

  // The checkbox's own handler: flips the preference and actually
  // starts/stops the stream to match, rather than just changing what
  // gets displayed -- "turn it off" should mean the calls stop, not
  // only that the text is hidden.
  const toggleShowDescriptions = useCallback((checked: boolean) => {
    setShowDescriptions(checked);
    if (checked) void s.describeCheckpoints(dep, dest, alt.trim() || undefined);
    else s.stopDescribing();
  }, [dep, dest, alt, s.describeCheckpoints, s.stopDescribing]);

  const submit = useCallback(() => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a || d === a) return;
    const next: Record<string, string> = { dep: d, dest: a };
    if (alt.trim()) next.altitude_ft = alt.trim();
    setSearchParams(next, { replace: true });
    void s.plan(d, a, alt.trim() || undefined);
  }, [dep, dest, alt, s.plan, setSearchParams]);

  // Shortcuts, skipped while an ident is being typed -- or, just as
  // much, while a checkpoint description is: that field is a
  // <textarea>, not an <input>, and typing a plain "n" into one used
  // to flip straight to the Flight Briefing page mid-sentence.
  // `f`/`t` only mean anything while the map is actually mounted --
  // RouteMap's own Leaflet instance is torn down when the briefing
  // page replaces it, and `controls` would otherwise be calling into a
  // destroyed map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "n") setShowBriefing(b => !b);
      if (e.key === "a") s.toggleCandidates();
      if (!showBriefing && e.key === "f") controls.current?.fit();
      if (!showBriefing && e.key === "t") controls.current?.toggleBasemap();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showBriefing]);

  // The map's own half of point selection -- clicking a checkpoint
  // marker focuses the same point the matching nav log row would.
  const selectCandidate = useCallback(
    (c: Candidate) => s.selectPoint({ lat: c.lat, lon: c.lon }),
    [s.selectPoint],
  );

  const toolbar = (
    <CollapsibleToolbar
      title="VFR planner"
      label={dep && dest ? `Route: ${dep} → ${dest}` : "Route"}
    >
      <RouteForm
        dep={dep} dest={dest} alt={alt}
        onDepChange={setDep} onDestChange={setDest} onAltChange={setAlt}
        onSubmit={submit}
        disabled={s.stage !== null}
        routes={s.routes}
        summary={s.stage === "course"
          ? "drawing course…"
          : summary(s.course?.distance_nm ?? null, s.candidates.length, s.selected.length)}
      />
    </CollapsibleToolbar>
  );

  // The nav log's own stage (scoring, altitude selection, the live
  // aviationweather.gov fetch) takes priority over the plan's bare
  // percentage and the checkpoint description count while it's
  // running -- all three are the same floating status, never two at
  // once. The Flight Briefing page's own fetch goes first: it's the
  // only thing that can be running while that page is open (the other
  // three are all map-view stages), and it's the reason this floating
  // popup -- not an inline line in the page body -- is how the
  // briefing shows "Loading briefing…" too, the same as every other
  // background fetch in this app.
  const progress = (s.loadingBriefing ? "Loading briefing…" : null)
    ?? (s.loadingNarrative ? "Generating narrative…" : null)
    ?? s.navStage
    ?? (s.stage ? `Planning… ${STAGE_PERCENT[s.stage]}%` : null)
    ?? (s.descriptionProgress ? `Generating ${s.descriptionProgress.done}/${s.descriptionProgress.total}` : null);
  const briefingErrorMsg = s.briefingError && `Couldn't load the briefing: ${s.briefingError}`;
  const narrativeErrorMsg = s.narrativeError && `Couldn't generate the narrative: ${s.narrativeError}`;
  const descError = s.descriptionError && `Couldn't generate checkpoint descriptions: ${s.descriptionError}`;
  const error = s.error ?? (briefingErrorMsg || narrativeErrorMsg || descError || null);
  usePageStatus(progress, error);

  const mapOverlay = !showBriefing ? (
    <>
      {!sidebarOpen && <ScoreLegend />}
      <MapActionButton onClick={() => setShowBriefing(true)} disabled={!s.course}>
        Flight Briefing
      </MapActionButton>
    </>
  ) : (
    <NavLogActions onMapClick={() => setShowBriefing(false)} />
  );

  const navLog = (
    <NavLogView
      totals={s.totals} nav={s.nav} legs={s.legs} navError={s.navError}
      dep={dep} dest={dest}
      depLat={s.course?.departure.lat ?? 0} depLon={s.course?.departure.lon ?? 0}
      destLat={s.course?.destination.lat ?? 0} destLon={s.course?.destination.lon ?? 0}
      selected={s.selected}
      depElevationFt={s.course?.departure.elevation_ft ?? null}
      destElevationFt={s.course?.destination.elevation_ft ?? null}
      descriptions={s.descriptions}
      onSaveDescription={(lat, lon, text) => s.saveDescription(dep, dest, lat, lon, text)}
      showDescriptions={showDescriptions} onToggleShowDescriptions={toggleShowDescriptions}
      selectedPoint={s.selectedPoint} onSelectPoint={(lat, lon) => s.selectPoint({ lat, lon })}
    />
  );

  return (
    <>
      {s.needsBuild && (
        <BuildNotice
          dep={s.needsBuild.dep} dest={s.needsBuild.dest} building={s.building}
          onBuild={() => void s.build(s.needsBuild!.dep, s.needsBuild!.dest)}
        />
      )}
      <Shell
        toolbar={showBriefing ? null : toolbar}
        mapOverlay={mapOverlay}
        onSidebarOpenChange={setSidebarOpen}
        map={
          <div className="h-full w-full">
            {showBriefing ? (
              <FlightBriefingView
                course={s.course} totals={s.totals} nav={s.nav} legs={s.legs} navError={s.navError}
                dep={dep} dest={dest} selected={s.selected}
                depElevationFt={s.course?.departure.elevation_ft ?? null}
                destElevationFt={s.course?.destination.elevation_ft ?? null}
                descriptions={s.descriptions}
                briefing={s.briefing}
                narrative={s.narrative} loadingNarrative={s.loadingNarrative}
                onGenerateNarrative={() => void s.loadNarrative(dep, dest)}
              />
            ) : (
              <RouteMap
                course={s.course}
                candidates={s.candidates}
                selected={s.selected}
                showCandidates={s.showCandidates}
                focus={s.selectedPoint}
                onSelectCandidate={selectCandidate}
                onReady={handleMapReady}
              />
            )}
          </div>
        }
        sidebar={showBriefing ? null : navLog}
      />
    </>
  );
}
