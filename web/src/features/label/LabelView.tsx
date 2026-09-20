import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { identSchema } from "../../lib/identSchema";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling. Imported here (not in main.tsx) so it loads with the
// Dev page's own lazy chunk, never on Plan's or the initial app load.
import "leaflet/dist/leaflet.css";
import ZoomToggleButton from "../../components/ZoomToggleButton";
import { usePageStatus } from "../../lib/usePageStatus";
import ChartMap from "./components/ChartMap";
import RouteForm from "../../components/RouteForm";
import WaypointPanel from "./components/WaypointPanel";
import PointPopup from "./components/PointPopup";
import RatingLegend from "./components/RatingLegend";
import { isEndpoint, type Point, type Rating } from "../../lib/api/types";
import {
  filterCounts, forwardIsLeft, forwardIsUp, hasRating, hiddenCount, orderedPoints,
} from "./logic";
import { currentPoint, useLabelState, type Selection } from "./hooks/useLabelState";

const FOCUS_ZOOM = 12;

/** The pieces this workspace hands its page -- DevView composes them
 *  into its own single Shell, with its own `sidebarOpen` state and its
 *  own `SidebarToggleButton`, rather than this component nesting a
 *  second Shell inside the page's. */
export interface LabelWorkspacePieces {
  /** DEP/DEST/Load, for the header's centre. */
  routeForm: ReactNode;
  /** The rating scale/shortcuts popover -- inline next to the sidebar
   *  trigger in the header instead of floating over the map, the same
   *  move Plan's own `ScoreLegend` already made for its Map tab. */
  guideButton: ReactNode;
  /** Fit Route / Show Selected -- next to the sidebar trigger, mirroring
   *  Plan's own zoom toggle beside its sidebar trigger, not folded into
   *  `routeForm` (see this page's own comment on why). */
  zoomButton: ReactNode;
  /** The chart itself, for Shell's own `map` slot. */
  mapContent: ReactNode;
  /** The waypoint panel (the worklist), for Shell's own `sidebar` slot. */
  sidebarContent: ReactNode;
}

interface Props {
  /** The page renders the pieces; this component has no shell of its
   *  own to render them in. */
  children: (pieces: LabelWorkspacePieces) => ReactNode;
}

