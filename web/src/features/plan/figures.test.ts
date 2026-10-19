import { describe, expect, it } from "vitest";
import type { Totals } from "../../lib/api/types";
import { fitFigures, shortFlights, tripFigures } from "./figures";

const totals = { distance_nm: 323.6, ete_min: 165, fuel_gal: 23.4, fuel_required_gal: 30.1, hops: [] } as unknown as Totals;
const input = { totals, local: false, destination: "KLAS" };

describe("fitFigures", () => {
  it("rounds only the figure too wide, up, and leaves the rest exact", () => {
    const exact = tripFigures(input, false);
    const shown = fitFigures(exact, tripFigures(input, true), f => f.name !== "Dist");
    expect(exact[1]!.value).toBe("323.6");
    expect(shown.map(f => f.value)).toEqual([exact[0]!.value, "324", exact[2]!.value, exact[3]!.value]);
    expect(shown[3]!.value).toBe("30.1");
  });

  it("rounds the time to decimal hours and the fuel up when those are too wide", () => {
    const shown = fitFigures(tripFigures(input, false), tripFigures(input, true), f => f.name !== "ETE" && f.name !== "Fuel");
    expect([shown[2]!.value, shown[3]!.value]).toEqual(["2.8h", "31"]);
    expect(shown[1]!.value).toBe("323.6");
  });

  it("changes nothing when everything fits", () => {
    const exact = tripFigures(input, false);
    expect(fitFigures(exact, tripFigures(input, true), () => true)).toEqual(exact);
  });
});

describe("tripFigures", () => {
  it("writes a time en route under an hour in minutes alone", () => {
    const short = { ...input, totals: { ...totals, ete_min: 15 } as Totals };
    expect(tripFigures(short, false)[2]!.value).toBe("15m");
    expect(tripFigures(short, true)[2]!.value).toBe("0.3h");
    expect(tripFigures(input, false)[2]!.value).toBe("2h 45m");
  });

  it("names a local flight's figures To, Aloft and Fuel", () => {
    expect(tripFigures({ ...input, local: true }, false).map(f => f.name)).toEqual(["To", "Aloft", "Fuel"]);
  });

  it("says the next landing, and the distance, time and fuel required to it", () => {
    const hop = { ...totals, distance_nm: 41.2, ete_min: 25, fuel_required_gal: 9.4, hops: [] };
    const stops = { ...input, totals: { ...totals, hops: [{ departure: "C81", destination: "KJVL", totals: hop }] } as unknown as Totals };
    expect(tripFigures(stops, false).map(f => f.value)).toEqual(["KJVL", "41.2", "25m", "9.4"]);
    expect(tripFigures(input, false).map(f => f.value)).toEqual(["KLAS", "323.6", "2h 45m", "30.1"]);
  });

  it("says the arrival's clock time in the time en route's place when asked", () => {
    const figures = tripFigures({ ...input, depart: "2026-01-01T14:22:00Z", arrival: true }, false);
    expect(figures[2]!.name).toBe("ETA");
    expect(figures[2]!.value).toMatch(/^\d\d:\d\d$/);
  });

  it("says the destination and the whole route's distance and time when asked, the fuel still the next landing's", () => {
    const hop = { ...totals, distance_nm: 41.2, ete_min: 25, fuel_required_gal: 9.4, hops: [] };
    const stops = { ...input, toDestination: true, totals: { ...totals, hops: [{ departure: "C81", destination: "KJVL", totals: hop }] } as unknown as Totals };
    expect(tripFigures(stops, false).map(f => f.value)).toEqual(["KLAS", "323.6", "2h 45m", "9.4"]);
  });

  it("keeps all four names, as dashes, with no totals yet, so the strip holds its place", () => {
    const figures = tripFigures({ totals: null, local: false, destination: "" }, false);
    expect(figures.map(f => f.name)).toEqual(["To", "Dist", "ETE", "Fuel"]);
    expect(figures.every(f => f.value === "—")).toBe(true);
  });

  it("marks an estimate's time and fuel with ≈ and rounds the distance up", () => {
    const est = { totals: null, local: false, destination: "KDLH", estimate: { distanceNm: 100.2, cruiseTasKt: 100, fuelBurnGph: 10 } };
    const [, dist, ete, fuel] = tripFigures(est, true);
    expect(dist!.value).toBe("101");
    expect(ete!.value.startsWith("≈")).toBe(true);
    // The trip's 10.0 gal, the 1.4 to start and taxi, and a day reserve's
    // 5.0: 16.4, up to 17.
    expect(fuel!.value).toBe("≈17");
  });

  it("writes an estimate's time as the nav log's own, its minutes rounded first", () => {
    // 199.33 nm at 100 kt is 119.6 minutes: two hours, where the minutes
    // rounded on their own read "1h 60m".
    const est = { totals: null, local: false, destination: "KDLH", estimate: { distanceNm: 199.33, cruiseTasKt: 100, fuelBurnGph: 10 } };
    expect(tripFigures(est, false)[2]!.value).toBe("≈2h 00m");
  });
});

describe("shortFlights", () => {
  it("names every flight of the route the tanks do not hold the fuel for, a later stop's too", () => {
    const hop = (margin: number) => ({ ...totals, fuel_margin_gal: margin, hops: [] });
    const route = { ...totals, hops: [
      { departure: "C81", destination: "KMSN", totals: hop(12) },
      { departure: "KMSN", destination: "KDLH", totals: hop(-3.5) },
    ] } as unknown as Totals;
    expect(shortFlights(route)).toEqual([{ name: "KMSN → KDLH", shortGal: 3.5 }]);
    // And the fuel figure red for it, though the next landing's flight is not short.
    expect(tripFigures({ ...input, totals: route }, false)[3]!.alert).toBe(true);
    expect(shortFlights({ ...totals, fuel_margin_gal: 4 } as Totals)).toEqual([]);
  });
});
