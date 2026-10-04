import { describe, expect, it } from "vitest";
import type { Briefing } from "./api/types";
import { bestCrosswind, NO_MINIMUMS, underMinimums } from "./minimums";

const briefing = {
  metars: { C81: { ceiling_ft: 2500, visibility_sm: 10, wind_speed_kt: 12, wind_gust_kt: 22 }, KDLH: null },
  forecast: { min_ceiling_ft: 1800, min_visibility_sm: 6, stations: [{ icaoId: "KDLH", ceiling_ft: 4000, visibility_sm: 4 }] },
  airports: {
    C81: { runways: [
      { ends: "6/24", wind: { end: "24", headwind_kt: 10, crosswind_kt: 9, gust_crosswind_kt: 14 } },
      { ends: "18/36", wind: { end: "36", headwind_kt: 5, crosswind_kt: -11, gust_crosswind_kt: -13 } },
    ] },
    KDLH: { runways: [] },
  },
} as unknown as Briefing;

describe("personal minimums", () => {
  it("none set, nothing is under them", () => {
    expect(underMinimums(NO_MINIMUMS, briefing, ["C81", "KDLH"], "KDLH")).toEqual([]);
  });

  it("the best runway is the one with the least crosswind, gusts included", () => {
    expect(bestCrosswind((briefing.airports.C81!).runways)).toEqual({ end: "36", kt: 13 });
  });

  it("each airport's report, the destination's forecast and the route's, against each minimum", () => {
    expect(underMinimums({ ceilingFt: 3000, visibilitySm: 5, crosswindKt: 10, windKt: 20 }, briefing, ["C81", "KDLH"], "KDLH")).toEqual([
      "C81 ceiling 2,500 ft, under your 3,000 ft",
      "C81 wind 12G22 kt, over your 20 kt",
      "C81 crosswind 13 kt on its best runway (36), over your 10 kt",
      "KDLH forecast visibility 4 sm, under your 5 sm",
      "Along the route, forecast ceiling 1,800 ft, under your 3,000 ft",
    ]);
  });
});
