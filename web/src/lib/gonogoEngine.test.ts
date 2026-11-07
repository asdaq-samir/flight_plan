import { describe, expect, it } from "vitest";
import { callEngine } from "./engine/engine";
import { assess, CAUTION_FROM, HIGH_FROM, LEVEL_WORDS, SELF_CHECKS, type FratInput } from "./frat";

// The risk page's own labels (lib/frat), held to the engine's rules
// (native/crates/brief/src/gonogo/frat.rs), which the planner and the phones
// show: the same checks, points, groups and sources, the same levels.
describe("the risk page's labels", () => {
  it("lists the engine's self checks", () => {
    const engine = callEngine<{ key: string; group: string; label: string; why: string; points: number; stop: boolean }[]>("gonogo_self_checks", {});
    expect(SELF_CHECKS.map(c => ({ ...c, stop: !!c.stop }))).toEqual(engine.map(({ key, group, label, why, points, stop }) => ({ key, group, label, why, points, stop })));
  });

  it("turns amber and red where the engine does, and says what it says", () => {
    const quiet: FratInput = { vfrNotRecommended: false, underMinimums: [], tfrOnRoute: false, hazards: 0, night: false, fuelMarginGal: 10, currency: null, day: "2026-10-05", ticked: {} };
    // The ticked checks' points: rusty, stress and pressure 3 each,
    // unfamiliar 2, eating 1.
    const at = (ticked: Record<string, boolean>) => assess({ ...quiet, ticked });
    expect(at({ rusty: true, unfamiliar: true }).score).toBe(CAUTION_FROM - 1);
    expect(at({ rusty: true, stress: true }).level).toBe("caution");
    expect(at({ rusty: true, stress: true, pressure: true, unfamiliar: true }).score).toBe(HIGH_FROM - 1);
    expect(at({ rusty: true, stress: true, pressure: true, unfamiliar: true }).level).toBe("caution");
    expect(at({ rusty: true, stress: true, pressure: true, unfamiliar: true, eating: true }).level).toBe("high");
    for (const [level, ticked] of [["low", {}], ["caution", { rusty: true, stress: true }], ["high", { alcohol: true }]] as const) {
      const a = callEngine<{ level: string; words: string }>("gonogo_risk", { day: "2026-10-05", ticked });
      expect([a.level, a.words]).toEqual([level, LEVEL_WORDS[level]]);
    }
  });
});
