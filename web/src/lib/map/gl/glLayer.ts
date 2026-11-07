import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { GeoJSONSource, LayerSpecification, Map as MlMap, MapGeoJSONFeature, MapMouseEvent, SourceSpecification } from "maplibre-gl";

/**
 * The WebGL map's layer API (lib/map/gl): each thing drawn on the map is
 * a React component that says, through these hooks, what it adds -- its
 * sources and its style layers, in one of the map's slots -- what data it
 * gives them, and what a tap on it does. The map (GlMapShell) owns the
 * camera, the sheet and the one tap that goes to the nearest thing.
 */

/** Where a layer is drawn, bottom to top: land and water where the
 *  chart ends, the chart, imagery over it at the pilot's ask, areas (a
 *  TFR's fill, weather), lines (airspace, airways), the route, marks
 *  (airports, navaids, checkpoints), and what is over all (own ship, the
 *  traffic). Each slot is an empty layer of the shell's that a layer is
 *  put under, so the order holds however the layers come and go. */
export const SLOTS = ["base", "chart", "imagery", "areas", "lines", "route", "marks", "top"] as const;
export type Slot = (typeof SLOTS)[number];
export const slotId = (slot: Slot) => `slot-${slot}`;

/** A tap on the map, given to the nearest thing: the taps registered are
 *  asked in their `rank` order (a mark before a line under it), each
 *  within its own `reach` of the finger, and the first that finds a
 *  feature of its layers has it. */
export interface GlTap {
  layers: string[];
  /** px each side of the finger: 22 is a 44 pt target. */
  reach: number;
  /** Lower first. */
  rank: number;
  onTap: (feature: MapGeoJSONFeature, event: MapMouseEvent) => void;
}

export interface GlMapApi {
  map: MlMap;
  addTap: (tap: GlTap) => () => void;
  /** A tap on the chart itself, nothing within reach: what puts a card
   *  away (an airport's, which the page holds). */
  addMiss: (miss: (event: MapMouseEvent) => void) => () => void;
  /** A card in the map's sheet (SheetCard), as a tap on the Leaflet map
   *  opens one; null puts it away. */
  openCard: (card: ReactNode | null) => void;
}

export const GlMapContext = createContext<GlMapApi | null>(null);

export function useGlMap(): GlMapApi {
  const api = useContext(GlMapContext);
  if (!api) throw new Error("useGlMap outside GlMapShell");
  return api;
}

/** Adds `sources` and `layers` under `slot` while mounted. The specs are
 *  read once a map: a style that changes goes through setPaintProperty
 *  (useGlPaint) or the data (useGlData). */
export function useGlLayer(slot: Slot, sources: Record<string, SourceSpecification>, layers: LayerSpecification[]) {
  const { map } = useGlMap();
  const spec = useRef({ sources, layers });
  useEffect(() => {
    const { sources, layers } = spec.current;
    for (const [id, source] of Object.entries(sources)) if (!map.getSource(id)) map.addSource(id, source);
    for (const layer of layers) map.addLayer(layer, slotId(slot));
    return () => {
      // The map gone first (the page left) takes its layers with it.
      if (!map.style) return;
      for (const layer of layers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      for (const id of Object.keys(sources)) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, slot]);
}

/** A GeoJSON source's data, set as it changes. */
export function useGlData(source: string, data: GeoJSON.GeoJSON | null) {
  const { map } = useGlMap();
  useEffect(() => {
    map.getSource<GeoJSONSource>(source)?.setData(data ?? EMPTY);
  }, [map, source, data]);
}

/** Paint properties set on layers as they change: a theme, the night. */
export function useGlPaint(layers: string[], paint: Record<string, unknown>) {
  const { map } = useGlMap();
  const key = JSON.stringify(paint);
  useEffect(() => {
    const values = JSON.parse(key) as Record<string, unknown>;
    for (const id of layers) {
      if (!map.getLayer(id)) continue;
      for (const [k, v] of Object.entries(values)) map.setPaintProperty(id, k as Parameters<MlMap["setPaintProperty"]>[1], v as never);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by value
  }, [map, key, layers.join()]);
}

/** A tap on this layer's features while mounted; the handler is read at
 *  the tap, so a new one each render costs nothing. */
export function useGlTap(layers: string[], reach: number, rank: number, onTap: GlTap["onTap"]) {
  const { addTap } = useGlMap();
  const handler = useRef(onTap);
  useEffect(() => { handler.current = onTap; });
  const ids = layers.join();
  useEffect(() => addTap({ layers: ids.split(","), reach, rank, onTap: (f, e) => handler.current(f, e) }), [addTap, ids, reach, rank]);
}

/** A tap on the chart that found nothing, while mounted. */
export function useGlMiss(onMiss: (event: MapMouseEvent) => void) {
  const { addMiss } = useGlMap();
  const handler = useRef(onMiss);
  useEffect(() => { handler.current = onMiss; });
  useEffect(() => addMiss(e => handler.current(e)), [addMiss]);
}

export const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** A picture that stretches to fit its text (icon-text-fit), its corners
 *  `inset` px each way kept as drawn. */
export interface Stretch { inset: number }

/** The images each map has, or is drawing, by id. */
const images = new WeakMap<MlMap, Map<string, Promise<void>>>();

/**
 * The marks' pictures from their own SVG markup -- the same markup the
 * Leaflet map's markers and canvases draw (airportMark, icons) -- drawn
 * once each at the screen's density and given to the map by id, for a
 * symbol layer's `icon-image`. Settles once every one is in, so a layer
 * gives its features after their pictures (a feature drawn before its
 * picture is in is left without it until its tile is laid out again).
 */
export function addSvgImages(map: MlMap, wanted: Iterable<[id: string, svg: () => string, stretch?: Stretch]>): Promise<void> {
  let kept = images.get(map);
  if (!kept) images.set(map, kept = new Map());
  const ratio = Math.max(1, Math.min(3, Math.ceil(window.devicePixelRatio || 1)));
  const waits: Promise<void>[] = [];
  for (const [id, svg, stretch] of wanted) {
    let wait = kept.get(id);
    if (!wait) {
      wait = new Promise<void>(resolve => {
        const markup = svg();
        const w = Number(/width="([\d.]+)"/.exec(markup)?.[1] ?? 24), h = Number(/height="([\d.]+)"/.exec(markup)?.[1] ?? 24);
        const sized = markup
          .replace(`width="${w}"`, `width="${w * ratio}"`).replace(`height="${h}"`, `height="${h * ratio}"`)
          .replace(/^<svg (?!xmlns)/, `<svg xmlns="http://www.w3.org/2000/svg" `);
        const image = new Image(w * ratio, h * ratio);
        image.onload = () => {
          // A label's box (icon-text-fit) stretches between its corners.
          const s = (v: number) => v * ratio;
          const fit = stretch && {
            stretchX: [[s(stretch.inset), s(w - stretch.inset)]] as [number, number][],
            stretchY: [[s(stretch.inset), s(h - stretch.inset)]] as [number, number][],
            content: [s(stretch.inset), s(stretch.inset), s(w - stretch.inset), s(h - stretch.inset)] as [number, number, number, number],
          };
          if (map.style && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: ratio, ...fit });
          resolve();
        };
        // A picture that cannot be drawn leaves its symbol bare, not the
        // layer waiting.
        image.onerror = () => resolve();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
      });
      kept.set(id, wait);
    }
    waits.push(wait);
  }
  return Promise.all(waits).then(() => {});
}
