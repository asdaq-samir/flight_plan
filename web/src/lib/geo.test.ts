import { describe, expect, it } from "vitest";
import { bearingDeg, distanceNm } from "./geo";

describe("geo", () => {
  const campbell = { lat: 42.3246, lon: -88.0741 };
  const duluth = { lat: 46.8421, lon: -92.1936 };

  it("measures C81 to KDLH as the planner does, to within a mile", () => {
    // The planner's own course: 323.6 nm (the nav log's distance).
    expect(distanceNm(campbell, duluth)).toBeGreaterThan(322);
    expect(distanceNm(campbell, duluth)).toBeLessThan(325);
  });

  it("bears north-west from C81 to KDLH, and the other way back", () => {
    expect(bearingDeg(campbell, duluth)).toBeGreaterThan(320);
    expect(bearingDeg(campbell, duluth)).toBeLessThan(335);
    expect(bearingDeg(duluth, campbell)).toBeGreaterThan(135);
    expect(bearingDeg(duluth, campbell)).toBeLessThan(150);
  });

  it("is zero to itself", () => {
    expect(distanceNm(duluth, duluth)).toBe(0);
  });
});
