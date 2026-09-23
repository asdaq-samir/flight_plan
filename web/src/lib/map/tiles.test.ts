import { describe, expect, it } from "vitest";
import type { Course } from "../api/types";
import { tileTemplate, tileUrl } from "./tiles";

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
