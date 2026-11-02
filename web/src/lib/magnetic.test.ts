import { describe, expect, it } from "vitest";
import { loadDeclination, magneticOf } from "./magnetic";

describe("the variation at a point (WMM-2025)", () => {
  it("agrees with the declinations NOAA's calculator gave the planner", async () => {
    // The rows tests/test_magnetic.py holds vfr.magnetic to: the same
    // model, so the ruler's courses and the nav log's agree.
    const at = await loadDeclination(new Date("2026-09-21T12:00:00Z"));
    for (const [lat, lon, noaa] of [[44.58, -90.14, -2.55629], [42.33, -88.08, -3.89582], [43.02, -89.0, -3.274]] as const) {
      expect(at(lat, lon)).toBeCloseTo(noaa, 1);
    }
  });

  it("is west and negative east of the agonic line, east and positive west of it", async () => {
    const at = await loadDeclination(new Date("2026-09-21T12:00:00Z"));
    expect(at(41.9, -87.6)).toBeLessThan(0);
    expect(at(47.6, -122.3)).toBeGreaterThan(0);
  });

  it("takes a date past the model to its edge rather than failing", async () => {
    const edge = await loadDeclination(new Date("2029-11-12T00:00:00Z"));
    const beyond = await loadDeclination(new Date("2099-01-01T00:00:00Z"));
    expect(beyond(42.3, -88.1)).toBeCloseTo(edge(42.3, -88.1), 1);
  });
});

describe("a true direction as a magnetic one", () => {
  it("takes an east variation off and adds a west one: east is least, west is best", () => {
    expect(magneticOf(90, 10)).toBe(80);
    expect(magneticOf(90, -4)).toBe(94);
    expect(magneticOf(5, 10)).toBe(355);
    expect(magneticOf(358, -4)).toBe(2);
  });
});
