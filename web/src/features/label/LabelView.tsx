import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ZoomIn, ZoomOut } from "lucide-react";
import { identSchema } from "../../lib/identSchema";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling. Imported here (not in main.tsx) so Home/Playground
// pages that never touch a map don't pay for it. Settings' own Dev
// Label tab now does pay for it (it statically imports this component
// to embed the real workspace inline, see that tab's own comment), but
// only as part of Settings' own lazy route chunk, still never on
// Plan's or the initial app load.
import "leaflet/dist/leaflet.css";
import Shell from "../../Shell";
import SettingsButton from "../../components/SettingsButton";
import SidebarToggleButton from "../../components/SidebarToggleButton";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { usePageStatus } from "../../lib/usePageStatus";
import ChartMap from "./components/ChartMap";
import RouteForm from "../../components/RouteForm";
import ProgressCard from "./components/ProgressCard";
import WaypointList from "./components/WaypointList";
import PointPopup from "./components/PointPopup";
import RatingLegend from "./components/RatingLegend";
import { isEndpoint, type Point, type Rating } from "../../lib/api/types";
import {
  filterCounts, forwardIsLeft, forwardIsUp, hasRating, hiddenCount, isVisible, orderedPoints,
} from "./logic";
import { currentPoint, useLabelState } from "./hooks/useLabelState";
import { useDocumentTitle } from "../../lib/useDocumentTitle";

const FOCUS_ZOOM = 12;

/** The pieces `embedded` mode hands back instead of wrapping them in
 *  this component's own `Shell`/header -- Settings' own Dev tab
 *  composes these into ITS OWN single Shell (with its own
 *  `sidebarOpen` state and its own `SidebarToggleButton`) instead of
 *  nesting a second Shell inside the first. See SettingsView's own
 *  comment on why this needs to be one Shell, not two stacked ones. */
export interface LabelWorkspacePieces {
  /** DEP/DEST/Load -- Settings' own header shows this at the same
   *  trailing spot RouteForm sits in Plan's, left-aligned, only while
   *  Dev is the active tab. */
  routeForm: ReactNode;
  /** The rating scale/shortcuts popover -- inline next to the sidebar
   *  trigger in Settings' own tab row instead of floating over the
   *  map, the same move Plan's own `ScoreLegend` already made for its
   *  Map tab. */
  guideButton: ReactNode;
  /** Start/Resume/Fit line -- next to the sidebar trigger, mirroring
   *  Plan's own fit-route button beside its sidebar trigger, not
   *  folded into `routeForm` (see this page's own comment on why). */
  zoomButton: ReactNode;
  /** The chart itself, for Shell's own `map` slot. */
  mapContent: ReactNode;
  /** The progress card and waypoint list, for Shell's own `sidebar` slot. */
  sidebarContent: ReactNode;
}

interface Props {
  /** true when this is Settings' own Dev tab rendering the real
   *  workspace inline (see SettingsView's own comment) rather than the
   *  standalone `/app/label` route mounting this as the whole page.
   *  Requires `children`, since embedded mode has nothing of its own
   *  to render -- everything it would have shown goes through that
   *  render prop for Settings' own Shell to place instead. */
  embedded?: boolean;
  /** Only called (and only meaningful) when `embedded` -- see
   *  `LabelWorkspacePieces`'s own comment. */
  children?: (pieces: LabelWorkspacePieces) => ReactNode;
}

