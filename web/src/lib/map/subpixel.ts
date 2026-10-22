import L from "leaflet";

/**
 * Every line and shape on the map -- the course, the TFRs, airspace, the
 * patterns and procedures -- drawn where its points fall, to the fraction
 * of a point, not snapped to whole points as Leaflet's own are
 * (latLngToLayerPoint rounds). On a phone's 3x screen each point snapped a
 * third of a point aside showed as a kink in a curve -- the course, a
 * great circle with a point every 5 nm -- and at each zoom a different
 * one, so the line shook as it was pinched (the owner's recording, C81 to
 * KLAX, 2026-10-22: "make all the other things smooth as well like
 * TFRs"). Their simplification (smoothFactor) a quarter of a point, where
 * Leaflet's own is one, the curves kept as curves on such a screen.
 * Polygons are polylines to Leaflet, so they draw the same way.
 */
type Projecting = { _map: L.Map; _projectLatlngs: (latlngs: unknown[], result: L.Point[][], bounds: L.Bounds) => void };

L.Polyline.include({
  _projectLatlngs(this: Projecting, latlngs: unknown[], result: L.Point[][], bounds: L.Bounds) {
    if (latlngs[0] instanceof L.LatLng) {
      const origin = this._map.getPixelOrigin();
      const ring = (latlngs as L.LatLng[]).map(latlng => this._map.project(latlng).subtract(origin));
      for (const point of ring) bounds.extend(point);
      result.push(ring);
    } else {
      for (const part of latlngs) this._projectLatlngs(part as unknown[], result, bounds);
    }
  },
});
L.Polyline.mergeOptions({ smoothFactor: 0.25 });
