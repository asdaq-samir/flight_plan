// @vitest-environment jsdom
import L from "leaflet";
import { describe, expect, it, vi } from "vitest";

// view.ts asks the window whether it hovers as it loads; jsdom has no
// matchMedia, so one is there before the import runs.
vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
});
const { aheadOf, within } = await import("./view");

const bounds = (s: number, w: number, n: number, e: number) => L.latLngBounds([s, w], [n, e]);

describe("aheadOf", () => {
  it("adds the view's own size on every side, out to the half degree", () => {
    const { box } = aheadOf(bounds(44.6, -93.7, 45.2, -92.9));
    expect(box).toEqual({ south: 44, west: -94.5, north: 46, east: -92 });
  });
  it("stays on the globe", () => {
    const high = aheadOf(bounds(80, 170, 89, 179)).box;
    expect(high.north).toBe(90);
    expect(high.east).toBe(180);
    const low = aheadOf(bounds(-89, -179, -80, -170)).box;
    expect(low.south).toBe(-90);
    expect(low.west).toBe(-180);
  });
});

describe("within", () => {
  const was = aheadOf(bounds(44.6, -93.7, 45.2, -92.9));
  it("holds for a pan or a zoom in inside the box", () => {
    expect(within(bounds(44.8, -93.5, 45.4, -92.7), was)).toBe(true);
    expect(within(bounds(44.8, -93.4, 45.0, -93.1), was)).toBe(true);
  });
  it("fails when the view leaves the box", () => {
    expect(within(bounds(46.5, -93.7, 47.1, -92.9), was)).toBe(false);
  });
  it("fails when the box is over three times what the view would ask for", () => {
    const state = aheadOf(bounds(43, -97, 49, -90));
    expect(within(bounds(44.6, -93.7, 45.2, -92.9), state)).toBe(false);
  });
});
