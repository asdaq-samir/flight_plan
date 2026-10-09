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
