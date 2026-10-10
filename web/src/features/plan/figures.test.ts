import { describe, expect, it } from "vitest";
import type { Totals } from "../../lib/api/types";
import { fitFigures, tripFigures } from "./figures";

const totals = { distance_nm: 323.6, ete_min: 165, fuel_gal: 23.4 } as Totals;
const input = { totals, depart: "2026-01-01T14:22:00Z", local: false };

describe("fitFigures", () => {
  it("rounds only the figure too wide, up, and leaves the rest exact", () => {
    const exact = tripFigures(input, false);
    const shown = fitFigures(exact, tripFigures(input, true), f => f.name !== "Dist");
    expect(exact[0]!.value).toBe("323.6");
    expect(shown.map(f => f.value)).toEqual(["324", exact[1]!.value, exact[2]!.value, exact[3]!.value]);
    expect(shown[3]!.value).toBe("23.4");
  });

  it("rounds the time to decimal hours and the fuel up when those are too wide", () => {
    const shown = fitFigures(tripFigures(input, false), tripFigures(input, true), f => f.name !== "ETE" && f.name !== "Fuel");
    expect([shown[1]!.value, shown[3]!.value]).toEqual(["2.8h", "24"]);
    expect(shown[0]!.value).toBe("323.6");
  });

  it("changes nothing when everything fits", () => {
    const exact = tripFigures(input, false);
    expect(fitFigures(exact, tripFigures(input, true), () => true)).toEqual(exact);
  });
});

describe("tripFigures", () => {
  it("names a local flight's figures Aloft, Back and Fuel", () => {
    expect(tripFigures({ ...input, local: true }, false).map(f => f.name)).toEqual(["Aloft", "Back", "Fuel"]);
  });

  it("keeps all four names, as dashes, with no totals yet, so the strip holds its place", () => {
    const figures = tripFigures({ totals: null, depart: "", local: false }, false);
    expect(figures.map(f => f.name)).toEqual(["Dist", "ETE", "ETA", "Fuel"]);
    expect(figures.every(f => f.value === "—")).toBe(true);
  });

  it("marks an estimate's time and fuel with ≈ and rounds the distance up", () => {
    const est = { totals: null, depart: "", local: false, estimate: { distanceNm: 100.2, cruiseTasKt: 100, fuelBurnGph: 10 } };
    const [dist, ete, , fuel] = tripFigures(est, true);
    expect(dist!.value).toBe("101");
    expect(ete!.value.startsWith("≈")).toBe(true);
    expect(fuel!.value.startsWith("≈")).toBe(true);
  });
});
