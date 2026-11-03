import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { ChartInfo } from "../api/types";
import { usePreferences } from "../preferences";
import { LIVE_TILES, chartPair, tileTemplate } from "./tiles";

/** The level of the chart kept under it (below): a region a tile, some
 *  eleven degrees of longitude, so a route's whole way is one or two. */
const UNDERLAY_ZOOM = 5;
/** The ring tiles remembered as asked for: about a flight's worth of
 *  views, the browser's cache holding the tiles themselves. */
const PREFETCH_KEPT = 2000;
/** How far past the chart's own last zoom the map goes, enlarging it: two
 *  levels, four times, where three (eight times) took it to a blur of
 *  squares ForeFlight never shows (the owner's audit, 2026-11-02). */
const OVERZOOM = 2;
/** The longest a new zoom's tiles are held back for all of them, ms: past
 *  it, those in are shown as they are. */
const HOLD_MS = 1500;

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
 * worker's). Each kind is its own layer instance (`key`): Leaflet reads
 * a layer's zooms once.
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
  const baseRef = useRef<L.TileLayer>(null);
  const overlayRef = useRef<L.TileLayer>(null);
  useHeldLevels(baseRef, baseLayer?.kind);
  useHeldLevels(overlayRef, overlay && (pinned || previewing) ? overlay.kind : undefined);

  const prefetched = useRef(new Set<string>());
  const prefetchRing = useCallback(() => {
    const layer = baseRef.current;
    if (!layer || !baseLayer) return;
    const zoom = Math.round(map.getZoom());
    if (zoom < baseLayer.min_zoom || zoom > baseLayer.max_zoom) return;
    const size = 256;
    const pixelBounds = map.getPixelBounds();
    const range = {
      minX: Math.floor(pixelBounds.min!.x / size) - 1, maxX: Math.floor(pixelBounds.max!.x / size) + 1,
      minY: Math.floor(pixelBounds.min!.y / size) - 1, maxY: Math.floor(pixelBounds.max!.y / size) + 1,
    };
    const n = 2 ** zoom;
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        if (y < 0 || y >= n) continue;
        const edge = x === range.minX || x === range.maxX || y === range.minY || y === range.maxY;
        if (!edge) continue;
        const url = layer.getTileUrl(Object.assign(L.point(((x % n) + n) % n, y), { z: zoom }) as L.Coords);
        // Once a tile: own ship followed ends a move at every fix, and the
        // ring was asked for again each time, twenty requests a second.
        if (prefetched.current.has(url)) continue;
        prefetched.current.add(url);
        if (prefetched.current.size > PREFETCH_KEPT) prefetched.current.delete(prefetched.current.values().next().value!);
        void fetch(url, { priority: "low" }).catch(() => { /* a miss now is a miss later, nothing to do */ });
      }
    }
  }, [map, baseLayer]);

  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Memoized for the reason `AirportsLayer` spells out: a handlers
  // object literal re-registers the listener on every commit, and an
  // event fired in that same commit is lost.
  useMapEvents(useMemo(() => ({
    moveend: () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
      prefetchTimer.current = setTimeout(prefetchRing, 250);
    },
  }), [prefetchRing]));
  useEffect(() => () => { if (prefetchTimer.current) clearTimeout(prefetchTimer.current); }, []);

  if (!baseLayer) return null;
  // The same chart at a region's level under it, always there: one or two
  // tiles at any zoom, loaded with the first view and kept. Where the
  // chart's own tiles are not in yet -- round what was in sight as the map
  // zooms out to a route, the edge of a pan -- the chart shows coarse
  // rather than grey, as Maps' does, at the owner's notice ("going from
  // current location to zoom out is not smooth"). Not below its level,
  // where the chart's own are as coarse.
  const underlay = Math.max(baseLayer.min_zoom, UNDERLAY_ZOOM);
  return (
    <>
      {underlay < baseLayer.max_zoom && (
        <TileLayer
          key={`${baseLayer.kind}-under`}
          url={tileTemplate(chart, baseLayer.kind)}
          minZoom={underlay} maxNativeZoom={underlay} maxZoom={baseLayer.max_zoom + OVERZOOM}
          keepBuffer={1} zIndex={0} updateWhenZooming={false} className={CHART_CLASS}
        />
      )}
      <TileLayer
        key={baseLayer.kind} ref={baseRef}
        url={tileTemplate(chart, baseLayer.kind)}
        minZoom={baseLayer.min_zoom} maxNativeZoom={baseLayer.max_zoom} maxZoom={baseLayer.max_zoom + OVERZOOM}
        keepBuffer={4} className={CHART_CLASS} {...LIVE_TILES}
      />
      {overlay && (pinned || previewing) && (
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

/** Leaflet's own, which the hold below reaches into: the zoom's container
 *  of tiles, the zoom tiles are asked for at, and its pruning of the
 *  tiles of other zooms. */
type Levels = L.TileLayer & { _level?: { el: HTMLElement; zoom: number }; _tileZoom?: number; _pruneTiles: () => void };

/**
 * A new zoom's tiles shown together once they are all in, faded in over
 * the last zoom's, which stay meanwhile, as ForeFlight's chart changes
 * zoom: Leaflet shows each tile as it arrives, and a zoom showed a
 * patchwork of sharp new tiles among the old ones scaled, a few at a time
 * (the owner's recording, 2026-11-02, zooming in on Charlotte). Held no
 * longer than HOLD_MS; a pan's new tiles at the same zoom are shown as
 * they come, as before. The old zoom's tiles are kept (no pruning) while
 * the new one is held, or they went as each new tile under them loaded.
 */
function useHeldLevels(ref: RefObject<L.TileLayer | null>, kind: string | undefined) {
  useEffect(() => {
    const layer = ref.current as Levels | null;
    if (!layer || !kind) return;
    const prune = layer._pruneTiles;
    let held: HTMLElement | null = null;
    let shownZoom = layer._tileZoom;
    let timer: ReturnType<typeof setTimeout> | null = null;
    layer._pruneTiles = function pruneWhenShown(this: Levels) {
      if (!held) prune.call(this);
    };
    const show = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const el = held;
      held = null;
      shownZoom = layer._tileZoom;
      if (el) {
        el.style.transition = "opacity 0.2s ease-out";
        el.style.opacity = "1";
        // Leaflet's own pruning once it has faded in, as it waits for a
        // tile's fade.
        setTimeout(() => {
          el.style.transition = "";
          el.style.opacity = "";
          layer._pruneTiles();
        }, 250);
      } else layer._pruneTiles();
    };
    // At each tile asked for: Leaflet's own 'loading' fires only when
    // nothing was loading, and a zoom begun while the last one's tiles
    // were still coming made its new zoom with none.
    const loading = () => {
      const level = layer._level;
      if (!level || level.zoom === shownZoom || held === level.el) return;
      if (held) held.style.opacity = "";
      held = level.el;
      held.style.transition = "";
      held.style.opacity = "0";
      if (timer) clearTimeout(timer);
      timer = setTimeout(show, HOLD_MS);
    };
    layer.on("tileloadstart", loading);
    layer.on("load", show);
    return () => {
      layer.off("tileloadstart", loading);
      layer.off("load", show);
      if (timer) clearTimeout(timer);
      if (held) held.style.opacity = "";
      layer._pruneTiles = prune;
    };
  }, [ref, kind]);
}
