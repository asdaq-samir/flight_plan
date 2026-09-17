import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import ChartMap from "./components/ChartMap";
import RouteForm from "./components/RouteForm";
import FilterBar from "./components/FilterBar";
import ProgressCard from "./components/ProgressCard";
import WaypointList from "./components/WaypointList";
import PointPopup from "./components/PointPopup";
import RatingLegend from "./components/RatingLegend";
import { isEndpoint, type Point, type Rating } from "../../lib/api/types";
import {
  forwardIsLeft, forwardIsUp, hasRating, hiddenCount, isVisible, orderedPoints,
} from "./logic";
import { currentPoint, useLabelState } from "./hooks/useLabelState";
import { useDocumentTitle } from "../../lib/useDocumentTitle";

const FOCUS_ZOOM = 12;

export default function LabelView() {
  useDocumentTitle("Label checkpoints — VFR Route");
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
  // The Guide panel sits in the same bottom-right corner the sidebar
  // opens over -- hide it once the sidebar's open at all, rather than
  // let it float on top of the waypoint list.
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

  const toolbar = (
    <CollapsibleToolbar
      title="VFR labeler"
      label={dep && dest ? `Route: ${dep} → ${dest}` : "Route & view"}
    >
      <div>
        <span className="text-xs font-semibold uppercase text-slate-400">Route</span>
        <RouteForm
          dep={dep} dest={dest} onDepChange={setDep} onDestChange={setDest}
          onSubmit={submitRoute}
          course={store.course}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-16 flex-shrink-0 text-xs font-semibold uppercase text-slate-400">View</span>
        <FilterBar filters={store.filters} onChange={store.setFilter} shown={shown} />
      </div>
    </CollapsibleToolbar>
  );

  usePageStatus(store.progress, store.error);

  const mapOverlay = (
    <>
      {!sidebarOpen && <RatingLegend />}
      <MapActionButton onClick={toggleView} disabled={!walk.length}>
        {!point ? "Start" : zoomedIn ? "Fit line" : "Resume"}
      </MapActionButton>
    </>
  );

  return (
    <Shell
      toolbar={toolbar}
      mapOverlay={mapOverlay}
      onSidebarOpenChange={setSidebarOpen}
      map={
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
      }
      sidebar={
        <>
          <ProgressCard
            visiblePicks={visiblePicks}
            canUndo={store.canUndo}
            onUndo={() => void store.undo()}
            onResetAll={() => void store.resetAll()}
          />
          <WaypointList
            entries={listEntries} selected={point} onFocus={focus} hidden={hidden}
            bearingDeg={store.course?.bearing_deg ?? 0}
            departureIdent={store.course?.departure.ident ?? ""}
          />
        </>
      }
    />
  );
}
