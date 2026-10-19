import { describe, expect, it } from "vitest";
import { angleBetween, bearingDeg, bestStopIndex, deg, distanceNm, rad, signedTurn } from "./geo";

describe("geo", () => {
  it("turns degrees to radians and back", () => {
    expect(rad(180)).toBe(Math.PI);
    expect(rad(90)).toBeCloseTo(Math.PI / 2, 12);
    expect(deg(Math.PI)).toBe(180);
    expect(deg(rad(323.6))).toBeCloseTo(323.6, 10);
  });

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

  it("puts a stop where it bends the route least", () => {
    const madison = { lat: 43.1399, lon: -89.3375 };
    const minneapolis = { lat: 44.8848, lon: -93.2223 };
    // Straight: the only place is between the two ends.
    expect(bestStopIndex([campbell, duluth], madison)).toBe(0);
    // With Minneapolis a stop already, Madison goes before it, not after.
    expect(bestStopIndex([campbell, minneapolis, duluth], madison)).toBe(0);
    // And a stop near Duluth goes after it.
    expect(bestStopIndex([campbell, minneapolis, duluth], { lat: 46.5, lon: -92.5 })).toBe(1);
  });
});

describe("two directions apart, and the turn between them", () => {
  it("measures the angle round the compass the short way, 0 to 180", () => {
    expect(angleBetween(358, 2)).toBe(4);
    expect(angleBetween(2, 358)).toBe(4);
    expect(angleBetween(90, 270)).toBe(180);
    expect(angleBetween(10, 10)).toBe(0);
    expect(angleBetween(-600, 120)).toBe(0);
  });

  it("turns right positive, left negative", () => {
    expect(signedTurn(90, 120)).toBe(30);
    expect(signedTurn(350, 10)).toBe(20);
    expect(signedTurn(10, 350)).toBe(-20);
  });
});
