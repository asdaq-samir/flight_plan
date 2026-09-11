import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Shell from "../../Shell";
import Sidebar from "../../components/Sidebar";
import { getParam, setParams as setUrlParams } from "../../lib/urlParams";
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

const FOCUS_ZOOM = 12;

export default function LabelView() {
  const store = useLabelState();
  const point = useMemo(
    () => currentPoint(store),
    [store.selection, store.endpoints, store.detections, store.added],
  );
  const [map, setMap] = useState<L.Map | null>(null);
  const [dep, setDep] = useState(getParam("dep")?.toUpperCase() ?? "C81");
  const [dest, setDest] = useState(getParam("dest")?.toUpperCase() ?? "KDLH");
  const [stepDelta, setStepDelta] = useState(1);

  useEffect(() => { void store.load(dep, dest); }, []);

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

  // Memoized deliberately: without it, this is a new element on every
  // render -- including one for each block of a streaming detection --
  // and ChartMap's halo effect depends on it, so an unrelated re-render
  // would tear the popup down and remount it, not just re-render it.
  const selectedContent = useMemo(() => {
    if (!point) return null;
    const countChanged = lastTotal.current !== null && lastTotal.current !== waypoints.length;
    lastTotal.current = waypoints.length;
    return (
      <PointPopup
        point={point}
        place={place}
        countChanged={countChanged}
        bearingDeg={store.course?.bearing_deg ?? 0}
        departureIdent={store.course?.departure.ident ?? ""}
        onRate={r => void store.rate(r)}
        onCategoryChange={c => void store.setCategory(c)}
        onRemove={() => void store.removeSelected()}
      />
    );
  }, [
    point, place, waypoints.length, store.course?.bearing_deg, store.course?.departure.ident,
    store.rate, store.setCategory, store.removeSelected,
  ]);

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

  /** Space toggles between the point you are on and the whole leg: both are
   *  the same intention, and which you want is obvious from the screen. */
  const toggleView = useCallback(() => {
    if (!store.course || !map) return;
    if (map.getZoom() >= FOCUS_ZOOM) {
      map.fitBounds(store.course.course_line as [number, number][], { padding: [30, 30] });
      return;
    }
    const target = point ? walk.find(e => e.point === point) : walk[0];
    if (target) focus(target);
  }, [store.course, map, point, walk, focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT") return;
      const bearing = store.course?.bearing_deg ?? 0;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return toggleView(); }
      if (e.key === "Escape" && store.course && map) {
        return void map.fitBounds(store.course.course_line as [number, number][], { padding: [30, 30] });
      }
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
  }, [store, point, step, stepList, stepDelta, toggleView, map]);

  const toolbar = (
    <div className="border-b border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RouteForm
          dep={dep} dest={dest} onDepChange={setDep} onDestChange={setDest}
          onSubmit={() => { setUrlParams({ dep, dest }); void store.load(dep, dest); }}
          course={store.course}
        />
        <FilterBar filters={store.filters} onChange={store.setFilter} shown={shown} />
      </div>
    </div>
  );

  const mapOverlay = (
    <>
      {(store.progress || store.error) && (
        <div className={`absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded px-3 py-1.5 text-sm text-white shadow-md ${
          store.error ? "bg-red-600" : "bg-slate-800/90"
        }`}>
          {store.error ?? store.progress}
        </div>
      )}
      <RatingLegend />
    </>
  );

  return (
    <Shell
      toolbar={toolbar}
      mapOverlay={mapOverlay}
      map={
        <ChartMap
          course={store.course}
          endpoints={store.endpoints}
          detections={store.detections}
          added={store.added}
          filters={store.filters}
          selected={point}
          selectedContent={selectedContent}
          onSelect={(kind, index) => store.select({ kind, index })}
          onDeselect={() => store.select(null)}
          onAddAt={(lat, lon) => void store.addPick(lat, lon)}
          onMapReady={setMap}
        />
      }
      sidebar={
        <Sidebar>
          <ProgressCard visiblePicks={visiblePicks} />
          <WaypointList
            entries={listEntries} selected={point} onFocus={focus} hidden={hidden}
            bearingDeg={store.course?.bearing_deg ?? 0}
            departureIdent={store.course?.departure.ident ?? ""}
          />
        </Sidebar>
      }
    />
  );
}
