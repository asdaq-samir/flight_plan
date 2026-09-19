import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ZoomIn, ZoomOut } from "lucide-react";
import { identSchema } from "../../lib/identSchema";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling. Imported here (not in main.tsx) so Settings, which
// never touches a map, doesn't pay for it.
import "leaflet/dist/leaflet.css";
import Shell from "../../Shell";
import SettingsButton from "../../components/SettingsButton";
import SidebarToggleButton from "../../components/SidebarToggleButton";
import TwoRowHeader from "../../components/TwoRowHeader";
import { Button } from "../../components/ui/button";
import { TabsTrigger } from "../../components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { usePageStatus } from "../../lib/usePageStatus";
import type { Candidate } from "../../lib/api/types";
import RouteMap from "./components/RouteMap";
import RouteForm from "./components/RouteForm";
import BuildNotice from "./components/BuildNotice";
import NavLogView from "./components/navlog/NavLogView";
import NavLogActions from "./components/navlog/NavLogActions";
import FlightBriefingView from "./components/briefing/FlightBriefingView";
import ScoreLegend from "./components/ScoreLegend";
import { usePlanState, descriptionKey } from "./hooks/usePlanState";
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
  // this is what makes leaving the view (FlightBriefingView's own
  // "back to map" button, in its title panel) an actual navigation,
  // not just a prop flip, so a browser back/forward or a pasted link
  // lands on the right one of the two.
  const showBriefing = searchParams.get("view") === "briefing";
  const setBriefingView = useCallback((open: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (open) next.set("view", "briefing");
      else next.delete("view");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  // The nav log's own width toggle -- off by default, since the
  // narrower sidebar is the right tradeoff against the map for
  // everyday use, and only the table's own twelve columns ever need
  // the wider, scroll-free view a pilot opts into.
  const [navLogExpanded, setNavLogExpanded] = useState(false);
  // The nav log sidebar's own open state -- lifted here rather than
  // owned by Shell (a Context this app no longer has, see Shell's own
  // comment) since the button that toggles it lives in this page's own
  // header, a sibling of Shell rather than something inside it.
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  // The briefing's own data (hazards, METAR, forecast, runways/
  // frequencies) is only worth fetching once a pilot actually opens
  // the Flight Briefing page -- not on every plan(), which is why this
  // is a separate effect from the course/checkpoints/navlog load above.
  useEffect(() => {
    if (showBriefing && dep && dest) void s.loadBriefing(dep, dest);
  }, [showBriefing, dep, dest, s.loadBriefing]);

  // The nav log's AI button: a pilot-triggered "generate now" for
  // every checkpoint's description at once. Descriptions are visible
  // (and editable) in every row regardless of whether this has ever
  // been clicked -- this just fills the blank ones in, and
  // describeCheckpoints is already a no-op for a route it's running
  // (or finished) for, so a second click before the first finishes
  // costs nothing.
  const generateDescriptions = useCallback(() => {
    void s.describeCheckpoints(dep, dest, alt.trim() || undefined);
  }, [dep, dest, alt, s.describeCheckpoints]);

  const submit = useCallback(() => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a || d === a) return;
    const next: Record<string, string> = { dep: d, dest: a };
    if (alt.trim()) next.altitude_ft = alt.trim();
    setSearchParams(next, { replace: true });
    void s.plan(d, a, alt.trim() || undefined);
  }, [dep, dest, alt, s.plan, setSearchParams]);

  // The map's own half of point selection -- clicking a checkpoint
  // marker focuses the same point the matching nav log row would.
  const selectCandidate = useCallback(
    (c: Candidate) => s.selectPoint({ lat: c.lat, lon: c.lon }),
    [s.selectPoint],
  );

  // Up/Down walks the nav log top to bottom -- departure, each scored
  // checkpoint, destination -- the same list order the sidebar already
  // renders in, syncing the map to whatever it lands on exactly the
  // way clicking that row would (RouteMap's own `focus` prop, and
  // NavLogView's own scrollIntoView effect, both already key off
  // `selectedPoint`). The same list-stepping Label's own keyboard
  // handling does for its waypoint list, ported here since this
  // page's nav log has an equally obvious top-to-bottom order and no
  // single-leg "course-relative" concept of its own to step by instead.
  const stepWaypoint = useCallback((delta: number) => {
    if (!s.course) return;
    const points = [
      { lat: s.course.departure.lat, lon: s.course.departure.lon },
      ...s.selected.map(c => ({ lat: c.lat, lon: c.lon })),
      { lat: s.course.destination.lat, lon: s.course.destination.lon },
    ];
    const at = s.selectedPoint
      ? points.findIndex(p => descriptionKey(p.lat, p.lon) === descriptionKey(s.selectedPoint!.lat, s.selectedPoint!.lon))
      : -1;
    const next = points[Math.max(0, Math.min(points.length - 1, (at < 0 ? 0 : at + delta)))];
    if (next) s.selectPoint(next);
  }, [s.course, s.selected, s.selectedPoint, s.selectPoint]);

  // Mirrors Label's own zoom button: zoomed out, this zooms in to
  // whatever's selected (or departure, the first point, if nothing is
  // yet -- "Start"); zoomed in, it zooms back out to the whole route
  // ("Fit route") rather than requiring the keyboard-only "f" shortcut.
  // `zoomedIn` comes from RouteMap's own real zoom level (see its own
  // comment), not which of these two actions last ran.
  const [zoomedIn, setZoomedIn] = useState(false);
  const toggleZoom = useCallback(() => {
    if (!s.course) return;
    if (zoomedIn) { controls.current?.fit(); return; }
    s.selectPoint(s.selectedPoint ?? { lat: s.course.departure.lat, lon: s.course.departure.lon });
  }, [s.course, s.selectedPoint, s.selectPoint, zoomedIn]);
  const zoomToggleLabel = zoomedIn ? "Fit Route" : "Show Selected";

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
      if (!showBriefing && e.key === "ArrowDown") { e.preventDefault(); stepWaypoint(1); }
      if (!showBriefing && e.key === "ArrowUp") { e.preventDefault(); stepWaypoint(-1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showBriefing, setBriefingView, stepWaypoint]);


  // Folds PageHeader's own row and the old separate toolbar row into
  // one -- the route form, not "VFR Route," is this page's actual
  // title: the thing a pilot is here to use, not a settings drawer or
  // a brand mark worth a whole line of their own.
  //
  // The Map/Brief tabs below replace what used to be a "Brief" button
  // next to "Load" -- switching views this way (rather than a
  // one-directional button that only opened Briefing, with its own
  // entirely separate page shell and header) reads as what it actually
  // is: one page with two views of the same route, not a detour.
  // Disabled together with "Load" itself while a plan is mid-fetch
  // (`s.stage`) for the same reason: nothing to view yet either way.
  //
  // This header is now always rendered, on both tabs -- it used to be
  // `showBriefing ? null : mapHeader`, with FlightBriefingView drawing
  // its own separate header (a "Back to Map" button, the narrative
  // actions, Settings) in its place. That made switching views read as
  // navigating to a different page rather than switching tabs on the
  // same one, and duplicated Settings. The tabs' own trailing slot
  // holds whichever view-specific actions belong to the active one --
  // NavLogActions (the AI narrative popover, then Print) for Brief,
  // the planning guide and the nav log sidebar's own toggle for Map --
  // rather than either pair permanently claiming space on the other
  // view's own toolbar row.
  const mapHeader = (
    <TwoRowHeader
      rowOneStart={
        <RouteForm
          dep={dep} dest={dest}
          onDepChange={setDep} onDestChange={setDest}
          onSubmit={submit}
          disabled={s.stage !== null}
          routes={s.routes}
        />
      }
      rowOneEnd={<SettingsButton />}
      tab={showBriefing ? "brief" : "map"}
      onTabChange={value => setBriefingView(value === "brief")}
      tabs={
        <>
          <TabsTrigger value="map" disabled={s.stage !== null}>Map</TabsTrigger>
          <TabsTrigger value="brief" disabled={!s.course || s.stage !== null} data-testid="map-action-button">
            Brief
          </TabsTrigger>
        </>
      }
      trailing={showBriefing ? (
        <NavLogActions
          onGenerateNarrative={framework => void s.loadFrameworkNarrative(framework, dep, dest)}
          langgraphNarrative={s.langgraphNarrative}
          crewaiNarrative={s.crewaiNarrative}
        />
      ) : (
        // The planning guide, the zoom toggle and the nav log sidebar's
        // own toggle -- all three floated over the map itself further
        // back; here in the header instead, next to each other in the
        // same trailing spot Brief's own AI/Print buttons sit in one
        // tab over, since neither MapGuideButton nor Shell's own
        // sidebar (now a Drawer any page opens from its own header
        // button) has a floating mode left to opt out of any more. The
        // zoom toggle was keyboard-only ("f", fit only, no zoom-in
        // counterpart) until now -- mirrors Label's own zoom button
        // beside its sidebar trigger, the same "look like the same
        // shell" reasoning RouteForm's own comment already applies to
        // Load.
        <div className="flex items-center gap-2">
          <ScoreLegend />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button" variant="ghost" size="icon"
                onClick={toggleZoom}
                disabled={!s.course}
              >
                {zoomedIn ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
                <span className="sr-only">{zoomToggleLabel}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{zoomToggleLabel}</TooltipContent>
          </Tooltip>
          <SidebarToggleButton open={sidebarOpen} onClick={() => setSidebarOpen(o => !o)} label="Nav Log" />
        </div>
      )}
    />
  );

  // The nav log's own stage (scoring, altitude selection, the live
  // aviationweather.gov fetch) takes priority over the plan's own
  // course/checkpoints stages and the checkpoint description count
  // while it's running -- all four are the same floating status,
  // never two at once. This used to be two things -- this same
  // floating popup, plus a second, separate "drawing course…"/
  // "scoring checkpoints…" line inline in the header -- until both
  // ends of that redundancy got noticed at once; there's exactly one
  // place this app reports background progress, this is it. The
  // Flight Briefing page's own fetch goes first: it's the only thing
  // that can be running while that page is open (the other three are
  // all map-view stages), and it's the reason this floating popup --
  // not an inline line in the page body -- is how the briefing shows
  // "Loading briefing…" too, the same as every other background fetch
  // in this app.
  // Neither framework narrative's own loading/error state feeds this --
  // both now show inline in NavLogActions' own Popover (a spinner while
  // generating, the error text in place of the narrative if it fails),
  // right next to the button that triggered them, rather than a second,
  // redundant report of the same thing up here.
  const progress = (s.loadingBriefing ? "Loading briefing…" : null)
    ?? s.navStage
    ?? (s.stage === "course" ? "Drawing course…" : null)
    ?? (s.stage === "checkpoints" ? "Scoring checkpoints…" : null)
    ?? (s.stage ? `Planning… ${STAGE_PERCENT[s.stage]}%` : null)
    ?? (s.descriptionProgress ? `Generating ${s.descriptionProgress.done}/${s.descriptionProgress.total}` : null);
  const briefingErrorMsg = s.briefingError && `Couldn't load the briefing: ${s.briefingError}`;
  const descError = s.descriptionError && `Couldn't generate checkpoint descriptions: ${s.descriptionError}`;
  // Default position (bottom-center, the Toaster's own app-wide
  // default now -- see main.tsx) works unmodified on both tabs --
  // neither Map nor Brief has anything floating at the bottom of its
  // own content any more (the guide button and the sidebar trigger
  // both live in the header now, see mapHeader above), so there's
  // nothing left down there for this to land on top of, on either one.
  // Three named sources, not one combined string -- a briefing failure
  // and an unrelated checkpoint-description failure used to share one
  // slot (whichever won a `??`/`||` chain), silently hiding the other;
  // now each gets its own stacking toast (see usePageStatus's own
  // comment).
  usePageStatus(progress, { general: s.error, briefing: briefingErrorMsg, description: descError });

  const navLog = (
    <NavLogView
      totals={s.totals} nav={s.nav} legs={s.legs} navError={s.navError}
      dep={dep} dest={dest}
      depName={s.course?.departure.name ?? null} destName={s.course?.destination.name ?? null}
      depLat={s.course?.departure.lat ?? 0} depLon={s.course?.departure.lon ?? 0}
      destLat={s.course?.destination.lat ?? 0} destLon={s.course?.destination.lon ?? 0}
      selected={s.selected}
      depElevationFt={s.course?.departure.elevation_ft ?? null}
      destElevationFt={s.course?.destination.elevation_ft ?? null}
      descriptions={s.descriptions}
      onSaveDescription={(lat, lon, text) => s.saveDescription(dep, dest, lat, lon, text)}
      onGenerateDescriptions={generateDescriptions}
      descriptionsLoading={s.descriptionProgress !== null}
      expanded={navLogExpanded} onToggleExpanded={() => setNavLogExpanded(e => !e)}
      selectedPoint={s.selectedPoint} onSelectPoint={(lat, lon) => s.selectPoint({ lat, lon })}
      alt={alt} onAltChange={setAlt} onSubmit={submit}
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
        header={mapHeader}
        sidebarWide={navLogExpanded}
        sidebarOpen={sidebarOpen}
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
                briefing={s.briefing} briefingError={s.briefingError} loadingBriefing={s.loadingBriefing}
                onRetryBriefing={() => void s.loadBriefing(dep, dest)}
                langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative}
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
                onZoomChange={setZoomedIn}
              />
            )}
          </div>
        }
        sidebar={showBriefing ? null : navLog}
      />
    </>
  );
}
