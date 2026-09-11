import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ChartMap from "../chart/ChartMap";
import { isEndpoint, type Point, type Rating } from "../api/types";
import {
  COLORS, FILTER_KEYS, forwardIsLeft, forwardIsUp, hasRating, hiddenCount,
  isVisible, orderedPoints, roleOf, sourceOf,
} from "./logic";
import { currentPoint, useLabelStore } from "./store";

const FOCUS_ZOOM = 12;

export default function LabelView() {
  const [params, setParams] = useSearchParams();
  const store = useLabelStore();
  const point = useLabelStore(currentPoint);
  const [map, setMap] = useState<L.Map | null>(null);
  const [dep, setDep] = useState(params.get("dep")?.toUpperCase() ?? "C81");
  const [dest, setDest] = useState(params.get("dest")?.toUpperCase() ?? "KDLH");
  const [legendOpen, setLegendOpen] = useState(true);
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

  const positionOf = useCallback(
    (p: Point) => waypoints.findIndex(e => e.point === p),
    [waypoints],
  );

  /** What to say about the selected point, pinned to its ring. */
  const selectedLabel = useMemo(() => {
    if (!point) return undefined;
    const at = positionOf(point);
    const place = at >= 0 ? ` · ${at + 1} of ${waypoints.length}` : "";
    if (isEndpoint(point)) {
      return `<span class="tipbox" style="background:#142430">` +
        `${point.category === "departure" ? "DEP" : "DEST"}</span><b>${point.ident}</b>` +
        `<div class="sub">${point.name}</div>`;
    }
    // The rating leads, in the colour its marker carries and the scale
    // gives it, so label, pin and legend agree at a glance.
    const rating = (point as { rating: Rating | null }).rating;
    const box = rating !== null
      ? `<span class="tipbox" style="background:${COLORS[rating]}">${rating}</span>`
      : `<span class="tipbox hollow">–</span>`;
    const cross = (point as { cross_track_nm: number }).cross_track_nm ?? 0;
    return box + `<b>${(point as { category: string }).category}</b>` +
      `<div class="sub">${point.along_track_nm.toFixed(1)} nm along · ` +
      `${Math.abs(cross).toFixed(2)} nm off course${place}</div>`;
  }, [point, positionOf, waypoints.length]);

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
  }, [store, point, step, stepDelta, toggleView, map]);

  return (
    <>
      <header>
        <div className="hrow">
          <span className="brand">Route</span>
          <form
            onSubmit={e => {
              e.preventDefault();
              setParams({ dep, dest });
              void store.load(dep, dest);
            }}
          >
            <input value={dep} onChange={e => setDep(e.target.value.toUpperCase())} aria-label="Departure" />
            <span>&rarr;</span>
            <input value={dest} onChange={e => setDest(e.target.value.toUpperCase())} aria-label="Destination" />
            <button type="submit">Load</button>
          </form>
          <span id="dist">
            {store.course && (
              <>
                <b>{store.course.distance_nm}</b> nm ·{" "}
                {String(store.course.bearing_deg).padStart(3, "0")}°T
              </>
            )}
          </span>
        </div>
        <div className="hrow">
          <span id="stats">Showing: <b className="num">{shown}</b></span>
          <span id="filters" title="Which waypoints to show and count">
            {FILTER_KEYS.map((key, i) => (
              <span key={key} style={{ display: "contents" }}>
                {(i === 2 || i === 4) && <span className="fsep" />}
                <label>
                  <input
                    type="checkbox"
                    checked={store.filters[key]}
                    onChange={e => store.setFilter(key, e.target.checked)}
                  />{" "}
                  {key === "dr" ? "DR" : key}
                </label>
              </span>
            ))}
          </span>
        </div>
      </header>

      <div id="middle">
        <ChartMap
          course={store.course}
          endpoints={store.endpoints}
          detections={store.detections}
          added={store.added}
          filters={store.filters}
          selected={point}
          selectedLabel={selectedLabel}
          onSelect={(kind, index) => store.select({ kind, index })}
          onAddAt={(lat, lon) => void store.addPick(lat, lon, "other")}
          onMapReady={setMap}
        />
        {(store.progress || store.error) && (
          <div id="flash" className={store.error ? "on bad" : "on"}>
            {store.error ?? store.progress}
          </div>
        )}
        <div id="side">
          <h2 className="picks-h">
            Rated <span className="count" id="pickcount"><b>{visiblePicks.length}</b></span>
          </h2>
          <div id="pickbreak">
            <div className="pbox">
              <div className="pline"><b>{visiblePicks.filter(p => roleOf(p) === "dr").length}</b><span>DR</span></div>
              <div className="pline"><b>{visiblePicks.filter(p => roleOf(p) === "visual").length}</b><span>visual</span></div>
            </div>
            <div className="pbox">
              <div className="pline"><b>{visiblePicks.filter(p => sourceOf(p) === "detected").length}</b><span>detected</span></div>
              <div className="pline"><b>{visiblePicks.filter(p => sourceOf(p) === "added").length}</b><span>added</span></div>
            </div>
          </div>
          <div id="list">
            {walk.filter(e => isEndpoint(e.point) || hasRating(e.point)).map(entry => {
              const p = entry.point;
              const selectedHere = p === point;
              if (isEndpoint(p)) {
                return (
                  <div key={`e${entry.index}`}
                       className={`row endpoint${selectedHere ? " on" : ""}`}
                       onClick={() => focus(entry)}>
                    <span className="pill" style={{ background: "#142430" }}>
                      {p.category === "departure" ? "DEP" : "DEST"}
                    </span>
                    <span className="t"> {p.ident}</span>
                    <div className="m">{p.name}</div>
                  </div>
                );
              }
              const rating = (p as { rating: Rating }).rating;
              return (
                <div key={`${entry.kind}${entry.index}`}
                     className={`row${selectedHere ? " on" : ""}`}
                     onClick={() => focus(entry)}>
                  <span className="pill" style={{ background: COLORS[rating] }}>{rating}</span>
                  <span className="t"> {(p as { category: string }).category}</span>
                  <span className="pill"
                        style={{ background: roleOf(p) === "visual" ? "#7b3fa0" : "#1f5c8b", marginLeft: 4 }}>
                    {roleOf(p) === "visual" ? "visual" : "DR"}
                  </span>
                  <div className="m">{p.along_track_nm.toFixed(1)} nm along</div>
                  <div className="m coord">{p.lat.toFixed(4)}, {p.lon.toFixed(4)}</div>
                </div>
              );
            })}
            {hidden > 0 && (
              <div className="row" style={{ cursor: "default", color: "var(--muted)" }}>
                {hidden} waypoint{hidden === 1 ? "" : "s"} unselected — tick to show
              </div>
            )}
          </div>
        </div>
      </div>

      {legendOpen && (
        <div id="legend">
          <div className="lgq">
            Flying this leg, would I look up and know <i>that&rsquo;s the one</i> — not one like it?
          </div>
          <div className="lgscale">
            {([
              [0, "Not a feature.", "Contour, boundary, chart text. The detector is wrong."],
              [1, "", "Real, but you’d never use it. One creek among a dozen."],
              [2, "", "You’d have to hunt, and might not be sure you found it."],
              [3, "", "Workable. Findable, but confusable with something nearby."],
              [4, "", "You’d expect to spot it and be confident."],
              [5, "", "Unmistakable. On the nav log without a second thought."],
            ] as [Rating, string, string][]).map(([n, lead, text]) => (
              <span className="lgitem" key={n}>
                <span className="sw" style={{ background: COLORS[n] }}>{n}</span>
                {lead && <b>{lead}</b>} {text}
              </span>
            ))}
          </div>
          <div className="lgnote">
            <b>0 vs 1 matters most</b> — 0 means the detector should never have surfaced it,
            1 means it&rsquo;s real but poor. They fix different things. <b>Ignore spacing</b>;
            selection already enforces separation. <b>Ignore what you know</b> the chart
            doesn&rsquo;t show. <b>Judge at this zoom</b>.
          </div>
        </div>
      )}

      <footer>
        <div className="frow">
          <span><kbd>Space</kbd> start / resume / whole route · <kbd>0</kbd>–<kbd>5</kbd> rate</span>
        </div>
        <div className="frow">
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>&larr;</kbd><kbd>&rarr;</kbd> step the way the course runs</span>
          <span><kbd>Del</kbd> remove · click the course to add</span>
        </div>
        <div className="frow minor">
          <span><kbd>t</kbd> toggle FAA / OSM</span>
          <button type="button" className="viewbtn" style={{ marginLeft: "auto" }}
                  onClick={() => setLegendOpen(o => !o)}>
            {legendOpen ? "Hide scale" : "Show scale"}
          </button>
        </div>
      </footer>
    </>
  );
}
