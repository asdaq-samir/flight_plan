import L from "leaflet";

/**
 * The map's marks held to the chart while it zooms frame by frame: a
 * two-finger pinch, and a flight in (flyTo -- the arrow to own ship, a
 * card's field, a route fitted). Leaflet puts every marker on a whole
 * pixel at each frame (Marker.update, by latLngToLayerPoint, which
 * rounds), and each level of the chart's tiles on its own whole pixel
 * (GridLayer._setZoomTransform), so the marks shook against the chart
 * under them as the pilot zoomed in. While such a zoom is under way --
 * the 'zoom' event Leaflet fires each frame says so (`pinch`, `flyTo`),
 * and a pinch's handler is `_zooming` -- marks and tiles take their exact
 * places instead; the frame that ends it (a pinch's zoom to its level, a
 * flight's last move) rounds them again, so a mark at rest stays on a
 * whole pixel, its edges and its ident crisp.
 *
 * The first cut of this (2026-10-09) took a mark's place from
 * latLngToLayerPoint, which rounds as well: the tiles were exact and the
 * marks still stepped a pixel at a time, a median 0.54 points a frame
 * against the chart. Measured again with the place unrounded: below.
 *
 * Leaflet 1.9's own private fields (`_zooming`, `_icon`, `_setPos`,
 * `_resetView`, `_getNewPixelOrigin`), kept to the version the app pins
 * exactly (package.json), with pinch.test.ts failing if they are not there.
 */
type Smooth = { pinch?: boolean; flyTo?: boolean } | undefined;
type ZoomingMap = L.Map & { touchZoom?: { _zooming?: boolean }; _getNewPixelOrigin: (center: L.LatLng, zoom: number) => L.Point };
type Placed = L.Marker & { _map?: ZoomingMap; _icon?: HTMLElement; _setPos: (pos: L.Point) => void };

/** A zoom going frame by frame: a pinch's or a flight's 'zoom' event. */
const smooth = (map: ZoomingMap | undefined, e: Smooth) => !!map && (!!e?.pinch || !!e?.flyTo || !!map.touchZoom?._zooming);

// Not in Leaflet's types, though every marker has it.
const rounded = (L.Marker.prototype as unknown as { update: (this: L.Marker, e?: Smooth) => L.Marker }).update;
L.Marker.include({
  update(this: Placed, e?: Smooth) {
    const map = this._map;
    if (map && this._icon && smooth(map, e)) {
      // Its exact place on the layer: projected, less the layer's origin,
      // with no rounding between (latLngToLayerPoint rounds the projection).
      this._setPos(map.project(this.getLatLng()).subtract(map.getPixelOrigin()));
      return this;
    }
    return rounded.call(this, e);
  },
});

/** The tiles' own transform likewise, while such a zoom is under way:
 *  Leaflet rounds each level's translate to a whole pixel. Which zoom it
 *  is reaches the levels' transform through the layer's _resetView, the
 *  'zoom' event's handler. */
type Level = { el: HTMLElement; origin: L.Point; zoom: number };
type Grid = L.GridLayer & {
  _map?: ZoomingMap;
  _smooth?: boolean;
  _setZoomTransform: (level: Level, center: L.LatLng, zoom: number) => void;
  _resetView: (e?: Smooth) => void;
};

const grid = L.GridLayer.prototype as unknown as Grid;
const roundedLevel = grid._setZoomTransform;
const resetView = grid._resetView;
L.GridLayer.include({
  _resetView(this: Grid, e?: Smooth) {
    this._smooth = smooth(this._map, e);
    try {
      resetView.call(this, e);
    } finally {
      this._smooth = false;
    }
  },
  _setZoomTransform(this: Grid, level: Level, center: L.LatLng, zoom: number) {
    const map = this._map;
    // Without 3D transforms Leaflet positions the level another way; leave that to it.
    if (!map || !(this._smooth || map.touchZoom?._zooming) || !L.Browser.any3d) return roundedLevel.call(this, level, center, zoom);
    const scale = map.getZoomScale(zoom, level.zoom);
    L.DomUtil.setTransform(level.el, level.origin.multiplyBy(scale).subtract(map._getNewPixelOrigin(center, zoom)), scale);
  },
});

