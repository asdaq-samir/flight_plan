import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { ChartInfo } from "../api/types";
import { usePreferences } from "../preferences";
import { holdLevels, pruneOnlyAtRest, type Levels } from "./levelHold";
import { LIVE_TILES, chartPair, levelAhead, tileTemplate, tileUrl, tilesAround } from "./tiles";

// Every tile layer's, the chart's and those under and over it: none
// pruned in a zoom's animation (levelHold).
pruneOnlyAtRest(L.GridLayer.prototype);

/** The level of the chart kept under it (below): a region a tile, some
 *  eleven degrees of longitude, so a route's whole way is one or two. */
const UNDERLAY_ZOOM = 5;
/** The ring tiles remembered as asked for: about a flight's worth of
 *  views, the browser's cache holding the tiles themselves. */
const PREFETCH_KEPT = 2000;
/** How many levels above the view are asked for at rest, for a zoom out
 *  (prefetchRing): two, the arrow's zoom and a flick's, a few tiles. */
const PARENT_LEVELS = 2;
/** How far past the chart's own last zoom the map goes, enlarging it: two
 *  levels, four times, where three (eight times) took it to a blur of
 *  squares ForeFlight never shows (the owner's audit, 2026-11-02). */
const OVERZOOM = 2;

/** The chart's own layers, told from the imagery and weather tiles that
 *  may lie over them: the ones index.css dims at night. */
const CHART_CLASS = "chart-tiles";

interface Props {
  /** The chart: a route's course, or the chart alone with no route. */
  chart: ChartInfo;
  /** A Class B marker's hover: draws the overlay while on, pinned or
   *  not, so a sheet can be looked at without pinning it. */
  previewing: boolean;
}

/**
 * The FAA charts as react-leaflet tile layers: one chart as the map's
 * base (the sectional, or an IFR enroute chart, per the preferences
 * store) and, only while pinned or previewed, the terminal-area sheet
 * that belongs over it -- the TAC over the sectional, the IFR area
 * charts over the IFR enroute charts -- rendered the same way from the
 * FAA's own sheets, one zoom finer, and transparent (a 404 the layer
 * leaves blank) wherever none exists. Nothing replaces the base on its
 * own: past the sectional's detail the map upscales it rather than
 * swapping in a busier sheet the pilot did not ask for.
 *
 * Tiles fetch only the new edge on a pan, scale the previous zoom's
 * tiles under the zoom animation, and prefetch a ring beyond the
 * viewport, all Leaflet's own; LIVE_TILES asks for tiles during a pan
 * too, which a pilot panning across a route felt as the chart arriving
 * late otherwise. A ring of tiles one deep around the
 * view is fetched once the map comes to rest, so the next pan finds
 * its tiles in the browser's cache (and, installed, the service
 * worker's), and a zoom of more than a level fetches the level it is
 * going to as it sets off (prefetchLevel). Each kind is its own layer
 * instance (`key`): Leaflet reads a layer's zooms once.
 */
