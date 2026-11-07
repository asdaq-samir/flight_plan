import type {
  LayerSpecification, LineLayerSpecification, RasterLayerSpecification,
  RasterSourceSpecification, SymbolLayerSpecification,
} from "maplibre-gl";
import type { AirspaceVolume, ChartInfo } from "../../api/types";
import { airspaceLabel } from "../airspaceLabel";
import { chartPair, tileTemplate } from "../tiles";
import { COURSE_MAGENTA } from "../chartColors";

/**
 * The map's style (the owner, 2026-11-06: "Like ForeFlight, I want
 * the map to be clear and crisp and the overlay items need to be seen as
 * part of the map and not buggy overlay"): the FAA chart, the airspace,
 * the route and its checkpoints drawn by MapLibre GL in one WebGL map,
 * where Leaflet draws the chart as images and every overlay on a canvas
 * or an SVG of its own that it scales by CSS under a pinch and draws
 * again at the pinch's end. Plain data here, no map: what GlMap hands
 * MapLibre, and what the tests read.
 */

/** Leaflet's zoom less one: MapLibre's world is 512 px across at zoom 0,
 *  Leaflet's 256, so the same view is a level lower in MapLibre. Every
 *  zoom this app names (AirspaceLayer's FROM_ZOOM, ownShip's OPEN_ZOOM, a
 *  chart layer's min_zoom) is Leaflet's, and goes through this. A raster
 *  source's own minzoom and maxzoom are the tiles' {z}, which need none. */
export const glZoom = (leafletZoom: number) => leafletZoom - 1;
export const leafletZoomOf = (glZoomLevel: number) => glZoomLevel + 1;

/** As ChartTiles: the chart enlarged two levels past its own last zoom. */
export const OVERZOOM = 2;
/** As ChartTiles: a region's level of the chart under it, where the
 *  chart's own tiles are not in yet. */
export const UNDERLAY_ZOOM = 5;

/** A tile address MapLibre can fetch: its requests are made from a
 *  worker or resolved against no page, so a path the planner serves
 *  through the gateway (`/api/planner/...`) is made whole with the page's
 *  origin. Not with `new URL`, which writes `{z}` as `%7Bz%7D`. */
export function absoluteTiles(template: string, origin: string): string {
  return template.startsWith("/") ? `${origin}${template}` : template;
}

export interface ChartStyle {
  sources: Record<string, RasterSourceSpecification>;
  layers: RasterLayerSpecification[];
  /** The map's furthest zoom, MapLibre's: the chart's own last plus
   *  OVERZOOM. */
  maxZoom: number;
}

/** The chart's ink by day and dimmed at night, as index.css dims the
 *  Leaflet tiles (`brightness(0.5) contrast(1.15)`) and brightens them in
 *  sunlight (`contrast(1.25) saturate(1.2)`). */
export function chartPaint(night: boolean, sunlight: boolean): RasterLayerSpecification["paint"] {
  return {
    // Each tile drawn in the frame it comes, as Leaflet's fadeAnimation
    // false (MapShell): a fade on every pan nobody asked for.
    "raster-fade-duration": 0,
    // Smooth, not nearest: past the chart's last zoom the owner chose the
    // smooth enlargement ForeFlight shows over hard blocks (index.css,
    // 2026-10-28), and between whole levels linear sampling keeps the
    // chart's type from shimmering as a pinch passes through them.
    "raster-resampling": "linear",
    "raster-brightness-max": night ? 0.5 : 1,
    "raster-contrast": sunlight ? 0.2 : night ? 0.13 : 0,
    "raster-saturation": sunlight ? 0.2 : 0,
  };
}

/**
 * The FAA chart as ChartTiles draws it: the base chart (the sectional or
 * an IFR enroute chart, per the preferences), the same chart at a
 * region's level under it, and the terminal sheet over it while pinned --
 * the same tile addresses (tiles.ts tileTemplate, with the cycle and the
 * revision), the same zooms, the same two levels of enlargement.
 */
