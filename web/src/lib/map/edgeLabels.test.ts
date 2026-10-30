import { describe, expect, it } from "vitest";
import { EVERY_PX, INSIDE_PX, edgeSpots, spotBox, type EdgeSpot } from "./edgeLabels";

/** A line's one label, which each test here expects it to have. */
function first(spots: EdgeSpot[]): EdgeSpot {
  expect(spots).toHaveLength(1);
  return spots[0]!;
}

describe("a volume's altitudes along its own line", () => {
  it("writes them on the line's right, the volume's side, along it", () => {
    // East along y = 0: the right with y down is +y.
    const [spot] = edgeSpots([{ x: 0, y: 0 }, { x: 200, y: 0 }], 40);
    expect(spot).toEqual({ x: 100, y: INSIDE_PX, angle: 0 });
  });

  it("turns words that would read upside down, still on the volume's side", () => {
    // West: the volume above the line on the screen (-y), the words
    // turned to read left to right.
    const west = first(edgeSpots([{ x: 200, y: 0 }, { x: 0, y: 0 }], 40));
    expect(west.y).toBeCloseTo(-INSIDE_PX);
    expect(west.angle).toBeCloseTo(0);
    // North on the screen (up, -y): the volume to its right (+x), the
    // words up the line at -90, not down it.
    const north = first(edgeSpots([{ x: 0, y: 200 }, { x: 0, y: 0 }], 40));
    expect(north.x).toBeCloseTo(INSIDE_PX);
    expect(north.angle).toBeCloseTo(-90);
    // South: the volume to its left on the screen (-x), turned to -90 too.
    const south = first(edgeSpots([{ x: 0, y: 0 }, { x: 0, y: 200 }], 40));
    expect(south.x).toBeCloseTo(-INSIDE_PX);
    expect(south.angle).toBeCloseTo(-90);
    // South-west, down to the left: turned to read up to the right.
    const sw = first(edgeSpots([{ x: 200, y: 0 }, { x: 0, y: 200 }], 40));
    expect(sw.angle).toBeCloseTo(-45);
    expect(sw.x + sw.y).toBeLessThan(200);
  });

  it("repeats along a long line and leaves short ones bare", () => {
    expect(edgeSpots([{ x: 0, y: 0 }, { x: 3 * EVERY_PX, y: 0 }], 40)).toHaveLength(3);
    expect(edgeSpots([{ x: 0, y: 0 }, { x: 130, y: 0 }], 40)).toHaveLength(1);
    expect(edgeSpots([{ x: 0, y: 0 }, { x: 100, y: 0 }], 40)).toHaveLength(0);
    // Shorter than its own words.
    expect(edgeSpots([{ x: 0, y: 0 }, { x: 150, y: 0 }], 160)).toHaveLength(0);
    expect(edgeSpots([{ x: 0, y: 0 }], 40)).toHaveLength(0);
  });

  it("follows a ring round, each label inside it", () => {
    // A counter-clockwise ring in lon/lat is clockwise on the screen:
    // its inside on each piece's right.
    const ring = Array.from({ length: 73 }, (_, i) => {
      const a = (i * 5 * Math.PI) / 180;
      return { x: 300 + 200 * Math.cos(a), y: 300 + 200 * Math.sin(a) };
    });
    const spots = edgeSpots(ring, 40);
    expect(spots.length).toBe(4);
    for (const s of spots) {
      expect(Math.hypot(s.x - 300, s.y - 300)).toBeLessThan(200);
      expect(Math.abs(s.angle)).toBeLessThanOrEqual(90);
    }
  });

  it("leaves out words that would stand across a sharp corner", () => {
    expect(edgeSpots([{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 0, y: 2 }], 40)).toHaveLength(0);
  });

  it("boxes turned words by the room they take", () => {
    expect(spotBox({ x: 0, y: 0, angle: 0 }, 40, 12)).toEqual({ x0: -20, y0: -6, x1: 20, y1: 6 });
    const upright = spotBox({ x: 0, y: 0, angle: -90 }, 40, 12);
    expect(upright.x1).toBeCloseTo(6);
    expect(upright.y1).toBeCloseTo(20);
  });
});
