import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Settings } from "lucide-react";
import { identSchema } from "../../lib/identSchema";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling. Imported here (not in main.tsx) so Settings, which
// never touches a map, doesn't pay for it.
import "leaflet/dist/leaflet.css";
import Shell from "../../Shell";
import { Button } from "../../components/ui/button";
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
  //
  // Driven by the URL (?view=briefing) rather than its own useState --
  // this is what makes leaving the view (the briefing header's own
  // "back to map" button, see `briefingHeader` below) an actual
  // navigation, not just a prop flip, so a browser back/forward or a
  // pasted link lands on the right one of the two.
  const showBriefing = searchParams.get("view") === "briefing";
  const setBriefingView = useCallback((open: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (open) next.set("view", "briefing");
      else next.delete("view");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
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
      if (e.key === "n") setBriefingView(!showBriefing);
      if (e.key === "a") s.toggleCandidates();
      if (!showBriefing && e.key === "f") controls.current?.fit();
      if (!showBriefing && e.key === "t") controls.current?.toggleBasemap();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showBriefing, setBriefingView]);

  // The map's own half of point selection -- clicking a checkpoint
  // marker focuses the same point the matching nav log row would.
  const selectCandidate = useCallback(
    (c: Candidate) => s.selectPoint({ lat: c.lat, lon: c.lon }),
    [s.selectPoint],
  );

  const settingsButton = (
    <Button asChild variant="ghost" size="icon" aria-label="Settings" className="shrink-0">
      <Link to="/settings">
        <Settings className="size-4" />
      </Link>
    </Button>
  );

  // Generates the narrative if none exists yet, then reads it aloud
  // the moment it's ready; toggles playback if one's already
  // generated. The one handler both the briefing header's own Listen
  // button and the Briefing Narrative section's own "Listen" button
  // call, so triggering it from either place leaves the other in
  // agreement.
  const handleListenClick = async () => {
    if (s.speaking) { s.stopSpeaking(); return; }
    if (s.narrative) { s.speak(s.narrative); return; }
    const text = await s.loadNarrative(dep, dest);
    if (text) s.speak(text);
  };

  // Folds PageHeader's own row and the old separate toolbar row into
  // one -- the route form, not "VFR Route," is this page's actual
  // title: the thing a pilot is here to use, not a settings drawer or
  // a brand mark worth a whole line of their own.
  const mapHeader = (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-background px-4 py-2 print:hidden">
      <RouteForm
        dep={dep} dest={dest} alt={alt}
        onDepChange={setDep} onDestChange={setDest} onAltChange={setAlt}
        onSubmit={submit}
        disabled={s.stage !== null}
        routes={s.routes}
        summary={s.stage === "course" ? "drawing course…" : summary(s.course?.distance_nm ?? null, s.selected.length)}
        onOpenBriefing={() => setBriefingView(true)}
        briefingDisabled={!s.course}
      />
      {settingsButton}
    </header>
  );

  // The briefing view's own header, in place of both PageHeader (the
  // "VFR Route" wordmark reads oddly once the page is already telling
  // you which document you're looking at) and NavLogActions' old
  // floating position over the content -- one row, not two. No label
  // of its own, unlike `mapHeader` -- the content immediately below
  // already opens with "Flight Briefing" as a real `<h1>` (see
  // FlightBriefingView), so repeating it here would just be the same
  // word twice in a row; this row is purely its own actions (back to
  // map, listen, print) beside the same Settings gear every header
  // ends in.
  const briefingHeader = (
    <header className="flex h-12 shrink-0 items-center justify-end gap-1 border-b border-border bg-background px-4 print:hidden">
      <div className="flex items-center gap-1">
        <NavLogActions
          onMapClick={() => setBriefingView(false)}
          onListenClick={() => void handleListenClick()}
          listenLoading={s.loadingNarrative}
          listening={s.speaking}
        />
        {settingsButton}
      </div>
    </header>
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
  // The briefing sub-view has no toolbar row to clear (Shell's own
  // toolbar prop is null there) but does have real, clickable content
  // starting right at the top -- bottom-center is the one position
  // safe on that view, the same way top-center (the default) is safe
  // on the map view's own toolbar-having layout.
  usePageStatus(progress, error, showBriefing ? "bottom-center" : undefined);

  // No more overlay while looking at the briefing -- its own actions
  // moved into `briefingHeader` above, in flow rather than floating
  // over the content. "Flight Briefing" itself lives in `mapHeader`
  // now too, next to "Chart" (see RouteForm's own comment) rather than
  // floating bottom-left the way this page's single most-needed action
  // otherwise would -- Chart already is that.
  const mapOverlay = showBriefing ? null : !sidebarOpen && <ScoreLegend />;

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
        header={showBriefing ? briefingHeader : mapHeader}
        toolbar={null}
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
                speaking={s.speaking} onListenClick={() => void handleListenClick()}
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
