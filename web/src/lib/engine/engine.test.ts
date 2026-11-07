import { describe, expect, test } from "vitest";
import { callEngine, engineLoaded, engineReady } from "./engine";

describe("the engine, by name", () => {
  test("loaded before any test, its answers the planner's JSON", async () => {
    await engineReady;
    expect(engineLoaded()).toBe(true);
    expect(callEngine("holding_leg_minutes", { altitude_ft: 16_000 })).toBe(1.5);
    expect(callEngine("holding", { inbound: 360, heading: 112 })).toMatchObject({ entry: "teardrop", either: "direct" });
  });

  test("a rule it has not, or input it cannot use, throws its words", () => {
    // Neither is let through by the types (the contract's names and
    // inputs), so these are asked past them, as a stale caller would.
    // @ts-expect-error -- no rule is called "nope".
    expect(() => callEngine("nope", {})).toThrow('The engine\'s nope: the engine has no rule called "nope"');
    // @ts-expect-error -- holding's "heading" is required.
    expect(() => callEngine("holding", { inbound: 360 })).toThrow('holding: "heading" is missing');
  });

  test("text crosses whole, and many calls leak nothing the memory notices", () => {
    const named = callEngine("lost_comms", { segments: [{ name: "Ö’Hare → “B” 😀", minimum_ft: 3000 }] });
    expect(named.segments[0]!.name).toBe("Ö’Hare → “B” 😀");
    const big = Array.from({ length: 5000 }, (_, i) => ({ t: i * 1000, lat: 42 + i / 3600, lon: -88, alt_ft: 3000 }));
    for (let i = 0; i < 20; i++) callEngine("debrief_airborne", { points: big });
    expect(callEngine("debrief_airborne", { points: big })).toEqual([[0, 4999]]);
  });
});
