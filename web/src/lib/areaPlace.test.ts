import { describe, expect, it } from "vitest";
import { areaFrom, insideAny, lineEnters, outsides } from "./areaPlace";

// A square a tenth of a degree a side round 42 N, 88 W.
const square = outsides({ type: "Polygon", coordinates: [[[-88.05, 41.95], [-87.95, 41.95], [-87.95, 42.05], [-88.05, 42.05], [-88.05, 41.95]]] });

describe("areaPlace", () => {
  it("finds a point inside and a line through it", () => {
    expect(insideAny(square, { lat: 42, lon: -88 })).toBe(true);
    expect(insideAny(square, { lat: 42.2, lon: -88 })).toBe(false);
    // Across it, no point of the line inside.
    expect(lineEnters(square, [[42, -88.3], [42, -87.7]])).toBe(true);
    expect(lineEnters(square, [[42.2, -88.3], [42.2, -87.7]])).toBe(false);
  });

  it("says where it is from the airplane", () => {
    expect(areaFrom(square, { lat: 42, lon: -88 })).toBe("You are inside it");
    expect(areaFrom(square, { lat: 41.75, lon: -88 })).toMatch(/^1\d nm N of you$/);
  });

  it("takes a multipolygon's outsides", () => {
    expect(outsides({ type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]]] })).toHaveLength(2);
  });
});
