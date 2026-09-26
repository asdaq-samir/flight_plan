import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { identOf, routeOf } from "../../lib/identSchema";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling.
import "leaflet/dist/leaflet.css";
import { useProgressToast } from "../../lib/useProgressToast";
import type { WorkspaceProps } from "../page/workspace";
/** The console's own chunk: recharts and the model tables are a third
 *  of this page's JavaScript and are parsed only when the console is
 *  actually opened. */
const DevPanel = lazy(() => import("../dev/DevPanel").then(m => ({ default: m.DevPanel })));
import ChartMap from "./components/ChartMap";
import WaypointPanel from "./components/WaypointPanel";
import PointPopup from "./components/PointPopup";
import { isEndpoint, type Point, type Rating } from "../../lib/api/types";
import {
  filterCounts, forwardIsLeft, hasRating, hiddenCount, orderedPoints,
} from "./logic";
import { useTraining } from "./hooks/useTraining";

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
    selected: point, course,
    select, rate, setCategory, removeSelected, addPick,
  } = store;
  const [map, setMap] = useState<L.Map | null>(null);

  // Fetched the moment this workspace mounts, not the moment the Sheet
  // first opens: `DevPanel` is its own chunk (recharts and the model
  // tables, split out so a pilot never downloads them), and the stock
  // Sheet doesn't mount its content until it opens, so without this the
  // console's first open paid for that chunk's own network round trip
  // on top of the stock open animation -- a lag the pilot's console and
  // the nav-log drawer don't have, since neither is split out. This
  // developer is already on the training page by the time they reach
  // for the console, so the fetch has a head start.
  useEffect(() => { void import("../dev/DevPanel"); }, []);

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
    select(entry.point);
  }, [map, select]);

  /** Walks the waypoint list and brings the map to whatever it lands
   *  on, the same as clicking that row would. The list is the walk
   *  itself -- every point the filters admit, in flight order -- so the
   *  popup's arrows, the drawer's rows and the keys all move by the
   *  same step. There were two copies of this, identical, with a
   *  comment on one claiming it walked a different order. */
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

  /** Zooms out to see the whole leg -- Escape, and its own toolbar
   *  button for touch, which has no Escape key. */
  /** Zooms into the point you're on, or the first one if you haven't
   *  started yet -- "Start" and "Resume" are the same action, the
   *  button just reads differently depending on whether `point` is set. */
  const startOrResume = useCallback(() => {
    const target = point ? walk.find(e => e.point === point) : walk[0];
    if (target) focus(target);
  }, [point, walk, focus]);


  // Loading a route writes the address, which is what the queries key
  // on -- the same route again costs nothing, being kept.
  const submit = useCallback(() => {
    const route = routeOf(dep, dest);
    if (!route) return;
    setSearchParams(route, { replace: true });
  }, [dep, dest, setSearchParams]);

  // Stable identities for ChartMap's own effects, which list them as
  // dependencies (see its comment) -- an inline arrow at the call site
  // would redraw every marker on every render of this page.
  // A tap on a marker goes to it, the same as walking onto it with the
  // keys does (`focus` above) and the same as a tap on a marker does on
  // the planner's map. It used to select without moving, which made the
  // same gesture mean two different things on two maps.
  /** Leaflet closing the card -- a tap on the chart -- has to clear the
   *  selection too, or React would open it straight back up. */
  const deselect = useCallback(() => select(null), [select]);

  const onSelect = useCallback((picked: Point) => {
    select(picked);
    map?.setView([picked.lat, picked.lon], Math.max(map.getZoom(), FOCUS_ZOOM));
  }, [select, map]);
  const onAddAt = useCallback((lat: number, lon: number) => { void addPick(lat, lon); }, [addPick]);

  // The chart read's progress; its failures are the query client's to
  // report (queryClient.ts).
  useProgressToast(store.progress);

  return children({
    map: (
      <div className="h-full w-full">
        <ChartMap
          zoom={{ showSelected: startOrResume, disabled: !walk.length }}
          course={store.course}
          endpoints={store.endpoints}
          detections={store.detections}
          added={store.added}
          filters={store.filters}
          selected={point}
          selectedContent={selectedContent}
          onDeselect={deselect}
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
        onRate={r => void rate(r).then(() => step(1))}
        distanceNm={store.course?.distance_nm ?? null}
        bearingDeg={store.course?.bearing_deg ?? 0}
        departureIdent={store.course?.departure.ident ?? ""}
        destinationIdent={store.course?.destination.ident ?? ""}
        rated={picks.length} total={store.detections.length + store.added.length} hidden={hidden}
        filters={store.filters} counts={counts} onFilterChange={store.setFilter}
        canUndo={store.canUndo} onUndo={() => void store.undo()} onResetAll={() => void store.resetAll()}
      />
    ),
    console: <Suspense fallback={<div className="h-40" />}><DevPanel /></Suspense>,
    submit,
    loading: store.loading,
  });
}
