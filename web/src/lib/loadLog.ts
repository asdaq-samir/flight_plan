import { keptStore } from "./storage";

/**
 * When each of the map's layers first showed, at each load of the app on
 * this device, kept for Setup's Log beside Status, at the owner's ask
 * ("We should log the fresh map load timing in a log page next to Status
 * in setup", 2026-11-05, after a timing of the order the layers come in).
 * The same milestones that timing read, from the page as it draws: the
 * first paint, the map made, its first chart tile, the airspace's rings
 * and altitudes, the VORs and fixes and the airports, as the map's
 * probes record what each layer drew (lib/map/gl/useGlProbe), and when the airspace's
 * and the TFRs' answers came in. Milliseconds from the start of the load.
 *
 * Read by looking, five times a second, not by a MutationObserver: the
 * tiles change the page hundreds of times as it loads, and the look is
 * cheap. Done once every milestone is in, at 30 s, or as the page is
 * left; a load in which the map never came (a page without it) is not
 * kept. The last LOADS_KEPT, newest first, on this device only.
 */
export interface LoadEntry {
  /** When the load began, ISO. */
  at: string;
  /** Whether the app's scripts came from the network (none in the
   *  browser's cache or the service worker's): a fresh load. */
  fresh: boolean;
  /** Each milestone reached, ms from the load's start. */
  ms: Partial<Record<Milestone, number>>;
}

export const MILESTONES = [
  { key: "paint", label: "First paint" },
  { key: "map", label: "Map made" },
  { key: "tile", label: "First chart tile" },
  { key: "airspaceData", label: "Airspace data in" },
  { key: "rings", label: "Airspace rings" },
  { key: "labels", label: "Airspace altitudes" },
  { key: "navaids", label: "VORs and fixes" },
  { key: "tfrData", label: "TFR data in" },
  { key: "airports", label: "Airports" },
] as const;
export type Milestone = typeof MILESTONES[number]["key"];

const LOADS_KEPT = 30;
const LOOK_MS = 200;
const GIVE_UP_MS = 30_000;

export const useLoadLog = keptStore<LoadEntry[]>("wingtip.loadLog", []);

/** Whether a probe's record says it drew anything: a list with an entry,
 *  or counts with one over nought ("{}" and "[]" are a layer with none). */
function drew(record: string | undefined): boolean {
  if (!record || record === "{}" || record === "[]") return false;
  try {
    const kept: unknown = JSON.parse(record);
    if (Array.isArray(kept)) return kept.length > 0;
    if (kept && typeof kept === "object") return Object.values(kept).some(v => typeof v === "number" ? v > 0 : !!v);
  } catch { /* not JSON: drawn, as it was written */ }
  return true;
}

/** Which milestone each of the map's probes stands for. */
const PROBES: Record<string, Milestone> = {
  "airspace-lines": "rings", "airspace-edge-labels": "labels", "navaid-marks": "navaids", "airport-marks": "airports",
};

/** Started once, as the app starts (main.tsx). */
export function startLoadLog(win: Window = window) {
  const perf = win.performance;
  if (!perf?.getEntriesByType) return;
  const ms: LoadEntry["ms"] = {};
  const at = new Date(Date.now() - perf.now()).toISOString();
  const mark = (key: Milestone, when = perf.now()) => { if (ms[key] === undefined) ms[key] = Math.round(when); };
  const answered = (part: string) => perf.getEntriesByType("resource")
    .find(e => e.name.includes(part) && (e as PerformanceResourceTiming).responseEnd > 0) as PerformanceResourceTiming | undefined;
  // The tiles fill the browser's buffer of 250 and the planner's answers
  // fall out of it (the profile notes, 2026-11-03).
  try { perf.setResourceTimingBufferSize?.(4000); } catch { /* kept at its size */ }
  const doc = win.document;
  const look = () => {
    const paint = perf.getEntriesByName("first-contentful-paint")[0];
    if (paint) mark("paint", paint.startTime);
    if (doc.querySelector(".maplibregl-map")) mark("map");
    // The chart's first tile drawn (ChartGl's mark), and what each layer has
    // drawn, as the map's probes say it (lib/map/gl/useGlProbe).
    if (perf.getEntriesByName("chart-drawn").length) mark("tile");
    for (const probe of doc.querySelectorAll<HTMLElement>("[data-gl-probe]")) {
      const name = probe.dataset.glProbe ?? "";
      const milestone = PROBES[name];
      if (milestone && drew(probe.getAttribute(`data-${name}`) ?? undefined)) mark(milestone);
    }
    const airspace = answered("/api/planner/airspace/");
    if (airspace) mark("airspaceData", airspace.responseEnd);
    const tfrs = answered("/api/planner/tfrs");
    if (tfrs) mark("tfrData", tfrs.responseEnd);
  };
  const timer = win.setInterval(() => {
    look();
    if (MILESTONES.every(m => ms[m.key] !== undefined) || perf.now() > GIVE_UP_MS) done();
  }, LOOK_MS);
  let kept = false;
  function done() {
    if (kept) return;
    kept = true;
    win.clearInterval(timer);
    win.removeEventListener("pagehide", done);
    if (ms.map === undefined) return;
    // Fresh where any of the app's scripts came over the network: from the
    // browser's cache or the service worker they carry no bytes.
    const scripts = perf.getEntriesByType("resource").filter(e => /\.js(\?|$)/.test(e.name)) as PerformanceResourceTiming[];
    const fresh = scripts.some(e => e.transferSize > 0);
    const entry: LoadEntry = { at, fresh, ms: { ...ms } };
    useLoadLog.setState(s => ({ value: [entry, ...s.value].slice(0, LOADS_KEPT) }));
  }
  win.addEventListener("pagehide", done);
}

/** The middle of what was measured, ms, or null where none was. */
export function median(values: (number | undefined)[]): number | null {
  const sorted = values.filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
