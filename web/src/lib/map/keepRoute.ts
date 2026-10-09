import L from "leaflet";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "../api/client";
import type { ChartLayer, Course } from "../api/types";
import { diagramPicture, diagramRunwaysPicture } from "../diagram";
import { tileUrl } from "./tiles";

/**
 * The tiles a route needs in the air, fetched now so the service
 * worker holds them: every tile of the base chart within the corridor
 * either side of the course line, at every zoom from a whole-route
 * view down to the chart's own detail. Leaflet asks for exactly these
 * URLs later, and the worker (vite.config.ts, chart-tiles) answers
 * from its cache before the network, connection or none.
 *
 * Sized for a phone: a 300 nm route at zooms 8 to 12 is about a
 * thousand tiles, fifteen megabytes. The fetches run a few at a time
 * so the map itself stays responsive while they land.
 *
 * The route's airports' diagrams come with them (airport-diagrams in
 * the worker), a third of a megabyte each, so a card opened on the
 * ground at the other end shows its field's with no network.
 */
export const CORRIDOR_NM = 10;
const CONCURRENCY = 6;

export interface KeepProgress {
  done: number;
  total: number;
  failed: number;
}

const TILE_PX = 256;

/** The {x, y} of the tile a point falls in, from Leaflet's own Web
 *  Mercator projection -- the same one the map uses to decide which
 *  tiles to ask for, so these are the URLs it will ask for later.
 *  Hand-written longitude and Gudermannian latitude formulas stood
 *  here; Leaflet is already loaded and has both. */
function tileOf(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const point = L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lon), zoom);
  return { x: Math.floor(point.x / TILE_PX), y: Math.floor(point.y / TILE_PX) };
}

