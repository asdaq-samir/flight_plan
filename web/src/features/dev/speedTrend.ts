import type { SpeedDay } from "../../lib/api/types";

/** What a metric is measured in, for its figures. */
export type Unit = "ms" | "score" | "cls" | "kb";

/** One chart: a Core Web Vital from pilots' browsers (`field`, by its
 *  75th percentile, as Google judges a site) beside the nightly lab run's
 *  (`lab`), or a lab measurement alone. `good` is where "good" ends:
 *  Google's thresholds for the Web Vitals (web.dev/articles/vitals,
 *  /articles/fcp, /articles/ttfb), Lighthouse's for its own, CI's budget
 *  for the first load (ci.yml, first-load.mjs --budget 1100000), and INP's
 *  200 ms for the lab's taps, which time the same thing. */
export interface Metric {
  title: string;
  field?: string;
  lab?: string;
  unit: Unit;
  good?: number;
  /** A score, where more is better. */
  higher?: boolean;
}

export const METRICS: Metric[] = [
  { title: "Largest Contentful Paint", field: "LCP", lab: "lcp", unit: "ms", good: 2500 },
  { title: "Interaction to Next Paint", field: "INP", unit: "ms", good: 200 },
  { title: "Cumulative Layout Shift", field: "CLS", lab: "cls", unit: "cls", good: 0.1 },
  { title: "First Contentful Paint", field: "FCP", lab: "fcp", unit: "ms", good: 1800 },
  { title: "Time to First Byte", field: "TTFB", unit: "ms", good: 800 },
  { title: "Total Blocking Time", lab: "tbt", unit: "ms", good: 200 },
  { title: "Lighthouse performance", lab: "performance", unit: "score", good: 90, higher: true },
  { title: "First load", lab: "first_load_kb", unit: "kb", good: 1100 },
  { title: "Opening the app", lab: "open_app", unit: "ms" },
  { title: "Fly Here to the route", lab: "fly_here", unit: "ms" },
  { title: "Map settings", lab: "map_settings", unit: "ms", good: 200 },
  { title: "Share menu", lab: "share_menu", unit: "ms", good: 200 },
  { title: "Aircraft menu", lab: "aircraft_menu", unit: "ms", good: 200 },
  { title: "Zooming the map", lab: "zoom", unit: "ms" },
];

/** A figure as a reader takes it in: seconds past one, a third decimal for CLS. */
export function figure(value: number, unit: Unit): string {
  switch (unit) {
    case "ms": return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
    case "cls": return value.toFixed(3);
    case "kb": return `${Math.round(value)} KB`;
    case "score": return String(Math.round(value));
  }
}

/** Each day's figures for one chart: pilots' 75th percentile on the
 *  chosen device, and the lab's median, which runs as a phone. */
export function seriesOf(days: SpeedDay[], metric: Metric, device: string) {
  const byDay = new Map<string, { day: string; field?: number; lab?: number }>();
  for (const d of days) {
    const field = d.source === "field" && d.metric === metric.field && d.device === device;
    const lab = d.source === "lab" && d.metric === metric.lab;
    if (!field && !lab) continue;
    const point = byDay.get(d.day) ?? { day: d.day };
    if (field) point.field = d.p75;
    if (lab) point.lab = d.p50;
    byDay.set(d.day, point);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

