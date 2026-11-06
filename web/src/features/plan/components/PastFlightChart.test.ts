import { describe, expect, test } from "vitest";
import { distanceTicks } from "./PastFlightChart";

describe("distanceTicks", () => {
  test("a long run gets one round step, five marks at most, none at its end", () => {
    expect(distanceTicks(0, 1270)).toEqual([250, 500, 750, 1000]);
  });
  test("a run under 5 nm gets marks inside it, five at most", () => {
    const ticks = distanceTicks(0, 3);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks.every(t => t > 0 && t < 3)).toBe(true);
  });
  test("a run that starts past 0 has marks only inside it", () => {
    const ticks = distanceTicks(200, 1270);
    expect(ticks.every(t => t > 200 && t < 1270)).toBe(true);
    expect(ticks.length).toBeLessThanOrEqual(5);
  });
  test("a fractional step gathers no float error", () => {
    for (const t of distanceTicks(0, 1.3)) expect(Number(t.toFixed(10))).toBe(t);
  });
  test("an empty or backwards run has no marks", () => {
    expect(distanceTicks(5, 5)).toEqual([]);
    expect(distanceTicks(9, 5)).toEqual([]);
  });
});
