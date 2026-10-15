import { describe, expect, it } from "vitest";
import type { SpeedDay } from "../../lib/api/types";
import { figure, seriesOf, type Metric } from "./speedTrend";

const day = (d: Partial<SpeedDay>): SpeedDay => ({
  day: "2026-10-11", source: "field", metric: "LCP", device: "phone", p50: 1500, p75: 2100, count: 3, version: "abc", ...d,
});

describe("the speed trend", () => {
  const lcp: Metric = { title: "Largest Contentful Paint", field: "LCP", lab: "lcp", unit: "ms", good: 2500 };

  it("puts pilots' 75th percentile on the chosen device beside the lab's median, a day a point", () => {
    const points = seriesOf([
      day({ day: "2026-10-12" }),
      day({}),
      day({ device: "desktop", p75: 900 }),
      day({ source: "lab", metric: "lcp", p50: 1700, p75: 1800 }),
      day({ metric: "INP" }),
    ], lcp, "phone");
    expect(points).toEqual([
      { day: "2026-10-11", field: 2100, lab: 1700 },
      { day: "2026-10-12", field: 2100 },
    ]);
  });

  it("says each figure as a reader takes it in", () => {
    expect(figure(2140, "ms")).toBe("2.1 s");
    expect(figure(96.4, "ms")).toBe("96 ms");
    expect(figure(0.0123, "cls")).toBe("0.012");
    expect(figure(1031.6, "kb")).toBe("1032 KB");
    expect(figure(91.6, "score")).toBe("92");
  });
});
