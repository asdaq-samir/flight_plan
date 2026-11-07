import type { ChartInfo, ChartLayer, ChartSheet } from "../api/types";

/**
 * The chart the map draws as its base -- the kind asked for, or the
 * sectional where the course has no such layer -- and the terminal-area
 * kind that belongs over that base: the TAC over the sectional, the IFR
 * area charts over the IFR enroute ones. Resolved here once, for every
 * reader: the Class B pin resolved its own, always the TAC's, and said
 * "Pin the Chicago TAC" on an IFR base while the map drew the IFR area
 * chart.
 */
export function chartPair(layers: ChartLayer[], base: string): { base: ChartLayer | null; overlay: ChartLayer | null } {
  const baseLayer = layers.find(l => l.kind === base) ?? layers.find(l => l.kind === "sec") ?? null;
  const overlay = baseLayer ? layers.find(l => !l.base && l.over.includes(baseLayer.kind)) ?? null : null;
  return { base: baseLayer, overlay };
}

/** The overlay's sheet at a point -- what pinning the overlay there
 *  would draw -- or null where it has none. */
export function sheetAt(overlay: ChartLayer | null, lat: number, lon: number): ChartSheet | null {
  return overlay?.sheets.find(s => s.south <= lat && lat <= s.north && s.west <= lon && lon <= s.east) ?? null;
}

/**
 * Where a chart kind's tiles come from. Published to a CDN (the AWS
 * deployment) they come straight from there and the cycle is a path
 * segment; served by the planner itself, through the gateway, the
 * cycle is the cache-busting query: the tiles are cacheable for weeks,
 * and a browser that cached this {z}/{x}/{y} under an earlier edition
 * must ask again when the edition changes.
 *
 * The revision rides along for the same reason: tiles rendered again
 * within an edition (a sheet cleaned on disk) keep {z}/{x}/{y} and the
 * cycle, and the service worker answers from its cache before it ever
 * asks the network -- one phone showed a white sliver the planner had
 * long since stopped drawing.
 */
/** Every tile layer's: its tiles asked for while a finger moves the map,
 *  not once it lifts. Leaflet waits for a pan to end on a phone
 *  (updateWhenIdle, by its own check for one): the chart was asked for
 *  under the finger already, the imagery over it only after (the owner's
 *  notice, 2026-10-16: "Only updates when the finger is off the screen"). */
export const LIVE_TILES = { updateWhenIdle: false } as const;

/** The cycle and revision a kind's tiles are drawn from: its layer's own,
 *  each kind going over to a new cycle as its pyramid is finished
 *  (wingtip.charts.serving_cycle_of), else the chart's, the sectional's. */
export function kindCycle(chart: Pick<ChartInfo, "chart_cycle" | "chart_revision" | "chart_layers">, kind: string): { cycle: string; revision: number } {
  const layer = chart.chart_layers?.find(l => l.kind === kind);
  // A course cached offline from before the planner reported one has none.
  return layer?.cycle ? { cycle: layer.cycle, revision: layer.revision ?? 0 } : { cycle: chart.chart_cycle, revision: chart.chart_revision ?? 0 };
}

/**
 * The "@2x" a kind's tile names carry on this screen: on a 2x or 3x
 * screen, where the kind was drawn at twice the pixels too (its layer's
 * `scales`), the 512-pixel tile of the same z/x/y, drawn from the FAA's
 * sheet at that size. Leaflet lays it out in the tile's own 256 CSS
 * pixels, so nothing about the grid changes, only how sharp it is: the
 * 256-pixel tile stretched three times by the browser blurred every
 * letter and line on a phone. (MapLibre, which counts its zoom in
 * 512-pixel tiles, takes the same URLs with tileSize 256.) None where the
 * kind has only 256-pixel tiles, as a cycle drawn before there were any
 * has, and none on a 1x screen, which would only shrink them.
 */
export function tileDensity(chart: Pick<ChartInfo, "chart_layers">, kind: string, pixelRatio = globalThis.devicePixelRatio ?? 1): "" | "@2x" {
  const layer = chart.chart_layers?.find(l => l.kind === kind);
  return pixelRatio > 1 && layer?.scales?.includes(2) ? "@2x" : "";
}

export function tileTemplate(chart: ChartInfo, kind: string): string {
  const { cycle, revision } = kindCycle(chart, kind);
  const density = tileDensity(chart, kind);
  return chart.chart_tiles_base
    ? `${chart.chart_tiles_base}/${cycle}/${kind}/{z}/{x}/{y}${density}.png?r=${revision}`
    : `/api/planner/chart-tile/${kind}/{z}/{x}/{y}${density}.png?c=${cycle}&r=${revision}`;
}

