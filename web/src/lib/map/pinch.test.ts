// @vitest-environment jsdom
import L from "leaflet";
import { describe, expect, it } from "vitest";
import "./pinch";

// The pinch patch leans on Leaflet 1.9's private methods; a bump that
// moves them should fail here, not throw in the middle of a pilot's pinch.
describe("pinch patch", () => {
  it("runs against the Leaflet it was written for", () => {
    expect(L.version).toBe("1.9.4");
    const marker = L.Marker.prototype as unknown as Record<string, unknown>;
    const grid = L.GridLayer.prototype as unknown as Record<string, unknown>;
    const map = L.Map.prototype as unknown as Record<string, unknown>;
    expect(marker.update).toBeTypeOf("function");
    expect(marker._setPos).toBeTypeOf("function");
    expect(grid._setZoomTransform).toBeTypeOf("function");
    expect(grid._resetView).toBeTypeOf("function");
    expect(map._getNewPixelOrigin).toBeTypeOf("function");
    const touchZoom = (L.Map as unknown as { TouchZoom: { prototype: Record<string, unknown> } }).TouchZoom.prototype;
    expect(touchZoom._onTouchEnd).toBeTypeOf("function");
    const svg = L.SVG.prototype as unknown as Record<string, unknown>;
    for (const name of ["_onZoom", "_update", "_updatePaths", "_updateTransform"]) expect(svg[name]).toBeTypeOf("function");
    const path = L.Polyline.prototype as unknown as Record<string, unknown>;
    expect(path._project).toBeTypeOf("function");
    expect(path._update).toBeTypeOf("function");
  });

  it("draws a line again at the zoom a pinch has reached, frame by frame, where it was only scaled", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400 });
    Object.defineProperty(container, "clientHeight", { value: 800 });
    // Fractional zooms, as a pinch leaves the map (pinch.ts's TouchZoom).
    const map = L.map(container, { zoomAnimation: false, fadeAnimation: false, zoomSnap: 0 }).setView([42.3, -88.0], 9);
    const line = L.polyline([[42.2, -88.2], [42.5, -87.8]]).addTo(map);
    const d = () => (line.getElement() as SVGPathElement).getAttribute("d");
    const before = d();
    const moving = map as unknown as { _move: (center: L.LatLng, zoom: number, data: object) => void };
    // A pinch's frame: the zoom a level and a half in, the fingers still
    // down, past the time between two draws (PINCH_REDRAW_MS).
    moving._move(map.getCenter(), 10.5, { pinch: true });
    expect(d()).not.toBe(before);
    // Drawn where the line's ends are at that zoom, both well inside the
    // view, so none of it is clipped.
    const [a, b] = [map.latLngToLayerPoint([42.2, -88.2]), map.latLngToLayerPoint([42.5, -87.8])];
    expect(d()).toBe(`M${a.x} ${a.y}L${b.x} ${b.y}`);
    map.remove();
  });

  it("puts a marker at its exact place while a zoom goes frame by frame, and on a whole pixel otherwise", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400 });
    Object.defineProperty(container, "clientHeight", { value: 800 });
    const map = L.map(container, { zoomAnimation: false, fadeAnimation: false }).setView([44.88, -93.22], 9.37);
    const marker = L.marker([44.9, -93.1]).addTo(map);
    const icon = (marker as unknown as { _icon: HTMLElement })._icon;
    const placed = () => (L.DomUtil.getPosition(icon) as L.Point);
    const exact = map.project(marker.getLatLng()).subtract(map.getPixelOrigin());
    const update = (marker as unknown as { update: (e?: object) => void }).update.bind(marker);
    update({ pinch: true });
    expect(placed().x).toBeCloseTo(exact.x, 6);
    expect(placed().y).toBeCloseTo(exact.y, 6);
    // At rest: Leaflet's own, rounded.
    update();
    expect(Number.isInteger(placed().x) && Number.isInteger(placed().y)).toBe(true);
    map.remove();
  });
});
