import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { identOf, identSchema } from "../../lib/identSchema";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling.
import "leaflet/dist/leaflet.css";
import { useProgressToast } from "../../lib/useProgressToast";
import type { WorkspaceProps } from "../page/workspace";
import { DevPanel } from "../dev/DevPanel";
import ChartMap from "./components/ChartMap";
import WaypointPanel from "./components/WaypointPanel";
import PointPopup from "./components/PointPopup";
import { isEndpoint, type Point, type Rating } from "../../lib/api/types";
import {
  filterCounts, forwardIsLeft, hasRating, hiddenCount, orderedPoints,
} from "./logic";
import { currentPoint, useTraining, type Selection } from "./hooks/useTraining";

const FOCUS_ZOOM = 12;

/**
 * the developer's training workspace on the page (MapPage): the
 * corridor's candidates on the chart, walked with the keys and rated
 * from the map popup or the Model Training drawer, with the developer
 * console for the training run. The page owns the shell and the route
 * typed into its form; this owns everything about the labels.
 */
export default function TrainWorkspace({ dep, dest, children }: WorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  // The address is the route the labels are for -- what the queries
  // read, and what a load writes; the header's form is a draft until
  // then. The default corridor when it names none.
  const planned = {
    dep: identOf(searchParams.get("dep")) || "C81",
    dest: identOf(searchParams.get("dest")) || "KDLH",
  };
  const store = useTraining(planned.dep, planned.dest);
  // Named, not read as `store.x` inside the hooks below: each hook then
  // lists exactly what it reads, and the actions are stable (useTraining
  // reads its own latest state through a ref) so listing them costs
  // nothing.
  const {
    selection, endpoints, detections, added, course,
    select, rate, setCategory, removeSelected, addPick,
  } = store;
  const point = useMemo(
    () => currentPoint({ selection, endpoints, detections, added }),
    [selection, endpoints, detections, added],
  );
  const [map, setMap] = useState<L.Map | null>(null);
  // Tracks the map's own zoom so the one Controls button can read as
  // "Start"/"Resume"/"Fit line" -- Leaflet's zoom lives outside React,
  // so without this the label would only update on some unrelated
  // re-render, not the moment a zoom actually happens.
  const [zoomedIn, setZoomedIn] = useState(false);

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
        onClose={() => select(null)}
        onLeft={() => step(leftIsForward ? 1 : -1)}
        onRight={() => step(leftIsForward ? -1 : 1)}
        canLeft={leftIsForward ? canNext : canPrev}
        canRight={leftIsForward ? canPrev : canNext}
      />
    );
  }, [
    point, place, waypoints.length, course?.bearing_deg, course?.departure.ident,
    rate, setCategory, removeSelected, select, step, walkIndex, walk.length,
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

  // Two keys, and only two: Up and Down walk the points in flight
  // order, and a digit rates the one you are on and moves to the next.
  // Everything this used to bind -- Space and Escape for the two zooms,
  // Delete to remove, `v` for the visual filter, and the four arrows
  // stepping the way the course runs rather than the way the list does
  // -- has a button of its own, on the map or in this drawer, and each
  // was a letter or a key that had to be kept out of the way of typing.
  // Skipped while a field has focus, and for a press a Radix layer
  // already used (its own list walks with the same arrows), which it
  // marks by preventing the default or keeping focus inside itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.defaultPrevented || target?.closest('[role="listbox"],[role="dialog"][aria-modal="true"],[role="menu"]')) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        stepList(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (/^[0-5]$/.test(e.key) && point && !isEndpoint(point)) {
        void rate(Number(e.key) as Rating).then(() => stepList(1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [point, rate, stepList]);

  // Loading a route writes the address, which is what the queries key
  // on -- the same route again costs nothing, being kept.
  const submit = useCallback(() => {
    const d = identSchema.safeParse(dep).data, a = identSchema.safeParse(dest).data;
    if (!d || !a) return;
    setSearchParams({ dep: d, dest: a }, { replace: true });
  }, [dep, dest, setSearchParams]);

  // Stable identities for ChartMap's own effects, which list them as
  // dependencies (see its comment) -- an inline arrow at the call site
  // would redraw every marker on every render of this page.
  const onSelect = useCallback((kind: Selection["kind"], index: number) => select({ kind, index }), [select]);
  const onAddAt = useCallback((lat: number, lon: number) => { void addPick(lat, lon); }, [addPick]);

  // The chart read's progress; its failures are the query client's to
  // report (queryClient.ts).
  useProgressToast(store.progress);

  return children({
    map: (
      <div className="h-full w-full">
        <ChartMap
          zoom={{ zoomedIn, onToggle: toggleView, disabled: !walk.length }}
          course={store.course}
          endpoints={store.endpoints}
          detections={store.detections}
          added={store.added}
          filters={store.filters}
          selected={point}
          selectedContent={selectedContent}
          showMenu={zoomedIn}
          onSelect={onSelect}
          onAddAt={onAddAt}
          onMapReady={setMap}
        />
      </div>
    ),
    // One panel, the shape of the pilot's nav log: the route's numbers
    // and the drawer's actions in a header (the filters in a popover
    // from it), and the walk as one table under it. Rating from the
    // selected row moves on to the next one, the way the digit keys do.
    sidebar: (
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
    ),
    console: <DevPanel />,
    submit,
    loading: store.loading,
  });
}