export function tileUrl(chart: ChartInfo, kind: string, z: number, x: number, y: number): string {
  return tileTemplate(chart, kind).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Leaflet's tiles, square, in pixels at their own level. */
const TILE_PX = 256;

/**
 * The tiles a view needs at a level: those within `half` of `middle`
 * either way, both in that level's pixels, as [column, row], nearest the
 * middle first, as Leaflet asks for its own. Columns are left as they
 * fall, past the antimeridian too, and rows unchecked: the asker wraps
 * and drops them (ChartTiles' ask).
 */
export function tilesAround(middle: { x: number; y: number }, half: { x: number; y: number }): [number, number][] {
  const tiles: [number, number][] = [];
  for (let x = Math.floor((middle.x - half.x) / TILE_PX); x <= Math.floor((middle.x + half.x) / TILE_PX); x++) {
    for (let y = Math.floor((middle.y - half.y) / TILE_PX); y <= Math.floor((middle.y + half.y) / TILE_PX); y++) tiles.push([x, y]);
  }
  const off = ([x, y]: [number, number]) => Math.hypot((x + 0.5) * TILE_PX - middle.x, (y + 0.5) * TILE_PX - middle.y);
  return tiles.sort((a, b) => off(a) - off(b));
}

/**
 * The level a zoom to `to` draws a chart layer at, where Leaflet asks for
 * that level's tiles only once the zoom's animation is over: a zoom of
 * more than a level from `from`. GridLayer's _update keeps the level it
 * has while the map is more than one from it, and as the animation starts
 * the map is still at `from`, so the location arrow's zoom and a route's
 * fit asked for their chart a quarter of a second late (the map-load
 * audit, 2026-11-04). Past the layer's last level it is drawn enlarged
 * from that level. Null for a zoom of a level or less, which Leaflet asks
 * for itself as it starts, and below the layer's first level, where it
 * draws nothing.
 */
export function levelAhead(from: number, to: number, layer: Pick<ChartLayer, "min_zoom" | "max_zoom">): number | null {
  const level = Math.round(to);
  if (level < layer.min_zoom) return null;
  const drawn = Math.min(level, layer.max_zoom);
  return Math.abs(Math.min(from, layer.max_zoom) - drawn) > 1 ? drawn : null;
}

/** How long one slice of the tiles fetched ahead may hold the main thread,
 *  ms: a few tiles, then the browser's own work -- a frame, an overlay's
 *  answer -- before the next. */
export const PREFETCH_SLICE_MS = 8;

/** Runs `go` when the main thread is idle, and how to call it off. Safari
 *  has no requestIdleCallback: a task of its own there, after whatever is
 *  waiting already. */
export type IdleRun = (go: (deadline: IdleDeadline | null) => void) => () => void;
const whenIdle: IdleRun = go => {
  // Asked of the function, not `in window`: the DOM types declare it
  // always, so `in` narrowed window to never in the branch after.
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(go, { timeout: 1000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(() => go(null), 0);
  return () => window.clearTimeout(handle);
};

/**
 * The chart's tiles fetched ahead into the browser's cache (ChartTiles),
 * each once. A zoom's own level goes at once (`now`), as the zoom starts.
 * The ring round a view at rest and the levels above it (`later`) go a
 * few at a time in the main thread's idle moments, a slice of
 * PREFETCH_SLICE_MS each: asked all at once, the fifty or so fetch()
 * calls of a rest after a zoom took 30 to 130 ms of the phone viewport's
 * main thread at CPU 4x in one go, 1.9 ms a call, just as the overlays'
 * answers came in to be drawn (a profile, 2026-11-04; the owner, "make it
 * fast but stable"). A new rest drops those of the last not yet asked for
 * (`drop`), which are asked again if the new one wants them.
 */
export class TilePrefetch {
  private readonly sent = new Set<string>();
  private queue: string[] = [];
  private cancel: (() => void) | null = null;

  constructor(
    private readonly kept: number,
    private readonly get: (url: string, priority: "low" | "high") => void = (url, priority) => {
      void fetch(url, { priority }).catch(() => { /* a miss now is a miss later, nothing to do */ });
    },
    private readonly idle: IdleRun = whenIdle,
    private readonly clock = () => performance.now(),
  ) {}

  /** Asked at once, at high priority. */
  now(urls: string[]): void {
    for (const url of urls) this.send(url, "high");
  }

  /** Asked a slice at a time when the main thread is idle, at low priority. */
  later(urls: string[]): void {
    for (const url of urls) if (!this.sent.has(url)) this.queue.push(url);
    if (this.queue.length && !this.cancel) this.cancel = this.idle(this.drain);
  }

  /** Those not yet asked for, dropped: the map has moved on. */
  drop(): void {
    this.queue = [];
    this.cancel?.();
    this.cancel = null;
  }

  /** Whether `url` has been asked for (and is still remembered). */
  asked(url: string): boolean {
    return this.sent.has(url);
  }

  private send(url: string, priority: "low" | "high"): void {
    // Once a tile: own ship followed ends a move at every fix, and the
    // ring was asked for again each time, twenty requests a second.
    if (this.sent.has(url)) return;
    this.sent.add(url);
    if (this.sent.size > this.kept) this.sent.delete(this.sent.values().next().value!);
    this.get(url, priority);
  }

  private readonly drain = (deadline: IdleDeadline | null): void => {
    this.cancel = null;
    const start = this.clock();
    // At least one a slice, so a busy thread's timed-out turn still moves on.
    do {
      const url = this.queue.shift();
      if (url === undefined) break;
      this.send(url, "low");
    } while (this.queue.length && this.clock() - start < PREFETCH_SLICE_MS && (!deadline || deadline.didTimeout || deadline.timeRemaining() > 1));
    if (this.queue.length) this.cancel = this.idle(this.drain);
  };
}
