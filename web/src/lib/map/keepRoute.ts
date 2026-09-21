import type { Course } from "../api/types";
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
 */
export const CORRIDOR_NM = 10;
const CONCURRENCY = 6;

export interface KeepProgress {
  done: number;
  total: number;
  failed: number;
}

function tileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function tileY(lat: number, zoom: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** zoom);
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
        const cx = tileX(lon, z), cy = tileY(lat, z);
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

/** Whether a service worker is holding this app, which is what makes
 *  kept tiles come back without a network. */
export function keepingAvailable(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
}

/**
 * Fetches every corridor tile of `kind` at `zooms`, reporting progress;
 * resolves with the final count. A tile that fails (a 404 where the
 * kind has no sheet, a dropped connection) is counted and skipped.
 */
export async function keepRouteCharts(
  course: Course, kind: string, zooms: number[], onProgress: (p: KeepProgress) => void, signal?: AbortSignal,
): Promise<KeepProgress> {
  if (keepingAvailable()) await navigator.serviceWorker.ready;
  const tiles = corridorTiles(course.course_line as [number, number][], zooms);
  const progress: KeepProgress = { done: 0, total: tiles.length, failed: 0 };
  onProgress({ ...progress });
  let next = 0;
  const worker = async () => {
    while (next < tiles.length && !signal?.aborted) {
      const t = tiles[next++]!;
      try {
        const res = await fetch(tileUrl(course, kind, t.z, t.x, t.y), { signal, priority: "low" });
        if (!res.ok) progress.failed++;
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
