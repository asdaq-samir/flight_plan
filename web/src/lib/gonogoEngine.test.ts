import { describe, expect, it } from "vitest";
import { callEngine } from "./engine/engine";
import { assess, selfChecks, type FratInput } from "./frat";

// The risk page's labels (lib/frat) are the engine's answers
// (native/crates/brief/src/gonogo/frat.rs), which the planner and the phones
// show: the same checks, points, groups and sources, the same levels.
describe("the risk page's labels", () => {
  it("lists the engine's self checks", () => {
    const engine = callEngine("gonogo_self_checks", {});
    expect(selfChecks().map(c => ({ ...c, stop: !!c.stop }))).toEqual(engine.map(({ key, group, label, why, points, stop }) => ({ key, group, label, why, points, stop })));
  });

  it("turns amber and red where the engine does, and says what it says", () => {
    const quiet: FratInput = { vfrNotRecommended: false, underMinimums: [], tfrOnRoute: false, hazards: 0, night: false, fuelMarginGal: 10, currency: null, day: "2026-10-05", ticked: {} };
    // The ticked checks' points: rusty, stress and pressure 3 each,
    // unfamiliar 2, eating 1.
    const at = (ticked: Record<string, boolean>) => assess({ ...quiet, ticked });
    // Amber from 6 points and red from 12 (frat.rs CAUTION_FROM, HIGH_FROM).
    expect(at({ rusty: true, unfamiliar: true }).score).toBe(5);
    expect(at({ rusty: true, stress: true }).level).toBe("caution");
    expect(at({ rusty: true, stress: true, pressure: true, unfamiliar: true }).score).toBe(11);
    expect(at({ rusty: true, stress: true, pressure: true, unfamiliar: true }).level).toBe("caution");
    expect(at({ rusty: true, stress: true, pressure: true, unfamiliar: true, eating: true }).level).toBe("high");
    const words = {
      low: "Go, with the usual care.",
      caution: "Bring it down where you can (a later time, a shorter leg, an instructor along), or talk it over.",
      high: "Don't go as planned.",
    };
    for (const [level, ticked] of [["low", {}], ["caution", { rusty: true, stress: true }], ["high", { alcohol: true }]] as const) {
      const a = assess({ ...quiet, ticked });
      expect([a.level, a.words]).toEqual([level, words[level]]);
    }
  });
});
