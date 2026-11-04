import { describe, expect, it } from "vitest";
import { LINE_MAX, LINES_MAX, glanceLines, type BriefGlance } from "./glance";
import type { VerdictItem } from "./verdict";

const item = (key: VerdictItem["key"], finding: VerdictItem["finding"], detail: string, label: string = key): VerdictItem => ({
  key, label, finding, detail, tab: "preflight", section: "x",
});
const quiet: VerdictItem[] = [
  item("weather", "ok", "No hazards along the route", "Weather"),
  item("airspace", "ok", "None on the route", "TFRs & special use"),
  item("altitude", "ok", "FL055 · Lowest", "Altitude"),
  item("fuel", "ok", "Needs 27.6 gal with taxi and a 30 min reserve; 12.4 gal spare", "Fuel"),
  item("runways", "ok", "Takeoff and landing within each runway", "Runways"),
  item("balance", "ok", "2,407 lb at 41.2 in, within limits", "Weight & balance"),
  item("risk", "ok", "Low · 2 points", "Risk"),
];
const field = (ident: string, runway: string, crosswindKt: number) => ({
  ident, category: "VFR", at: null, runway, runwayFt: 3000, overFiftyFt: 1800, wind: "270/18", crosswindKt, radio: null, finding: "caution" as const,
});
const glance: BriefGlance = {
  before: { risk: null, spareGal: 12.4, balance: null, finding: "ok" },
  depart: field("C81", "27", 18),
  enroute: { ceilingFt: null, visibilitySm: null, wind: null, eteMin: null, line: null, finding: "ok" },
  arrive: { ...field("KDLH", "9", 4), finding: "ok" },
  raw: { metars: [{ ident: "C81", raw: "METAR C81 ..." }], tafs: [{ ident: "KDLH", raw: "TAF KDLH ..." }], tfrs: ["6/1111 · Sporting event"] },
};
const with_ = (changes: Partial<Record<VerdictItem["key"], [VerdictItem["finding"], string]>>) =>
  quiet.map(i => (changes[i.key] ? { ...i, finding: changes[i.key]![0], detail: changes[i.key]![1] } : i));

describe("the Brief's lines at a glance", () => {
  it("folds a quiet day into one row saying everything is fine", () => {
    const { act, rest } = glanceLines(quiet, glance);
    expect(act).toEqual([]);
    expect(rest.finding).toBe("ok");
    expect(rest.line).toBe("Weather, tfrs & special use, altitude, fuel, runways, weight & balance, risk: nothing to fix");
    expect(rest.items).toHaveLength(7);
  });

  it("says the crosswind in the glance's own figures, with what to do, and why with its rule and the METAR", () => {
    const { act, rest } = glanceLines(with_({ runways: ["caution", "Crosswind past the POH's demonstrated at C81"] }), glance);
    expect(act).toHaveLength(1);
    expect(act[0]!.line).toBe("Runway 27 at C81 has 18 kt across, past the POH's demonstrated: ask for another runway, or wait for the wind");
    expect(act[0]!.cite).toBe("14 CFR 91.103(b); the POH");
    expect(act[0]!.raw).toEqual(["METAR C81 ..."]);
    expect(rest.line).toBe("Weather, tfrs & special use, altitude, fuel, weight & balance, risk: nothing to fix");
  });

  it("puts the stops before the cautions, at most three lines, the rest counted", () => {
    const items = with_({
      weather: ["caution", "AIRMET Sierra along the route"],
      airspace: ["stop", "TFR 6/1111 in force when you get there"],
      fuel: ["stop", "2.3 gal short of the fuel and its 30 min reserve (14 CFR 91.151)"],
      runways: ["caution", "Crosswind past the POH's demonstrated at C81"],
      risk: ["caution", "Caution · 14 points"],
    });
    const { act, rest } = glanceLines(items, glance);
    expect(act.map(l => l.key)).toEqual(["airspace", "fuel", "weather"]);
    expect(act[0]!.line).toBe("TFR 6/1111 in force when you get there: route around it, or go later");
    expect(act[0]!.raw).toEqual(["6/1111 · Sporting event"]);
    expect(act[1]!.line).toBe("2.3 gal short of the fuel and its 30 min reserve (14 CFR 91.151): add fuel, or plan a stop");
    expect(rest.line).toBe("2 more to look at");
    expect(rest.finding).toBe("caution");
    expect(rest.items.map(i => i.key)).toEqual(["altitude", "runways", "balance", "risk"]);
  });

  it("keeps every line to one sentence of at most 140 characters, however long the engine's detail", () => {
    const long = "VFR not recommended: " + "KDLH currently reporting IFR with ceilings of 400 ft and visibility of a half mile in fog, ".repeat(3);
    const items = with_({ weather: ["stop", long], altitude: ["stop", "Ceiling 11,700 ft: terrain 40 nm past KDLH needs 12,500"], balance: ["stop", "120 lb over the maximum takeoff weight"] });
    const { act } = glanceLines(items, glance);
    expect(act.length).toBeLessThanOrEqual(LINES_MAX);
    for (const l of act) {
      expect(l.line.length).toBeLessThanOrEqual(LINE_MAX);
      expect(l.line).not.toMatch(/\. [A-Z]/);
      expect(l.line.endsWith(":")).toBe(false);
    }
    expect(act[0]!.line).toMatch(/…: wait for it to lift, or plan another day$/);
  });

  it("says what is still being checked, and what was not worked out", () => {
    expect(glanceLines(with_({ fuel: ["pending", "Working out the fuel…"] }), null).rest.line).toBe("Still checking fuel");
    const rest = glanceLines(with_({ balance: ["unknown", "Not worked out for this airplane"] }), null).rest;
    expect(rest.line).toBe("1 more to look at");
    expect(rest.finding).toBe("unknown");
  });
});