/** Tile width in nautical miles at a latitude and zoom. */
function tileNm(lat: number, zoom: number): number {
  return (21638.8 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** The {z, x, y} of every tile within the corridor, per zoom. */
export function corridorTiles(line: [number, number][], zooms: number[], corridorNm = CORRIDOR_NM): { z: number; x: number; y: number }[] {
  const tiles = new Map<string, { z: number; x: number; y: number }>();
  for (const z of zooms) {
    const n = 2 ** z;
    for (let i = 1; i < line.length; i++) {
      const [lat0, lon0] = line[i - 1]!;
      const [lat1, lon1] = line[i]!;
      const width = tileNm((lat0 + lat1) / 2, z);
      const reach = Math.ceil(corridorNm / width);
      // Samples every half a tile along the segment, a ring of tiles
      // `reach` deep around each -- the union is the corridor.
      const segmentNm = Math.hypot((lat1 - lat0) * 60, (lon1 - lon0) * 60 * Math.cos(((lat0 + lat1) / 2) * Math.PI / 180));
      const steps = Math.max(1, Math.ceil(segmentNm / (width / 2)));
      for (let s = 0; s <= steps; s++) {
        const lat = lat0 + ((lat1 - lat0) * s) / steps;
        const lon = lon0 + ((lon1 - lon0) * s) / steps;
        const { x: cx, y: cy } = tileOf(lat, lon, z);
        for (let x = cx - reach; x <= cx + reach; x++) {
          for (let y = Math.max(0, cy - reach); y <= Math.min(n - 1, cy + reach); y++) {
            const wrapped = ((x % n) + n) % n;
            tiles.set(`${z}/${wrapped}/${y}`, { z, x: wrapped, y });
          }
        }
      }
    }
  }
  return [...tiles.values()];
}

/** Whether a service worker can hold this app, which is what makes
 *  kept tiles come back without a network. */
export function keepingAvailable(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
}

/** How long to wait for the service worker to be ready. The dev server
 *  registers none, and `ready` then never settles: "Keeping…" sat there
 *  for ever. */
export const WORKER_WAIT_MS = 5000;

class NoServiceWorker extends Error {
  constructor() {
    super("No service worker is holding this app here, so nothing would be kept. The dev server registers none.");
    this.name = "NoServiceWorker";
  }
}

async function workerReady(): Promise<boolean> {
  if (!keepingAvailable()) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), WORKER_WAIT_MS); });
  try {
    return await Promise.race([navigator.serviceWorker.ready.then(() => true as const), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The route's airports' diagrams and their runway crops, by their cards
 *  (cached by the worker too): none for a waypoint, a field with none, or
 *  a card that could not be had. A field may have a diagram and no crop. */
async function routeDiagrams(course: Course): Promise<string[]> {
  const idents = [...new Set([course.departure, ...(course.stops ?? []), course.destination]
    .filter(a => a.kind !== "fix").map(a => a.ident))];
  const cards = await Promise.allSettled(idents.map(ident => api.airport(ident)));
  return cards.flatMap(card => (card.status === "fulfilled" && card.value.airport_diagram_cycle
    ? [diagramPicture(card.value.ident, card.value.airport_diagram_cycle),
       diagramRunwaysPicture(card.value.ident, card.value.airport_diagram_cycle)] : []));
}

/**
 * Fetches every corridor tile of `kind` at `zooms`, and the route's
 * airports' diagrams, reporting progress; resolves with the final
 * count. A tile that fails (a 404 where the kind has no sheet, a
 * dropped connection) is counted and skipped.
 */
async function keepRouteCharts(
  course: Course, kind: string, zooms: number[], onProgress: (p: KeepProgress) => void, signal?: AbortSignal,
): Promise<KeepProgress> {
  if (!(await workerReady())) throw new NoServiceWorker();
  const urls = [
    ...await routeDiagrams(course),
    ...corridorTiles(course.course_line as [number, number][], zooms).map(t => tileUrl(course, kind, t.z, t.x, t.y)),
  ];
  const progress: KeepProgress = { done: 0, total: urls.length, failed: 0 };
  onProgress({ ...progress });
  let next = 0;
  const worker = async () => {
    while (next < urls.length && !signal?.aborted) {
      const url = urls[next++]!;
      try {
        const res = await fetch(url, { signal, priority: "low" });
        // A 404 for a runway crop is the field having none (the card draws
        // its sketch), not a failure to keep.
        if (!res.ok && !(res.status === 404 && url.includes("/runways/"))) progress.failed++;
      } catch {
        if (signal?.aborted) return;
        progress.failed++;
      }
      progress.done++;
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return progress;
}

/**
 * The one keep in progress, or the last one's outcome, held by the page
 * rather than by what started it: that lived in the pilot console's
 * Guide tab, and closing the console or changing tabs unmounted it and
 * cancelled the download, silently, and reopening it had lost where it
 * had got to. Which download it is (`key`) is the route, the chart, the
 * edition and the revision -- the tile URLs it fetches.
 */
export type KeepJob =
  | { status: "idle" }
  | { status: "keeping"; key: string; progress: KeepProgress | null }
  | { status: "kept"; key: string; progress: KeepProgress }
  | { status: "failed"; key: string; detail: string };

export const useKeepJob = create<KeepJob>(() => ({ status: "idle" }));

/** How long a keep counts as kept: well inside the sixty days the
 *  worker holds a tile (vite.config.ts, chart-tiles). */
const KEPT_FOR_MS = 30 * 24 * 3600 * 1000;

/**
 * The keeps that finished, by key and when, remembered per browser: with
 * Keep Charts Offline on, a route opened again -- a reload, a saved
 * flight -- is not downloaded again while its tiles are still held.
 */
export const useKeptCharts = create<{ kept: Record<string, number> }>()(
  persist(() => ({ kept: {} }), { name: "vfr.kept-charts" }),
);

export function keptAlready(key: string, now = Date.now()): boolean {
  const at = useKeptCharts.getState().kept[key];
  return at !== undefined && now - at < KEPT_FOR_MS;
}

function remember(key: string, now = Date.now()) {
  useKeptCharts.setState(s => ({
    kept: Object.fromEntries([...Object.entries(s.kept).filter(([, at]) => now - at < KEPT_FOR_MS), [key, now]]),
  }));
}

export function keepKey(course: Course, kind: string): string {
  const route = [course.departure, ...(course.stops ?? []), course.destination].map(a => a.ident).join("->");
  return `${route}/${kind}/${course.chart_cycle}/${course.chart_revision ?? 0}`;
}

/** The zooms kept: from a whole-route view (8) down to the chart's own detail. */
function keptZooms(layer: ChartLayer): number[] {
  return Array.from({ length: layer.max_zoom - 8 + 1 }, (_, i) => 8 + i).filter(z => z >= layer.min_zoom);
}

let current: AbortController | null = null;

/** Keeps `layer`'s tiles of the route, cancelling any keep before it.
 *  Only the latest keep writes the job: an earlier one finishing late
 *  cannot overwrite it. */
export async function keep(course: Course, layer: ChartLayer): Promise<void> {
  current?.abort();
  const mine = new AbortController();
  current = mine;
  const key = keepKey(course, layer.kind);
  const write = (job: KeepJob) => { if (current === mine) useKeepJob.setState(job, true); };
  write({ status: "keeping", key, progress: null });
  try {
    const progress = await keepRouteCharts(
      course, layer.kind, keptZooms(layer), p => write({ status: "keeping", key, progress: p }), mine.signal,
    );
    if (mine.signal.aborted) return;
    if (progress.failed < progress.total) remember(key);
    write({ status: "kept", key, progress });
  } catch (err) {
    write({ status: "failed", key, detail: err instanceof Error ? err.message : String(err) });
  } finally {
    if (current === mine) current = null;
  }
}

/** The keep in progress stopped, and nothing said of it: the setting
 *  turned off. */
export function stopKeeping(): void {
  if (!current) return;
  current.abort();
  current = null;
  useKeepJob.setState({ status: "idle" }, true);
}
