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
    expect(map._getNewPixelOrigin).toBeTypeOf("function");
  });
});
