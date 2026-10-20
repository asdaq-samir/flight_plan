import { describe, expect, it } from "vitest";
import c172Json from "../../../data/aircraft/c172.json?raw";
import type { AircraftProfile, Runway } from "./api/types";
import type { RunwayEnd } from "./pattern";
import { endDistance, fieldAir } from "./runwayCheck";
import { DISTANCE_MARGIN, endFit } from "./runwayFit";

const c172 = { name: "c172", ...JSON.parse(c172Json) } as AircraftProfile;
const runway = (length: number) => ({ ends: "09/27", length_ft: length, surface: "ASP", closed: false, runway_ends: [] }) as unknown as Runway;
const end27 = { ident: "27", heading_true_deg: 270 } as unknown as RunwayEnd;
const at = { aircraft: c172, end: end27, elevationFt: 900, altimeterInHg: 29.92, tempC: 15, weightLb: 2550, kind: "takeoff" as const };

describe("a runway end's fit", () => {
  it("says the crosswind, its gusts' where more, against the POH's demonstrated 15 kt", () => {
    // 360 at 12 gusting 20 across 27: 12 and 20 kt from the right.
    const fit = endFit({ ...at, runway: runway(5000), wind: { dirTrueDeg: 360, speedKt: 12, gustKt: 20 } });
    expect(fit.crosswindKt).toBe(20);
    expect(fit.crosswindOver).toBe(true);
    // Straight down it: none across.
    expect(endFit({ ...at, runway: runway(5000), wind: { dirTrueDeg: 270, speedKt: 12, gustKt: null } }).crosswindKt).toBe(0);
  });

  it("marks a runway shorter than the distance over 50 ft, and one within the 15 per cent margin", () => {
    const still = { dirTrueDeg: null, speedKt: 0, gustKt: null };
    const needed = endFit({ ...at, runway: runway(10000), wind: still }).neededFt!;
    expect(needed).toBeGreaterThan(1000);
    expect(endFit({ ...at, runway: runway(needed - 1), wind: still }).short).toBe(true);
    const close = endFit({ ...at, runway: runway(Math.round(needed * 1.1)), wind: still });
    expect([close.short, close.close]).toEqual([false, true]);
    expect(endFit({ ...at, runway: runway(needed * 2), wind: still }).close).toBe(false);
  });

  it("is the runway check's own distance, the field's air, weight and headwind alike", () => {
    // 270 at 10 straight down 27, a grass runway, a warm low day at the field.
    const grass = { ...runway(3000), surface: "TURF" } as Runway;
    const fit = endFit({ ...at, runway: grass, tempC: 30, altimeterInHg: 29.72, wind: { dirTrueDeg: 270, speedKt: 10, gustKt: null } });
    const checked = endDistance(c172.takeoff!, grass, fieldAir(900, 29.72, 30), 2550, 10);
    expect(fit.neededFt).toBe(Math.round(checked.totalFt));
    // No weight known: the table's heaviest, the longest distance.
    const heaviest = endFit({ ...at, weightLb: null, runway: grass, wind: null });
    expect(heaviest.neededFt).toBe(Math.round(endDistance(c172.takeoff!, grass, fieldAir(900, 29.92, 15), Math.max(...c172.takeoff!.weights_lb), 0).totalFt));
  });

  it("holds a runway to SAFO 19001's 15 per cent over the distance needed", () => {
    expect(DISTANCE_MARGIN).toBe(1.15);
  });
});
