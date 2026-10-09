import L from "leaflet";

/**
 * The map's marks held to the chart under a pinch. Leaflet moves each
 * marker to its point rounded to a whole pixel at every frame of a
 * two-finger zoom (Marker.update), while the chart's tiles scale
 * smoothly under it, so every mark shook against the chart by up to two
 * points a frame -- a median of 0.75 measured on an iPhone-sized page --
 * as the pilot saw zooming in. While a pinch is under way
 * (its handler's `_zooming`) a mark goes to its exact point instead;
 * once the fingers lift, Leaflet's own zoom to the final level rounds
 * them again, so a mark at rest stays on a whole pixel, its edges and
 * its ident crisp. Leaflet 1.9's own private fields (`_zooming`, `_icon`,
 * `_setPos`), kept to the version the app pins exactly (package.json), with
 * pinch.test.ts failing if they are not there.
 */
type Placed = L.Marker & { _map?: L.Map & { touchZoom?: { _zooming?: boolean } }; _icon?: HTMLElement; _setPos: (pos: L.Point) => void };

// Not in Leaflet's types, though every marker has it.
const rounded = (L.Marker.prototype as unknown as { update: (this: L.Marker) => L.Marker }).update;
L.Marker.include({
  update(this: Placed) {
    if (this._map?.touchZoom?._zooming && this._icon) {
      this._setPos(this._map.latLngToLayerPoint(this.getLatLng()));
      return this;
    }
    return rounded.call(this);
  },
});

/** The tiles' own transform under a pinch, likewise: Leaflet rounds each
 *  level's translate to a whole pixel (GridLayer._setZoomTransform), so
 *  the chart stepped a pixel at a time under marks that now move
 *  smoothly. Unrounded while the fingers are down, as above. */
type Level = { el: HTMLElement; origin: L.Point; zoom: number };
type Grid = L.GridLayer & {
  _map?: L.Map & { touchZoom?: { _zooming?: boolean }; _getNewPixelOrigin: (center: L.LatLng, zoom: number) => L.Point };
  _setZoomTransform: (level: Level, center: L.LatLng, zoom: number) => void;
};
const roundedLevel = (L.GridLayer.prototype as unknown as Grid)._setZoomTransform;
L.GridLayer.include({
  _setZoomTransform(this: Grid, level: Level, center: L.LatLng, zoom: number) {
    const map = this._map;
    // Without 3D transforms Leaflet positions the level another way; leave that to it.
    if (!map?.touchZoom?._zooming || !L.Browser.any3d) return roundedLevel.call(this, level, center, zoom);
    const scale = map.getZoomScale(zoom, level.zoom);
    L.DomUtil.setTransform(level.el, level.origin.multiplyBy(scale).subtract(map._getNewPixelOrigin(center, zoom)), scale);
  },
});
