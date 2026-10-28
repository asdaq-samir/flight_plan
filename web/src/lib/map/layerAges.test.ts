import { describe, expect, it } from "vitest";
import type { Traffic } from "../api/types";
import { ageWords, trafficAt } from "./layerAges";

const NOW = Date.parse("2026-10-26T15:00:00Z");

describe("ageWords", () => {
  it("says how long ago, in minutes, then hours", () => {
    expect(ageWords(NOW - 20_000, NOW)).toBe("just now");
    expect(ageWords(NOW - 4 * 60_000, NOW)).toBe("4m ago");
    expect(ageWords(NOW - 125 * 60_000, NOW)).toBe("2h 5m ago");
    expect(ageWords(null, NOW)).toBeNull();
  });
});

describe("trafficAt", () => {
  it("is the newest answer's time less its own age", () => {
    const answer = (age: number) => ({ aircraft: [], age_s: age }) as unknown as Traffic;
    expect(trafficAt([
      { data: answer(3), updatedAt: NOW - 60_000 },
      { data: answer(12), updatedAt: NOW },
      { data: undefined, updatedAt: NOW + 5_000 },
    ])).toBe(NOW - 12_000);
    expect(trafficAt([])).toBeNull();
  });
});
