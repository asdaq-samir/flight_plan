// @vitest-environment jsdom
import L from "leaflet";
import { describe, expect, it } from "vitest";
import { zoomZeroX, zoomZeroY } from "./mercator";

describe("zoomZeroX and zoomZeroY", () => {
  it("put a place where Leaflet's own map.project puts it at zoom 0, the poles clamped as it clamps them", () => {
    const map = L.map(document.createElement("div"), { center: [0, 0], zoom: 3 });
    for (const [lat, lon] of [[41.978, -87.905], [0, 0], [-33.9, 151.2], [64.8, -147.9], [89.9, 179.99], [-89.9, -180]] as const) {
      const at = map.project([lat, lon], 0);
      expect(zoomZeroX(lon)).toBeCloseTo(at.x, 9);
      expect(zoomZeroY(lat)).toBeCloseTo(at.y, 9);
    }
    map.remove();
  });
});
