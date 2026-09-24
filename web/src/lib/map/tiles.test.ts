import { describe, expect, it } from "vitest";
import type { ChartLayer, Course } from "../api/types";
import { chartPair, sheetAt, tileTemplate, tileUrl } from "./tiles";

const course = { chart_cycle: "09-03-2026", chart_revision: 2, chart_tiles_base: null } as unknown as Course;

describe("tile URLs", () => {
  it("carry the cycle and the revision, so a re-render within a cycle is fetched afresh", () => {
    expect(tileUrl(course, "sec", 9, 124, 184)).toBe("/api/planner/chart-tile/sec/9/124/184.png?c=09-03-2026&r=2");
  });

  it("carry the revision from the CDN too, where the cycle is a path segment", () => {
    const published = { ...course, chart_tiles_base: "https://tiles.example" } as Course;
    expect(tileTemplate(published, "tac")).toBe("https://tiles.example/09-03-2026/tac/{z}/{x}/{y}.png?r=2");
  });

  it("reads a course from before the revision existed as revision 0", () => {
    const older = { chart_cycle: "09-03-2026", chart_tiles_base: null } as unknown as Course;
    expect(tileUrl(older, "sec", 1, 2, 3)).toBe("/api/planner/chart-tile/sec/1/2/3.png?c=09-03-2026&r=0");
  });
});

const layer = (kind: string, base: boolean, over: string[] = [], sheets: ChartLayer["sheets"] = []): ChartLayer =>
  ({ kind, label: kind, min_zoom: base ? 3 : 10, max_zoom: 12, base, over, sheets }) as ChartLayer;
const CHICAGO = { name: "Chicago", label: "Chicago TAC", west: -89.5, south: 41.0, east: -86.8, north: 42.8 };
const IFR_CHICAGO = { name: "ENR_AREA_CHI", label: "IFR area chart", west: -89.8, south: 40.9, east: -86.5, north: 43.0 };
const LAYERS = [
  layer("sec", true), layer("ifr_low", true), layer("tac", false, ["sec"], [CHICAGO]),
  layer("ifr_area", false, ["ifr_low", "ifr_high"], [IFR_CHICAGO]),
];

describe("the chart pair", () => {
  it("is the overlay that belongs over the base drawn", () => {
    expect(chartPair(LAYERS, "sec").overlay?.kind).toBe("tac");
    // The Class B pin resolved the TAC whatever the base, and named it
    // over an IFR base while the map drew the IFR area chart.
    expect(chartPair(LAYERS, "ifr_low").overlay?.kind).toBe("ifr_area");
  });

  it("falls back to the sectional, and its overlay, for a base the course has no layer of", () => {
    const pair = chartPair(LAYERS, "ifr_high");
    expect(pair.base?.kind).toBe("sec");
    expect(pair.overlay?.kind).toBe("tac");
  });

  it("finds the sheet under a point, and none away from every sheet", () => {
    const ord = [41.98, -87.9] as const;
    expect(sheetAt(chartPair(LAYERS, "sec").overlay, ...ord)?.label).toBe("Chicago TAC");
    expect(sheetAt(chartPair(LAYERS, "ifr_low").overlay, ...ord)?.label).toBe("IFR area chart");
    expect(sheetAt(chartPair(LAYERS, "sec").overlay, 46.8, -92.2)).toBeNull();
  });
});