export function ChartTiles({ chart, previewing }: Props) {
  const map = useMap();
  const base = usePreferences(s => s.base);
  const pinned = usePreferences(s => s.tac);
  const chartNight = usePreferences(s => s.chartNight);
  // On <html>, beside the theme's class, for index.css to dim the chart's
  // tiles and recolour the course at night: one attribute, changed only
  // when the setting is, rather than a class on every layer and path.
  useEffect(() => {
    document.documentElement.dataset.chartNight = chartNight;
  }, [chartNight]);
  const { base: baseLayer, overlay } = useMemo(() => chartPair(chart.chart_layers, base), [chart.chart_layers, base]);
  // The map no further in than the chart goes (OVERZOOM): left to its
  // layers, an overlay's own reach (the imagery's 20, Google's 22) took
  // the map past the chart's last level, where the chart was no longer
  // drawn and only the overlay was left over grey (a probe on the phone
  // viewport, 2026-11-03: 14 with no overlay, 20 with the imagery on).
  const lastZoom = baseLayer ? baseLayer.max_zoom + OVERZOOM : null;
  useEffect(() => {
    if (lastZoom !== null) map.setMaxZoom(lastZoom);
  }, [map, lastZoom]);
  const overlayShown = !!overlay && (pinned || previewing);
  const baseRef = useRef<L.TileLayer>(null);
  const overlayRef = useRef<L.TileLayer>(null);
  useHeldLevels(baseRef, baseLayer?.kind);
  useHeldLevels(overlayRef, overlayShown ? overlay.kind : undefined);

  const prefetched = useRef(new Set<string>());
  // A layer's tiles at a level fetched ahead, into the browser's cache
  // (and, installed, the service worker's), for Leaflet's own to find
  // there. The tile's own address (tiles.ts), not the layer's getTileUrl,
  // which writes the layer's present zoom into {z} whatever the coords
  // say: the parents below came out as tiles of the view's zoom at the
  // parents' x and y, far away, thirty-three wrong tiles asked for at
  // every rest (the first after-measurement, 2026-11-03).
  const ask = useCallback((kind: string, z: number, tiles: [number, number][], priority: "low" | "high") => {
    const n = 2 ** z;
    for (const [x, y] of tiles) {
      if (y < 0 || y >= n) continue;
      const url = tileUrl(chart, kind, z, ((x % n) + n) % n, y);
      // Once a tile: own ship followed ends a move at every fix, and the
      // ring was asked for again each time, twenty requests a second.
      if (prefetched.current.has(url)) continue;
      prefetched.current.add(url);
      if (prefetched.current.size > PREFETCH_KEPT) prefetched.current.delete(prefetched.current.values().next().value!);
      void fetch(url, { priority }).catch(() => { /* a miss now is a miss later, nothing to do */ });
    }
  }, [chart]);

  const prefetchRing = useCallback(() => {
    if (!baseRef.current || !baseLayer) return;
    const zoom = Math.round(map.getZoom());
    if (zoom < baseLayer.min_zoom || zoom > baseLayer.max_zoom) return;
    const size = 256;
    const pixelBounds = map.getPixelBounds();
    // The levels above first (PARENT_LEVELS), each the screen's worth of
    // tiles round the view's middle at that zoom -- what a zoom out shows,
    // a dozen tiles a level: a zoom out (the location arrow's, a flick)
    // asked for its coarser tiles only once it had crossed the level, and
    // held the chart at the region's blur until they came, 1.0 to 1.3 s
    // on the phone viewport for the twelve tiles of zoom 7 over Chicago (a
    // probe, 2026-11-03). Asked for at rest they are in the browser's or
    // the service worker's cache when the zoom comes (a tile fetched ahead
    // reaches Leaflet's image from the cache in 3 ms, measured). Before
    // the ring, which the browser fetches six at a time: asked for after
    // it, the parents were still coming when a zoom out came six seconds
    // later on a loaded Mac. Only the parents of the view's own tiles were
    // asked for at first, a tile or two of the dozen the zoomed-out
    // screen needs, and the zoom out gained nothing.
    const centre = map.getCenter();
    const half = map.getSize().divideBy(2);
    for (let up = 1; up <= PARENT_LEVELS; up++) {
      const z = zoom - up;
      if (z < baseLayer.min_zoom) break;
      ask(baseLayer.kind, z, tilesAround(map.project(centre, z), half), "low");
    }
    const range = {
      minX: Math.floor(pixelBounds.min!.x / size) - 1, maxX: Math.floor(pixelBounds.max!.x / size) + 1,
      minY: Math.floor(pixelBounds.min!.y / size) - 1, maxY: Math.floor(pixelBounds.max!.y / size) + 1,
    };
    const ring: [number, number][] = [];
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const edge = x === range.minX || x === range.maxX || y === range.minY || y === range.maxY;
        if (edge) ring.push([x, y]);
      }
    }
    ask(baseLayer.kind, zoom, ring, "low");
  }, [map, baseLayer, ask]);

  // A zoom of more than a level -- the location arrow's, a route's fit --
  // asks for the level it is going to as it sets off, for each chart layer
  // drawn: Leaflet asks only once its quarter second of animation is over
  // (levelAhead), and the new level was then held until its tiles came.
  // The screen's worth at the zoom's end, nothing round it; the terminal
  // sheet's only where a sheet of it is in that view, as it is blank (a
  // 404) everywhere else.
  const prefetchLevel = useCallback((event: L.ZoomAnimEvent) => {
    const from = map.getZoom();
    const half = map.getSize().divideBy(2);
    for (const layer of [baseLayer, overlayShown ? overlay : null]) {
      if (!layer) continue;
      const z = levelAhead(from, event.zoom, layer);
      if (z === null) continue;
      const middle = map.project(event.center, z);
      const reach = half.multiplyBy(map.getZoomScale(z, event.zoom));
      if (!layer.base) {
        const view = L.latLngBounds(map.unproject(middle.subtract(reach), z), map.unproject(middle.add(reach), z));
        if (!layer.sheets.some(s => view.intersects(L.latLngBounds([s.south, s.west], [s.north, s.east])))) continue;
      }
      ask(layer.kind, z, tilesAround(middle, reach), "high");
    }
  }, [map, baseLayer, overlay, overlayShown, ask]);

  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Memoized for the reason `AirportsLayer` spells out: a handlers
  // object literal re-registers the listener on every commit, and an
  // event fired in that same commit is lost.
  useMapEvents(useMemo(() => ({
    moveend: () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
      // Once the move's own work is done and the thread idle: every edge
      // tile's address made and asked for took 16 ms at the move's end
      // (Session2's profile, 2026-11-03), where the marks and rings draw.
      prefetchTimer.current = setTimeout(() => {
        if ("requestIdleCallback" in window) window.requestIdleCallback(prefetchRing, { timeout: 1000 });
        else prefetchRing();
      }, 250);
    },
    zoomanim: prefetchLevel,
  }), [prefetchRing, prefetchLevel]));
  useEffect(() => () => { if (prefetchTimer.current) clearTimeout(prefetchTimer.current); }, []);

  if (!baseLayer) return null;
  // The same chart at a region's level under it, always there: one or two
  // tiles at any zoom, loaded with the first view and kept. Where the
  // chart's own tiles are not in yet -- round what was in sight as the map
  // zooms out to a route, the edge of a pan -- the chart shows coarse
  // rather than grey, as Maps' does, at the owner's notice ("going from
  // current location to zoom out is not smooth"). Not below its level,
  // where the chart's own are as coarse. Asked for under a moving finger
  // too (LIVE_TILES), as the chart over it is: a pan onto fresh ground
  // had it only once the finger lifted, on a phone, where it is what is
  // there before the chart's own come (the map-load audit, 2026-11-04).
  const underlay = Math.max(baseLayer.min_zoom, UNDERLAY_ZOOM);
  return (
    <>
      {underlay < baseLayer.max_zoom && (
        <TileLayer
          key={`${baseLayer.kind}-under`}
          url={tileTemplate(chart, baseLayer.kind)}
          minZoom={underlay} maxNativeZoom={underlay} maxZoom={baseLayer.max_zoom + OVERZOOM}
          keepBuffer={1} zIndex={0} updateWhenZooming={false} className={CHART_CLASS} {...LIVE_TILES}
        />
      )}
      <TileLayer
        key={baseLayer.kind} ref={baseRef}
        url={tileTemplate(chart, baseLayer.kind)}
        minZoom={baseLayer.min_zoom} maxNativeZoom={baseLayer.max_zoom} maxZoom={baseLayer.max_zoom + OVERZOOM}
        keepBuffer={4} className={CHART_CLASS} {...LIVE_TILES}
      />
      {overlayShown && (
        <TileLayer
          key={overlay.kind} ref={overlayRef}
          url={tileTemplate(chart, overlay.kind)}
          // No further in than the chart under it: the map's own last zoom
          // is its layers' furthest.
          minZoom={overlay.min_zoom} maxNativeZoom={overlay.max_zoom} maxZoom={baseLayer.max_zoom + OVERZOOM}
          keepBuffer={2} zIndex={5} className={CHART_CLASS} {...LIVE_TILES}
        />
      )}
    </>
  );
}

/** The hold of each new zoom level until its tiles are in (levelHold),
 *  on the layer while it is drawn. */
function useHeldLevels(ref: RefObject<L.TileLayer | null>, kind: string | undefined) {
  useEffect(() => {
    const layer = ref.current as Levels | null;
    if (!layer || !kind) return;
    return holdLevels(layer);
  }, [ref, kind]);
}
