import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { identOf, routeOf } from "../../lib/identSchema";
import { statusQuery } from "../../lib/queryClient";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling.
import "leaflet/dist/leaflet.css";
import { useProgressToast } from "../../lib/useProgressToast";
import type { WorkspaceProps } from "../page/workspace";
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

  // The console, its own chunk -- recharts and the model tables, split
  // out so a pilot never downloads them -- fetched the moment this
  // workspace mounts, not the moment the Sheet first opens, and the
  // snapshot it opens on with it (on a phone the side drawer, whose
  // Retrain button polls that too, is not mounted until it is opened).
  // The developer is already on this page by the time they reach for
  // the console, so both have a head start.
  //
  // Kept as the module itself rather than behind React's `lazy`: a
  // `lazy` component is only asked for its chunk on its first render,
  // so the first open still suspended, and React holds a suspended
  // boundary's content back for 300 ms after showing its fallback --
  // the console sat empty for that long with everything it needed
  // already here.
  const queryClient = useQueryClient();
  const [devPanel, setDevPanel] = useState<typeof import("../dev/DevPanel") | null>(null);
  useEffect(() => {
    void import("../dev/DevPanel").then(setDevPanel);
    void queryClient.prefetchQuery(statusQuery);
  }, [queryClient]);

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
  const selectedContent = useMemo(() => {
    if (!point) return null;
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
    point, place, course?.bearing_deg, course?.departure.ident,
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
        step(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (/^[0-5]$/.test(e.key) && point && !isEndpoint(point)) {
        void rate(Number(e.key) as Rating).then(() => step(1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [point, rate, step]);

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
    // from it), and the walk as one list under it. Rating from the
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
    console: devPanel ? <devPanel.DevPanel /> : <div className="h-40" />,
    submit,
    loading: store.loading,
  });
}