export function chartStyle(chart: ChartInfo, base: string, pinned: boolean, origin: string, paint = chartPaint(false, false)): ChartStyle | null {
  const { base: baseLayer, overlay } = chartPair(chart.chart_layers, base);
  if (!baseLayer) return null;
  const sources: Record<string, RasterSourceSpecification> = {};
  const layers: RasterLayerSpecification[] = [];
  const tiles = (kind: string) => [absoluteTiles(tileTemplate(chart, kind), origin)];
  const underlay = Math.max(baseLayer.min_zoom, UNDERLAY_ZOOM);
  if (underlay < baseLayer.max_zoom) {
    sources["chart-under"] = { type: "raster", tiles: tiles(baseLayer.kind), tileSize: 256, minzoom: underlay, maxzoom: underlay };
    layers.push({ id: "chart-under", type: "raster", source: "chart-under", minzoom: glZoom(underlay), paint });
  }
  sources.chart = { type: "raster", tiles: tiles(baseLayer.kind), tileSize: 256, minzoom: baseLayer.min_zoom, maxzoom: baseLayer.max_zoom };
  layers.push({ id: "chart", type: "raster", source: "chart", paint });
  if (overlay && pinned) {
    sources["chart-terminal"] = { type: "raster", tiles: tiles(overlay.kind), tileSize: 256, minzoom: overlay.min_zoom, maxzoom: overlay.max_zoom };
    layers.push({ id: "chart-terminal", type: "raster", source: "chart-terminal", minzoom: glZoom(overlay.min_zoom), paint });
  }
  return { sources, layers, maxZoom: glZoom(baseLayer.max_zoom + OVERZOOM) };
}

/** Class E is in the style for when the planner serves it: today
 *  /api/airspace/in-view answers B, C and D only (AirspaceVolume). */
type AirspaceClass = AirspaceVolume["airspace_class"] | "E";

/**
 * The airspace's inks, AirspaceLayer's (airspaceMarks): the FAA's
 * sectional symbology (Aeronautical Chart User's Guide, VFR Terms and
 * Symbols, Airspace) -- Class B solid blue, Class C solid magenta, Class
 * D dashed blue, Class E (surface) dashed magenta, drawn here faded -- in
 * ForeFlight's lighter blue and clearer magenta, which stand off the
 * chart's own printed ring.
 */
export const AIRSPACE_INK: Record<AirspaceClass, { colour: string; dash?: number[]; opacity: number; label: string }> = {
  B: { colour: "#4b9df8", opacity: 0.95, label: "#1f5fae" },
  C: { colour: "#c43fc0", opacity: 0.95, label: "#8a1f87" },
  // A dash of 10 px and a gap of 5, as the Leaflet canvas draws it, in
  // MapLibre's units, the line's own width (3 px).
  D: { colour: "#4b9df8", dash: [10 / 3, 5 / 3], opacity: 0.95, label: "#1f5fae" },
  E: { colour: "#c43fc0", dash: [10 / 3, 5 / 3], opacity: 0.45, label: "#8a1f87" },
};

/** From which Leaflet zoom each class is drawn, AirspaceLayer's:
 *  B from 6, C from 7, D (and E) and every label from 8. */
export const AIRSPACE_FROM: Record<AirspaceClass, number> = { B: 6, C: 7, D: 8, E: 8 };
export const AIRSPACE_LABELS_FROM = 8;

/** A volume's altitudes on one line as AirspaceLayer writes them along
 *  it, as ForeFlight does: a shelf's "100/30", a Class D's ceiling. */
export function airspaceText(volume: AirspaceVolume): string | null {
  const label = airspaceLabel(volume);
  if (!label) return null;
  return label.kind === "shelf" ? `${label.top}/${label.floor}` : label.ceiling;
}

export interface AirspaceProps { id: string; cls: AirspaceClass; label: string }