export default function LabelView({ children }: Props) {
  const store = useLabelState();
  // Named, not read as `store.x` inside the hooks below: each hook then
  // lists exactly what it reads, and the actions are stable
  // (`useCallback([])` in useLabelState) so listing them costs nothing.
  const {
    selection, endpoints, detections, added, filters, course,
    load, select, rate, setCategory, removeSelected, addPick, setFilter,
  } = store;
  const point = useMemo(
    () => currentPoint({ selection, endpoints, detections, added }),
    [selection, endpoints, detections, added],
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

  // Mount only, deliberately: RouteForm's own onSubmit is the reload
  // path when dep/dest change later, so this effect must not also fire
  // on every keystroke that updates them. load is still listed (a
  // stable []-deps callback in useLabelState) so a future refactor
  // that gave it a real dependency wouldn't silently go stale here.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dep/dest omitted on purpose, see above
  useEffect(() => { void load(dep, dest); }, [load]);

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
  const counts = useMemo(
    () => filterCounts([...store.detections, ...store.added]),
    [store.detections, store.added],
  );
  const picks = useMemo(
    () => [...store.detections, ...store.added].filter(hasRating),
    [store.detections, store.added],
  );
  const hidden = hiddenCount(picks, store.filters);

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
    select({ kind: entry.kind, index: entry.index });
  }, [map, select]);

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
    const bearing = course?.bearing_deg ?? 0;
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
        departureIdent={course?.departure.ident ?? ""}
        onRate={r => void rate(r)}
        onCategoryChange={c => void setCategory(c)}
        onRemove={() => void removeSelected()}
        onLeft={() => step(leftIsForward ? 1 : -1)}
        onRight={() => step(leftIsForward ? -1 : 1)}
        canLeft={leftIsForward ? canNext : canPrev}
        canRight={leftIsForward ? canPrev : canNext}
      />
    );
  }, [
    point, place, waypoints.length, course?.bearing_deg, course?.departure.ident,
    rate, setCategory, removeSelected, step, walkIndex, walk.length,
  ]);

  /** Walks the waypoint list top to bottom (not the course-relative
   *  direction `step` uses) and brings the map to whatever it lands
   *  on, the same as clicking that row would. The list is the walk
   *  itself -- every point the filters admit, in flight order. */
  const stepList = useCallback((delta: number) => {
    if (!walk.length) return;
    const at = point ? walk.findIndex(e => e.point === point) : -1;
    const next = at < 0 ? 0 : at + delta;
    const entry = walk[Math.max(0, Math.min(walk.length - 1, next))];
    if (entry) focus(entry);
  }, [walk, point, focus]);

  /** Zooms out to see the whole leg -- Escape, and its own toolbar
   *  button for touch, which has no Escape key. */
  const fitLine = useCallback(() => {
    if (!course || !map) return;
    map.invalidateSize();
    map.fitBounds(course.course_line as [number, number][], { padding: [30, 30] });
  }, [course, map]);

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
      const bearing = course?.bearing_deg ?? 0;
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
        void rate(Number(e.key) as Rating).then(() => step(stepDelta));
      }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); void removeSelected(); }
      if (e.key === "v") setFilter("visual", !filters.visual);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // rate/removeSelected/setFilter are stable ([]-deps callbacks in
    // useLabelState, reading fresh state through a ref rather than
    // closing over it), so this only tears down and rebinds the
    // listener on the fields the handler actually reads a fresh value
    // from, not on every unrelated store change (a streamed-in
    // detection, say).
  }, [course, filters, rate, removeSelected, setFilter, point, step, stepList, stepDelta, toggleView, fitLine]);

  const submitRoute = useCallback(() => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a) return;
    setSearchParams({ dep: d, dest: a }, { replace: true });
    void load(d, a);
  }, [dep, dest, setSearchParams, load]);

  // Stable identities for ChartMap's own effects, which list them as
  // dependencies (see its comment) -- an inline arrow at the call site
  // would redraw every marker on every render of this page.
  const onSelect = useCallback((kind: Selection["kind"], index: number) => select({ kind, index }), [select]);
  const onDeselect = useCallback(() => select(null), [select]);
  const onAddAt = useCallback((lat: number, lon: number) => { void addPick(lat, lon); }, [addPick]);

  usePageStatus(store.progress, { general: store.error });

  // The pieces the page is built from, handed to DevView for its own
  // single Shell to place (see `LabelWorkspacePieces`'s own comment on
  // why one Shell, not two).
  const routeForm = (
    <RouteForm
      dep={dep} dest={dest} onDepChange={setDep} onDestChange={setDest}
      onSubmit={submitRoute}
    />
  );
  // Inline next to the sidebar trigger in the header -- the same move
  // Plan's own `ScoreLegend` already made for its Map tab (see
  // `MapGuideButton`'s own comment on why there's no floating mode left
  // to opt out of any more).
  const guideButton = <RatingLegend />;
  // The same "Fit Route"/"Show Selected" toggle Plan has beside its own
  // sidebar trigger, not this page's own former three-state "Start"/
  // "Resume"/"Fit line" -- these two pages read as the same shell
  // around a different sidebar everywhere else already (see RouteForm's
  // own comment). Next to the sidebar trigger, not folded into
  // `routeForm`: it's a map-view action (what's zoomed into right now),
  // the same category as the sidebar toggle itself, not part of "the
  // route inputs and Load button" that component unifies (see
  // `RouteInputGroup`'s own comment).
  const zoomButton = (
    <ZoomToggleButton zoomedIn={zoomedIn} onClick={toggleView} disabled={!walk.length} data-testid="map-action-button" />
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
        onSelect={onSelect}
        onDeselect={onDeselect}
        onAddAt={onAddAt}
        onMapReady={setMap}
      />
    </div>
  );
  // One panel, the shape of Plan's nav log: the corridor's numbers and
  // the drawer's actions in a header (the filters in a popover from
  // it, since a checkbox row used to take a third of the drawer), and
  // the walk as one table under it. Rating from the selected row moves
  // on to the next one, the way the digit keys do.
  const sidebarContent = (
    <WaypointPanel
      entries={walk} selected={point} onFocus={focus}
      onRate={r => void rate(r).then(() => stepList(1))}
      distanceNm={store.course?.distance_nm ?? null}
      bearingDeg={store.course?.bearing_deg ?? 0}
      departureIdent={store.course?.departure.ident ?? ""}
      destinationIdent={store.course?.destination.ident ?? ""}
      rated={picks.length} total={store.detections.length + store.added.length} hidden={hidden}
      filters={store.filters} counts={counts} onFilterChange={store.setFilter}
      canUndo={store.canUndo} onUndo={() => void store.undo()} onResetAll={() => void store.resetAll()}
    />
  );

  return children({ routeForm, guideButton, zoomButton, mapContent, sidebarContent });
}
