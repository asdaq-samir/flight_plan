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