/**
 * The volumes the planner answered for a box, as GeoJSON lines: each of
 * a volume's lines ([lat, lon] as the planner sends them) one feature,
 * its class and its altitudes as properties. The seam for the vector
 * tiles (claude/vector-tiles): those features from a `vector` source
 * with a `source-layer`, the same layers below reading the same
 * properties, and this and the box's question go.
 */
export function airspaceFeatures(volumes: AirspaceVolume[]): GeoJSON.FeatureCollection<GeoJSON.LineString, AirspaceProps> {
  const features: GeoJSON.Feature<GeoJSON.LineString, AirspaceProps>[] = [];
  for (const v of volumes) {
    const label = airspaceText(v) ?? "";
    for (const line of v.lines) {
      if (line.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { id: v.id, cls: v.airspace_class, label },
        geometry: { type: "LineString", coordinates: line.map(p => [p[1]!, p[0]!]) },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export const AIRSPACE_SOURCE = "airspace";
export const AIRSPACE_LINE_LAYERS = (["E", "D", "C", "B"] as const).map(c => `airspace-${c}`);

/** One line layer a class, drawn from that class's zoom, and the labels
 *  along every line: on the line, upright, kept off each other and off
 *  the route's marks by MapLibre's own collision, haloed as the chart's
 *  own type is. */
export function airspaceLayers(font: string[]): LayerSpecification[] {
  const lines: LineLayerSpecification[] = (["E", "D", "C", "B"] as const).map(cls => {
    const ink = AIRSPACE_INK[cls];
    return {
      id: `airspace-${cls}`, type: "line", source: AIRSPACE_SOURCE, minzoom: glZoom(AIRSPACE_FROM[cls]),
      filter: ["==", ["get", "cls"], cls],
      layout: { "line-join": "round", "line-cap": ink.dash ? "butt" : "round" },
      paint: { "line-color": ink.colour, "line-width": 3, "line-opacity": ink.opacity, ...(ink.dash ? { "line-dasharray": ink.dash } : {}) },
    };
  });
  const labels: SymbolLayerSpecification = {
    id: "airspace-labels", type: "symbol", source: AIRSPACE_SOURCE, minzoom: glZoom(AIRSPACE_LABELS_FROM),
    filter: ["!=", ["get", "label"], ""],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 280,
      "text-field": ["get", "label"],
      "text-font": font,
      "text-size": 12,
      "text-max-angle": 30,
      "text-keep-upright": true,
      "text-padding": 4,
    },
    paint: {
      "text-color": ["match", ["get", "cls"], "C", AIRSPACE_INK.C.label, "E", AIRSPACE_INK.E.label, AIRSPACE_INK.B.label],
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  };
  return [...lines, labels];
}

export interface RoutePoint {
  /** A checkpoint's key ("lat,lon"), or an airport's ident. */
  key: string;
  lat: number;
  lon: number;
  /** A checkpoint's number in the nav log, or an airport's ident. */
  label: string;
  colour: string;
}

export const ROUTE_SOURCE = "route";
export const CHECKPOINT_SOURCE = "checkpoints";

/** The course: a white casing under the magenta core, as CourseLine. */
export function routeFeature(line: [number, number][]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line.map(([lat, lon]) => [lon, lat]) } };
}

export function pointFeatures(points: RoutePoint[]): GeoJSON.FeatureCollection<GeoJSON.Point, Omit<RoutePoint, "lat" | "lon">> {
  return {
    type: "FeatureCollection",
    features: points.map(({ lat, lon, ...props }) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } })),
  };
}

export function routeLayers(courseColour = COURSE_MAGENTA): LayerSpecification[] {
  const casing: LineLayerSpecification = {
    id: "route-casing", type: "line", source: ROUTE_SOURCE,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 5.5, "line-opacity": 0.85 },
  };
  const core: LineLayerSpecification = {
    id: "route-core", type: "line", source: ROUTE_SOURCE,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": courseColour, "line-width": 2.5 },
  };
  return [casing, core];
}
