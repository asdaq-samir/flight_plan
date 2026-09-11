import { describe, expect, it } from "vitest";
import type { Airport, Candidate, Leg, Totals } from "../api/types";
import {
  deg, elapsed, hhmm, one, panelRows, scoreColor, signed, summary, totalsParts,
} from "./format";

const airport = (ident: string, lat: number): Airport =>
  ({ ident, name: `${ident} field`, lat, lon: -90 });

const candidate = (over: Partial<Candidate>): Candidate => ({
  osm_id: 1, name: "Lake", category: "water", lat: 45, lon: -90,
  predicted_score: 4.2, along_track_nm: 10, selected: true, ...over,
});

const leg = (from: string, to: string): Leg => ({
  from, to, distance_nm: 10, true_course_deg: 30, wind: null, wca_deg: 0,
  true_heading_deg: 30, magnetic_variation_deg: -1, magnetic_heading_deg: 31,
  groundspeed_kt: 100, ete_min: 6, fuel_gal: 0.8,
});

describe("scoreColor", () => {
  it("bands on the boundary, not just inside it", () => {
    expect(scoreColor(4.5)).toBe("#1a7f37");
    expect(scoreColor(4.0)).toBe("#4a9d4a");
    expect(scoreColor(3.5)).toBe("#b8860b");
    expect(scoreColor(3.0)).toBe("#c2681a");
  });
  it("falls to the low band below 3", () => {
    expect(scoreColor(2.99)).toBe("#b3261e");
  });
});

describe("deg", () => {
  it("pads to three digits", () => expect(deg(7)).toBe("007°"));
  it("shows a full turn as 000, never 360", () => {
    expect(deg(360)).toBe("000°");
    expect(deg(359.7)).toBe("000°");   // rounds to 360 before the modulo
  });
  it("rounds rather than truncating", () => expect(deg(89.6)).toBe("090°"));
});

describe("one", () => {
  it("dashes both flavours of missing", () => {
    expect(one(null)).toBe("—");
    expect(one(undefined)).toBe("—");
  });
  it("keeps a zero as a number", () => expect(one(0)).toBe("0.0"));
});

describe("signed", () => {
  it("marks a positive correction", () => expect(signed(3)).toBe("+3.0°"));
  it("leaves a negative sign alone", () => expect(signed(-3)).toBe("-3.0°"));
  it("treats zero as positive", () => expect(signed(0)).toBe("+0.0°"));
});

describe("hhmm", () => {
  it("pads the minutes", () => expect(hhmm(65)).toBe("1h 05m"));
  it("handles under an hour", () => expect(hhmm(20)).toBe("0h 20m"));
  it("says so when there is no time", () => expect(hhmm(null)).toBe("ETE n/a"));
});

describe("panelRows", () => {
  const dep = airport("C81", 42), dest = airport("KDLH", 46);

  it("puts the ends first and last, in flown order", () => {
    const rows = panelRows(dep, dest, 100, [
      candidate({ along_track_nm: 60, name: "B" }),
      candidate({ along_track_nm: 20, name: "A" }),
    ], []);
    expect(rows.map(r => r.kind === "endpoint" ? r.tag : r.name))
      .toEqual(["DEP", "A", "B", "DEST"]);
  });

  it("numbers checkpoints by their order in `selected`, not by position", () => {
    // The server returns them scored, which is not necessarily in
    // along-track order; the map markers carry the same numbers.
    const rows = panelRows(dep, dest, 100, [
      candidate({ along_track_nm: 60, name: "B" }),
      candidate({ along_track_nm: 20, name: "A" }),
    ], []);
    const byName = Object.fromEntries(
      rows.filter(r => r.kind === "checkpoint").map(r => [r.name, (r as { n: number }).n]));
    expect(byName).toEqual({ B: 1, A: 2 });
  });

  it("takes the leg leaving each checkpoint by position", () => {
    const legs = [leg("C81", "A"), leg("A", "B"), leg("B", "KDLH")];
    const rows = panelRows(dep, dest, 100, [
      candidate({ along_track_nm: 20, name: "A" }),
      candidate({ along_track_nm: 60, name: "B" }),
    ], legs);
    const cps = rows.filter(r => r.kind === "checkpoint") as { name: string; nextLeg: Leg | null }[];
    expect(cps.map(c => c.nextLeg?.to)).toEqual(["B", "KDLH"]);
  });

  it("does not confuse two checkpoints that share a fallback name", () => {
    // Both unnamed, so both display as their category. Matching the leg
    // by name picks the first for both; by position they differ.
    const legs = [leg("C81", "water"), leg("water", "water"), leg("water", "KDLH")];
    const rows = panelRows(dep, dest, 100, [
      candidate({ name: null, along_track_nm: 20 }),
      candidate({ name: null, along_track_nm: 60 }),
    ], legs);
    const cps = rows.filter(r => r.kind === "checkpoint") as { nextLeg: Leg | null }[];
    expect(cps[0]!.nextLeg).not.toBe(cps[1]!.nextLeg);
    expect(cps[1]!.nextLeg!.to).toBe("KDLH");
  });

  it("leaves nextLeg null while the nav log is still loading", () => {
    const rows = panelRows(dep, dest, 100, [candidate({})], []);
    expect((rows[1] as { nextLeg: Leg | null }).nextLeg).toBeNull();
  });

  it("names an unnamed candidate rather than showing a blank", () => {
    const rows = panelRows(dep, dest, 100, [candidate({ name: null })], []);
    expect((rows[1] as { name: string }).name).toBe("(unnamed)");
  });
});

describe("summary", () => {
  it("is blank before the course arrives", () => expect(summary(null, 0, 0)).toBe(""));
  it("says what it is doing between stages", () =>
    expect(summary(210, 0, 0)).toBe("210 nm · scoring checkpoints…"));
  it("reports the selection against what it chose from", () =>
    expect(summary(210, 206, 21)).toBe("210 nm · 21 checkpoints from 206 candidates"));
});

describe("totalsParts", () => {
  const base: Totals = { distance_nm: 210, ete_min: 125, fuel_gal: 17.5, legs_without_wind: 0 };

  it("has no warning when every leg has wind", () =>
    expect(totalsParts(base).warning).toBeNull());
  it("singularises one leg", () =>
    expect(totalsParts({ ...base, legs_without_wind: 1 }).warning)
      .toBe("1 leg without wind data"));
  it("pluralises more", () =>
    expect(totalsParts({ ...base, legs_without_wind: 3 }).warning)
      .toBe("3 legs without wind data"));
  it("dashes fuel that could not be worked out", () =>
    expect(totalsParts({ ...base, fuel_gal: null }).fuel).toBe("— gal"));
});

describe("elapsed", () => {
  it("pads the seconds", () => expect(elapsed(65_000)).toBe("1:05"));
  it("starts at zero", () => expect(elapsed(0)).toBe("0:00"));
});
