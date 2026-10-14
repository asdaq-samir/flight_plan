import { describe, expect, it } from "vitest";
import { SHEET_SPRING, atRest, rubberBand, springStep } from "./sheetSpring";

/** Runs the spring at 60 frames a second until it rests, or two seconds. */
function run(from: number, to: number, v: number) {
  let state = { x: from, v };
  let t = 0;
  let furthest = from;
  while (!atRest(state, to) && t < 2) {
    state = springStep(state, to, 1 / 60);
    furthest = to > from ? Math.max(furthest, state.x) : Math.min(furthest, state.x);
    t += 1 / 60;
  }
  return { state, t, furthest };
}

describe("the sheet's spring", () => {
  it("comes to rest where it was going, in about its response's time", () => {
    const { state, t } = run(200, 700, 0);
    expect(state.x).toBeCloseTo(700, 0);
    expect(t).toBeGreaterThan(SHEET_SPRING.response * 0.8);
    expect(t).toBeLessThan(SHEET_SPRING.response * 2.5);
  });

  it("a fast flick toward where it goes overshoots a little, and gets there sooner at first", () => {
    const still = run(200, 700, 0);
    const flicked = run(200, 700, 4000);
    expect(flicked.furthest).toBeGreaterThan(700);
    expect(flicked.furthest).toBeLessThan(700 + 60);
    expect(still.furthest).toBeLessThanOrEqual(700 + 15);
    expect(springStep({ x: 200, v: 4000 }, 700, 0.05).x).toBeGreaterThan(springStep({ x: 200, v: 0 }, 700, 0.05).x);
  });

  it("is steady through a dropped frame", () => {
    const state = springStep({ x: 200, v: 3000 }, 700, 0.1);
    expect(Number.isFinite(state.x)).toBe(true);
    expect(state.x).toBeGreaterThan(200);
    expect(state.x).toBeLessThan(800);
  });
});

describe("the rubber band", () => {
  it("gives way less and less the further it is pulled, never past the room it has", () => {
    const small = rubberBand(20, 800);
    const large = rubberBand(400, 800);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(20);
    expect(large / 400).toBeLessThan(small / 20);
    expect(rubberBand(100_000, 800)).toBeLessThan(800);
    expect(rubberBand(-50, 800)).toBeCloseTo(-rubberBand(50, 800));
    expect(rubberBand(0, 800)).toBe(0);
  });
});
