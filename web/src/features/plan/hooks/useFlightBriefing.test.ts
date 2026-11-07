// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import type { Leg } from "../../../lib/api/types";
import { windStretches } from "./useFlightBriefing";

const leg = (from: string, to: string, altitude_ft: number, dir: number | null, speed = 10, oat_c: number | null = 5): Leg =>
  ({ from, to, altitude_ft, oat_c, wind: dir == null ? null : { wind_dir_true_deg: dir, wind_speed_kt: speed } }) as Leg;

describe("windStretches", () => {
  test("consecutive legs in the same wind, temperature and altitude are one stretch", () => {
    const legs = [leg("C81", "A", 4500, 270.4), leg("A", "B", 4500, 269.6), leg("B", "KDLH", 4500, 300)];
    expect(windStretches(legs)).toEqual([
      { from: "C81", to: "B", altitudeFt: 4500, wind: { dir: 270, speed: 10 }, oatC: 5 },
      { from: "B", to: "KDLH", altitudeFt: 4500, wind: { dir: 300, speed: 10 }, oatC: 5 },
    ]);
  });

  test("another altitude, temperature or a leg with no wind starts a stretch", () => {
    const legs = [leg("A", "B", 4500, null), leg("B", "C", 4500, null), leg("C", "D", 6500, null), leg("D", "E", 6500, null, 10, 2)];
    expect(windStretches(legs).map(s => `${s.from}-${s.to}`)).toEqual(["A-C", "C-D", "D-E"]);
  });
});
