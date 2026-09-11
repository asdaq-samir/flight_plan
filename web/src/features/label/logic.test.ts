import { describe, expect, test } from "vitest";
import type { Detection, Endpoint, LoosePick, Point } from "../../lib/api/types";
import {
  DEFAULT_FILTERS, forwardIsLeft, forwardIsUp, hasRating, hiddenCount,
  isVisible, orderedPoints, ratedOf, roleOf, sourceOf, type Filters,
} from "./logic";

const filters = (over: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...over });

const det = (over: Partial<Detection> = {}): Detection => ({
  lat: 44, lon: -89, category: "water", area_m2: 1000, score: 4,
  along_track_nm: 10, cross_track_nm: 0, rating: null, role: null, rated: false, ...over,
});

const loose = (over: Partial<LoosePick> = {}): LoosePick => ({
  lat: 44, lon: -89, category: "river", role: "dr", source: "added",
  rating: 5, rated: true, along_track_nm: 20, cross_track_nm: 0, area_m2: 0, ...over,
});

const end = (ident: string, nm: number): Endpoint => ({
  endpoint: true, ident, name: ident, lat: 44, lon: -89,
  along_track_nm: nm, category: nm === 0 ? "departure" : "destination",
});

describe("role", () => {
  test("a stored role wins over the corridor rule", () => {
    expect(roleOf(det({ role: "visual", cross_track_nm: 0 }))).toBe("visual");
  });
  test("on course means you fly over it", () => {
    expect(roleOf(det({ cross_track_nm: 0.4 }))).toBe("dr");
    expect(roleOf(det({ cross_track_nm: -0.4 }))).toBe("dr");
  });
  test("well off course means you look at it", () => {
    expect(roleOf(det({ cross_track_nm: 3.58 }))).toBe("visual");
  });
});

describe("source", () => {
  test("a detection with no source is still detected", () => {
    expect(sourceOf(det())).toBe("detected");
  });
  test("a pick made against a detection stays detected once it drifts", () => {
    expect(sourceOf(loose({ source: "detected" }))).toBe("detected");
  });
});

describe("rated", () => {
  test("zero is a rating, not the absence of one", () => {
    // The judgment that matters most: the detector should not have
    // surfaced this. Treating it as unrated would drop it from the data.
    expect(ratedOf(det({ rating: 0 }))).toBe("rated");
    expect(hasRating(det({ rating: 0 }))).toBe(true);
  });
  test("null is unrated", () => {
    expect(ratedOf(det({ rating: null }))).toBe("unrated");
  });
});

describe("visibility", () => {
  test("all three axes must admit a point", () => {
    const p = det({ rating: 4 });
    expect(isVisible(p, filters())).toBe(true);
    expect(isVisible(p, filters({ dr: false }))).toBe(false);
    expect(isVisible(p, filters({ detected: false }))).toBe(false);
    expect(isVisible(p, filters({ rated: false }))).toBe(false);
  });
  test("visual references are hidden by default", () => {
    const abeam = det({ cross_track_nm: 3, rating: 4 });
    expect(isVisible(abeam, filters())).toBe(false);
    expect(isVisible(abeam, filters({ visual: true }))).toBe(true);
  });
  test("the view that exists for finding what the detector missed", () => {
    const only = filters({ detected: false });
    expect(isVisible(loose({ rating: 4 }), only)).toBe(true);
    expect(isVisible(det({ rating: 4 }), only)).toBe(false);
  });
});

describe("ordering", () => {
  const parts = {
    endpoints: [end("C81", 0), end("KDLH", 300)] as Point[],
    detections: [det({ along_track_nm: 150, rating: 4 }), det({ along_track_nm: 50, rating: 4 })] as Point[],
    added: [loose({ along_track_nm: 100 })] as Point[],
  };
  test("points come back in the order you fly them", () => {
    expect(orderedPoints(parts, filters()).map(e => e.point.along_track_nm))
      .toEqual([0, 50, 100, 150, 300]);
  });
  test("endpoints survive a filter that would exclude them", () => {
    // They are the ends of the leg, not entries in it, so no combination
    // of checkboxes should leave the walk without a start.
    const walk = orderedPoints(parts, filters({ dr: false, visual: false }));
    expect(walk).toHaveLength(2);
  });
  test("a point with no along-track distance is left out, not sorted to zero", () => {
    const unplaced = { ...loose(), along_track_nm: undefined as unknown as number };
    const walk = orderedPoints({ ...parts, added: [unplaced] }, filters());
    expect(walk).toHaveLength(4);
  });
});

describe("arrow direction", () => {
  test("arrows follow the course across the screen", () => {
    // C81->KDLH bears 328: flying it goes up and to the left.
    expect(forwardIsUp(328)).toBe(true);
    expect(forwardIsLeft(328)).toBe(true);
  });
  test("a southeasterly course reverses both", () => {
    expect(forwardIsUp(135)).toBe(false);
    expect(forwardIsLeft(135)).toBe(false);
  });
  test("bearings outside 0-360 wrap", () => {
    expect(forwardIsUp(688)).toBe(forwardIsUp(328));
    expect(forwardIsLeft(-32)).toBe(forwardIsLeft(328));
  });
});

describe("hidden count", () => {
  test("a pick failing three boxes is hidden once, not three times", () => {
    const awkward = loose({ cross_track_nm: 3, role: "visual", source: "added", rating: 4 });
    expect(hiddenCount([awkward], filters({ added: false }))).toBe(1);
  });
});
