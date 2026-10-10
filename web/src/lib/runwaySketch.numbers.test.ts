import { describe, expect, test } from "vitest";
import { numbersOf } from "./runwaySketch";

// East-west strips, in the box's own points, as the sketch places them.
const strip = (ends: [string, string], y: number, ax: number, bx: number) =>
  ({ ends, closed: false, ax, ay: y, bx, by: y, ux: 1, uy: 0 });

const SIZE = 11, GAP = SIZE * 0.9 + 2;
const halfWidth = (end: string) => (end.length * 0.62 * SIZE) / 2 + 1;
const overlap = (p: { end: string; x: number; y: number }, q: { end: string; x: number; y: number }) =>
  Math.abs(p.x - q.x) < halfWidth(p.end) + halfWidth(q.end) && Math.abs(p.y - q.y) < SIZE;

describe("where the runways' numbers are written", () => {
  test("leaves off a number with no clear place, rather than writing it over another", () => {
    // O'Hare's 09C and 09R, four points apart: the longer is numbered
    // first, and the shorter's numbers have no room near their ends.
    const written = numbersOf(
      [strip(["09R", "27L"], 104, 50, 330), strip(["09C", "27C"], 100, 50, 350)],
      SIZE, GAP, 400, 200,
    );
    expect(written.map(n => n.end).sort()).toEqual(["09C", "27C"]);
    for (const p of written) for (const q of written) if (p !== q) expect(overlap(p, q)).toBe(false);
  });

  test("moves a number further out where its place is taken, and no two overlap", () => {
    const written = numbersOf(
      [strip(["09C", "27C"], 100, 100, 350), strip(["09R", "27R"], 104, 80, 300)],
      SIZE, GAP, 400, 200,
    );
    const at = (end: string) => written.find(n => n.end === end)!;
    expect(at("09C").x).toBeCloseTo(100 - GAP);
    expect(at("09R").x).toBeCloseTo(80 - GAP - SIZE * 1.2);
    for (const p of written) for (const q of written) if (p !== q) expect(overlap(p, q)).toBe(false);
  });

  test("leaves off a number that would fall outside the box", () => {
    const written = numbersOf([strip(["09", "27"], 100, 5, 395)], SIZE, GAP, 400, 200);
    expect(written).toEqual([]);
  });

  test("leaves a number off whose further place is under the pane too", () => {
    // 09R's first place is taken by 09C's number, and its second is under
    // the pane: it is left off, not written beneath it.
    const pane = (x: number, y: number, hw: number, hh: number) =>
      x + hw > 40 && x - hw < 70 && y + hh > 90 && y - hh < 110;
    const written = numbersOf(
      [strip(["09C", "27C"], 100, 100, 350), strip(["09R", "27R"], 104, 80, 300)],
      SIZE, GAP, 400, 200, pane,
    );
    expect(written.map(n => n.end).sort()).toEqual(["09C", "27C", "27R"]);
  });
});