/**
 * The lines and shapes drawn on the chart -- the course, the airspace,
 * TFRs, a pattern's and a procedure's lines, traffic's paths -- drawn
 * again at the zoom a pinch or a flight in has reached, each frame, at
 * their own widths. Leaflet's SVG renderer only scales what it drew last
 * as the map zooms (Renderer._onZoom, a CSS scale on its <svg>), strokes
 * and all, and draws again once the map rests: the course line grew
 * thicker under the fingers and settled back as they lifted (the owner's
 * notice, 2026-10-16). `vector-effect: non-scaling-stroke` does not undo a
 * CSS scale on the <svg> itself: a 2 px stroke under scale(3) measured
 * 6 px in Chromium and WebKit alike. So the view box is set for the zoom
 * now and each path projected and drawn again, as Leaflet does at a
 * zoom's end (Renderer._reset, less its second draw of every path) --
 * every PINCH_REDRAW_MS, Leaflet's scale between: with the Class B and
 * the TFRs drawn (78 paths), a draw every frame took a pinch from 60 to
 * 30 frames a second at a quarter of this Mac's speed (CPU 4x), where
 * every 50 ms it costs a frame in three and a line grows at most a tenth
 * between two.
 */
export const PINCH_REDRAW_MS = 50;
type Redrawn = { _project: () => void; _update: () => void };
type Svg = L.SVG & {
  _map?: ZoomingMap;
  _layers: Record<string, Redrawn>;
  _center: L.LatLng;
  _zoom: number;
  /** When it last drew its paths again under a pinch or a flight, ms. */
  _redrawnAt?: number;
  _update: () => void;
  _updatePaths: () => void;
  _updateTransform: (center: L.LatLng, zoom: number) => void;
  _onZoom: (e?: Smooth) => void;
};
const svg = L.SVG.prototype as unknown as Svg;
const scaledOnZoom = svg._onZoom;
L.SVG.include({
  _onZoom(this: Svg, e?: Smooth) {
    const now = performance.now();
    if (!smooth(this._map, e) || now - (this._redrawnAt ?? -Infinity) < PINCH_REDRAW_MS) return scaledOnZoom.call(this, e);
    this._redrawnAt = now;
    // The view box at the zoom now, its paths not drawn twice: the
    // renderer's own 'update' draws each from where it was projected.
    this.off("update", this._updatePaths, this);
    try {
      this._update();
    } finally {
      this.on("update", this._updatePaths, this);
    }
    this._updateTransform(this._center, this._zoom);
    for (const id in this._layers) {
      const path = this._layers[id]!;
      path._project();
      path._update();
    }
  },
});

/**
 * A pinch is left where the fingers leave it, as ForeFlight leaves its own
 * (the owner's recording of it, 2026-10-16: two rests 2.9 times apart, where
 * settling on whole levels makes two or four), the nearest level's tiles
 * drawn up to 1.4 times their size between levels; the owner had tried both
 * (the map's settings' Pinch, a trial). A wheel's zoom, a double tap and the
 * map's fits still land where they did. Leaflet rounds a pinch's last zoom
 * to its zoomSnap as the fingers lift (TouchZoom._onTouchEnd): none for that.
 */
type PinchHandler = { _map: L.Map; _onTouchEnd: () => void };
const touchZoom = (L.Map as unknown as { TouchZoom: { prototype: PinchHandler; include: (props: object) => void } }).TouchZoom;
const pinchEnd = touchZoom.prototype._onTouchEnd;
touchZoom.include({
  _onTouchEnd(this: PinchHandler) {
    const snap = this._map.options.zoomSnap;
    this._map.options.zoomSnap = 0;
    try {
      pinchEnd.call(this);
    } finally {
      this._map.options.zoomSnap = snap;
    }
  },
});