export default function LabelView({ embedded = false, children }: Props) {
  useDocumentTitle(embedded ? null : "Label checkpoints — VFR Route");
  const store = useLabelState();
  const point = useMemo(
    () => currentPoint(store),
    [store.selection, store.endpoints, store.detections, store.added],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [map, setMap] = useState<L.Map | null>(null);
  const [dep, setDep] = useState(searchParams.get("dep")?.toUpperCase() ?? "C81");
  const [dest, setDest] = useState(searchParams.get("dest")?.toUpperCase() ?? "KDLH");
  const [stepDelta, setStepDelta] = useState(1);
  // Tracks the map's own zoom so the one Controls button can read as
  // "Start"/"Resume"/"Fit line" -- Leaflet's zoom lives outside React,
  // so without this the label would only update on some unrelated
  // re-render, not the moment a zoom actually happens.
  const [zoomedIn, setZoomedIn] = useState(false);
  // The waypoint-list sidebar's own open state -- only meaningful (and
  // only read below) for the standalone page's own `<Shell>` call;
  // `embedded` mode's own sidebar trigger belongs to Settings' own
  // Shell instead, which owns its own copy of this same state.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Mount only, deliberately: RouteForm's own onSubmit is the reload
  // path when dep/dest change later, so this effect must not also fire
  // on every keystroke that updates them. store.load is still listed
  // (a stable []-deps callback in useLabelState) so a future refactor
  // that gave it a real dependency wouldn't silently go stale here.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dep/dest omitted on purpose, see above
  useEffect(() => { void store.load(dep, dest); }, [store.load]);

  useEffect(() => {
    if (!map) return;
    const onZoom = () => setZoomedIn(map.getZoom() >= FOCUS_ZOOM);
    onZoom();
    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [map]);

  // Everything the screen shows is computed from the store. Nothing is
  // kept in step by hand, which is what makes the old class of bug --
  // two counts over different sets -- unrepresentable.
  const walk = useMemo(
    () => orderedPoints(
      { endpoints: store.endpoints, detections: store.detections, added: store.added },
      store.filters,
    ),
    [store.endpoints, store.detections, store.added, store.filters],
  );
  const waypoints = useMemo(() => walk.filter(e => !isEndpoint(e.point)), [walk]);
  const shown = useMemo(
    () => [...store.detections, ...store.added].filter(p => isVisible(p, store.filters)).length,
    [store.detections, store.added, store.filters],
  );
  const counts = useMemo(
    () => filterCounts([...store.detections, ...store.added]),
    [store.detections, store.added],
  );
  const picks = useMemo(
    () => [...store.detections, ...store.added].filter(hasRating),
    [store.detections, store.added],
  );
  const visiblePicks = useMemo(
    () => picks.filter(p => isVisible(p, store.filters)), [picks, store.filters],
  );
  const hidden = hiddenCount(picks, store.filters);
  const listEntries = useMemo(
    () => walk.filter(e => isEndpoint(e.point) || hasRating(e.point)),
    [walk],
  );

  const positionOf = useCallback(
    (p: Point) => waypoints.findIndex(e => e.point === p),
    [waypoints],
  );

  /** Where the selected point sits in the walk, for the popup's own line. */
  const place = useMemo(() => {
    if (!point) return "";
    const at = positionOf(point);
    return at >= 0 ? `${at + 1} of ${waypoints.length}` : "";
  }, [point, positionOf, waypoints.length]);

  // The total climbs fast while detections stream in -- worth a flash
  // in the popup, but only when it actually went up, not on every
  // content refresh (a rating click shouldn't flash a number that
  // didn't change). Tracked here, outside the memo's own churn, since
  // the total is one figure shared by whichever point is showing.
  const lastTotal = useRef<number | null>(null);

  const focus = useCallback((entry: (typeof walk)[number]) => {
    map?.setView([entry.point.lat, entry.point.lon], Math.max(map.getZoom(), FOCUS_ZOOM));
    store.select({ kind: entry.kind, index: entry.index });
  }, [map, store]);

  const step = useCallback((delta: number) => {
    setStepDelta(delta);
    if (!walk.length) return;
    const at = point ? walk.findIndex(e => e.point === point) : -1;
    const next = at < 0 ? 0 : at + delta;
    const entry = walk[Math.max(0, Math.min(walk.length - 1, next))];
    if (entry) focus(entry);
  }, [walk, point, focus]);

  const walkIndex = point ? walk.findIndex(e => e.point === point) : -1;

  // Memoized deliberately: without it, this is a new element on every
  // render -- including one for each block of a streaming detection --
  // and ChartMap's halo effect depends on it, so an unrelated re-render
  // would tear the popup down and remount it, not just re-render it.
  // Written after render (an effect), read during it (inside the
  // useMemo below) -- reading and writing the same ref inside the memo
  // itself would mutate it as a side effect of a supposedly pure
  // calculation, which React is free to invoke more than once per
  // commit (Strict Mode does, today) or skip and reuse a prior result.
  useEffect(() => {
    lastTotal.current = waypoints.length;
  }, [waypoints.length]);

  const selectedContent = useMemo(() => {
    if (!point) return null;
    // Reads lastTotal.current as it stood after the PREVIOUS commit --
    // the write above only ever happens in an effect, strictly after a
    // render finishes, so this can never observe a value written by
    // the render currently in progress. Safe in practice; the
    // react-hooks/refs rule can't prove that statically across two
    // separate hooks, only warn that ref reads during render aren't
    // generally guaranteed to be.
    // eslint-disable-next-line react-hooks/refs
    const countChanged = lastTotal.current !== null && lastTotal.current !== waypoints.length;
    // Same idea as the arrow keys: which screen side is "forward" (step
    // +1) depends on which way the course actually runs, not a fixed
    // left-back/right-forward assumption -- a route heading roughly
    // west has forward on the left.
    const bearing = store.course?.bearing_deg ?? 0;
    const leftIsForward = forwardIsLeft(bearing);
    const canPrev = walkIndex > 0;
    const canNext = walkIndex >= 0 && walkIndex < walk.length - 1;
    return (
      <PointPopup
        point={point}
        place={place}
        // Same ref-read this rule already flagged above, propagated to
        // its one use site -- see the comment there.
        // eslint-disable-next-line react-hooks/refs
        countChanged={countChanged}
        bearingDeg={bearing}
        departureIdent={store.course?.departure.ident ?? ""}
        onRate={r => void store.rate(r)}
        onCategoryChange={c => void store.setCategory(c)}
        onRemove={() => void store.removeSelected()}
        onLeft={() => step(leftIsForward ? 1 : -1)}
        onRight={() => step(leftIsForward ? -1 : 1)}
        canLeft={leftIsForward ? canNext : canPrev}
        canRight={leftIsForward ? canPrev : canNext}
      />
    );
  }, [
    point, place, waypoints.length, store.course?.bearing_deg, store.course?.departure.ident,
    store.rate, store.setCategory, store.removeSelected, step, walkIndex, walk.length,
  ]);

  /** Walks the waypoint list top to bottom (not the course-relative
   *  direction `step` uses) and brings the map to whatever it lands
   *  on, the same as clicking that row would. */
  const stepList = useCallback((delta: number) => {
    if (!listEntries.length) return;
    const at = point ? listEntries.findIndex(e => e.point === point) : -1;
    const next = at < 0 ? 0 : at + delta;
    const entry = listEntries[Math.max(0, Math.min(listEntries.length - 1, next))];
    if (entry) focus(entry);
  }, [listEntries, point, focus]);

  /** Zooms out to see the whole leg -- Escape, and its own toolbar
   *  button for touch, which has no Escape key. */
  const fitLine = useCallback(() => {
    if (!store.course || !map) return;
    map.invalidateSize();
    map.fitBounds(store.course.course_line as [number, number][], { padding: [30, 30] });
  }, [store.course, map]);

  /** Zooms into the point you're on, or the first one if you haven't
   *  started yet -- "Start" and "Resume" are the same action, the
   *  button just reads differently depending on whether `point` is set. */
  const startOrResume = useCallback(() => {
    const target = point ? walk.find(e => e.point === point) : walk[0];
    if (target) focus(target);
  }, [point, walk, focus]);

  /** Space toggles between the point you are on and the whole leg: both are
   *  the same intention, and which you want is obvious from the screen. */
  const toggleView = useCallback(() => {
    if (!map) return;
    if (map.getZoom() >= FOCUS_ZOOM) return fitLine();
    startOrResume();
  }, [map, fitLine, startOrResume]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT") return;
      const bearing = store.course?.bearing_deg ?? 0;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return toggleView(); }
      if (e.key === "Escape") { e.preventDefault(); return fitLine(); }
      // Up/Down inside the waypoint list walks the list itself, top to
      // bottom, rather than the course-relative step below -- the list
      // has its own obvious order and its own scrollbar; letting the
      // map pan along behind it would fight whichever one you meant.
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && el.closest("[data-waypoint-list]")) {
        e.preventDefault();
        return stepList(e.key === "ArrowDown" ? 1 : -1);
      }
      // Arrows follow the course across the screen, not the order points
      // happen to be stored in: a 328-degree leg goes up and to the left.
      if (e.key === "ArrowUp") { e.preventDefault(); return step(forwardIsUp(bearing) ? 1 : -1); }
      if (e.key === "ArrowDown") { e.preventDefault(); return step(forwardIsUp(bearing) ? -1 : 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); return step(forwardIsLeft(bearing) ? 1 : -1); }
      if (e.key === "ArrowRight") { e.preventDefault(); return step(forwardIsLeft(bearing) ? -1 : 1); }
      if (/^[0-5]$/.test(e.key) && point && !isEndpoint(point)) {
        void store.rate(Number(e.key) as Rating).then(() => step(stepDelta));
      }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); void store.removeSelected(); }
      if (e.key === "v") store.setFilter("visual", !store.filters.visual);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // store.rate/removeSelected/setFilter are stable ([]-deps callbacks
    // in useLabelState, reading fresh state through a ref rather than
    // closing over it) -- listed by field rather than the whole `store`
    // object so this doesn't tear down and rebind the listener on every
    // unrelated store change (a streamed-in detection, say), only on
    // the two fields the handler actually reads a fresh value from.
  }, [store.course, store.filters, store.rate, store.removeSelected, store.setFilter, point, step, stepList, stepDelta, toggleView, fitLine]);

  const submitRoute = useCallback(() => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a) return;
    setSearchParams({ dep: d, dest: a }, { replace: true });
    void store.load(d, a);
  }, [dep, dest, setSearchParams, store.load]);

  usePageStatus(store.progress, { general: store.error });

  // The four pieces every version of this page is built from --
  // standalone wraps them in its own Shell/header below; `embedded`
  // hands them to Settings' own Dev tab instead, for its own single
  // Shell to place (see `LabelWorkspacePieces`'s own comment on why
  // one Shell, not two).
  const routeForm = (
    <RouteForm
      dep={dep} dest={dest} onDepChange={setDep} onDestChange={setDest}
      onSubmit={submitRoute}
    />
  );
  // Inline next to the sidebar trigger in the header, standalone or
  // embedded alike -- the same move Plan's own `ScoreLegend` already
  // made for its Map tab (see `MapGuideButton`'s own comment on why
  // there's no floating mode left to opt out of any more).
  const guideButton = <RatingLegend />;
  // "Fit Route"/"Show Selected" -- the same two-state language Plan's
  // own zoom toggle uses beside its own sidebar trigger, not this
  // page's own former three-state "Start"/"Resume"/"Fit line" -- these
  // two pages read as the same shell around a different sidebar
  // everywhere else already (see RouteForm's own comment).
  const toggleViewLabel = zoomedIn ? "Fit Route" : "Show Selected";
  // Next to the sidebar trigger, not folded into `routeForm` -- it's a
  // map-view action (what's zoomed into right now), the same category
  // as the sidebar toggle itself, not part of "the route inputs and
  // Load button" that component unifies (see `RouteInputGroup`'s own
  // comment).
  const zoomButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button" variant="ghost" size="icon" onClick={toggleView} disabled={!walk.length}
          data-testid="map-action-button"
        >
          {zoomedIn ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
          <span className="sr-only">{toggleViewLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{toggleViewLabel}</TooltipContent>
    </Tooltip>
  );
  const mapContent = (
    <div className="h-full w-full">
      <ChartMap
        course={store.course}
        endpoints={store.endpoints}
        detections={store.detections}
        added={store.added}
        filters={store.filters}
        selected={point}
        selectedContent={selectedContent}
        showMenu={zoomedIn}
        onSelect={(kind, index) => store.select({ kind, index })}
        onDeselect={() => store.select(null)}
        onAddAt={(lat, lon) => void store.addPick(lat, lon)}
        onMapReady={setMap}
      />
    </div>
  );
  // The view filters used to live in their own collapsible toolbar
  // row, collapsed by default, then their own bar above this card --
  // folded into it now, since each checkbox's count and the "Rated"
  // total above it are the same kind of fact and read better together
  // than split across two panels.
  const sidebarContent = (
    <>
      <ProgressCard
        visiblePicks={visiblePicks}
        filters={store.filters}
        onFilterChange={store.setFilter}
        filterCounts={counts}
        shown={shown}
        canUndo={store.canUndo}
        onUndo={() => void store.undo()}
        onResetAll={() => void store.resetAll()}
      />
      <WaypointList
        entries={listEntries} selected={point} onFocus={focus} hidden={hidden}
        bearingDeg={store.course?.bearing_deg ?? 0}
        departureIdent={store.course?.departure.ident ?? ""}
        distanceNm={store.course?.distance_nm ?? null}
      />
    </>
  );

  if (embedded) {
    return children?.({ routeForm, guideButton, zoomButton, mapContent, sidebarContent }) ?? null;
  }

  // Folds the shared PageHeader's own row into this page's own route
  // form, the same way Plan's mapHeader does -- the route being worked
  // on, not "VFR Route," is this page's actual title too. RouteForm
  // used to sit inside the collapsible toolbar below, collapsed by
  // default like the view filters beside it; that hid the one thing
  // this page can't do anything useful without (a route to walk) behind
  // an extra click, which the view filters -- genuinely optional --
  // don't need to avoid. `zoomButton` sits next to the sidebar trigger
  // here too, the same way Plan's own fit-route button sits beside
  // its -- these two pages are meant to look like the same shell
  // around a different sidebar, not two designs that happen to share a
  // Shell component.
  const header = (
    // The same row shape as `TwoRowHeader`'s first row (see its comment):
    // a centering grid from `sm` up, a wrapping flex row below it, where
    // the route form plus four icon buttons is wider than a phone and
    // the icons drop to a second line rather than overlapping the form
    // or scrolling sideways.
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] print:hidden">
      <div className="hidden sm:block" />
      {routeForm}
      <div className="ml-auto flex items-center gap-2 sm:ml-0 sm:justify-self-end">
        {guideButton}
        {zoomButton}
        <SidebarToggleButton open={sidebarOpen} onClick={() => setSidebarOpen(o => !o)} label="Waypoints" />
        <SettingsButton />
      </div>
    </header>
  );

  return (
    <Shell
      header={header}
      map={mapContent}
      sidebar={sidebarContent}
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
    />
  );
}
