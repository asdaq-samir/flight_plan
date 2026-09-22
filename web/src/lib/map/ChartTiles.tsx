import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Course } from "../api/types";
import { usePreferences } from "../preferences";
import { tileTemplate } from "./tiles";

interface Props {
  course: Course;
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
 * viewport, all Leaflet's own; `updateWhenIdle` off asks for tiles
 * during a pan too, which a pilot panning across a route felt as the
 * chart arriving late otherwise. A ring of tiles one deep around the
 * view is fetched once the map comes to rest, so the next pan finds
 * its tiles in the browser's cache (and, installed, the service
 * worker's). Each kind is its own layer instance (`key`): Leaflet reads
 * a layer's zooms once.
 */
export function ChartTiles({ course, previewing }: Props) {
  const map = useMap();
  const base = usePreferences(s => s.base);
  const pinned = usePreferences(s => s.tac);
  const layers = course.chart_layers;
  const baseLayer = layers.find(l => l.kind === base) ?? layers.find(l => l.kind === "sec") ?? null;
  const overlay = layers.find(l => !l.base && l.over.includes(base)) ?? null;
  const baseRef = useRef<L.TileLayer>(null);

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
        void fetch(url, { priority: "low" }).catch(() => { /* a miss now is a miss later, nothing to do */ });
      }
    }
  }, [map, baseLayer]);

  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Memoized for the reason `useZoomLevel` spells out: a handlers
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
  const attribution = (kind: string) => (kind.startsWith("ifr") ? "FAA IFR enroute charts" : "FAA VFR charts");
  return (
    <>
      <TileLayer
        key={baseLayer.kind} ref={baseRef}
        url={tileTemplate(course, baseLayer.kind)} attribution={attribution(baseLayer.kind)}
        minZoom={baseLayer.min_zoom} maxNativeZoom={baseLayer.max_zoom} maxZoom={baseLayer.max_zoom + 3}
        keepBuffer={4} updateWhenIdle={false}
      />
      {overlay && (pinned || previewing) && (
        <TileLayer
          key={overlay.kind}
          url={tileTemplate(course, overlay.kind)} attribution={attribution(overlay.kind)}
          minZoom={overlay.min_zoom} maxNativeZoom={overlay.max_zoom} maxZoom={overlay.max_zoom + 3}
          keepBuffer={2} zIndex={5} updateWhenIdle={false}
        />
      )}
    </>
  );
}
