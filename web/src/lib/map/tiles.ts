import type { ChartLayer, ChartSheet, Course } from "../api/types";

/**
 * The chart the map draws as its base -- the kind asked for, or the
 * sectional where the course has no such layer -- and the terminal-area
 * kind that belongs over that base: the TAC over the sectional, the IFR
 * area charts over the IFR enroute ones. Resolved here once, for every
 * reader: the Class B pin resolved its own, always the TAC's, and said
 * "Pin the Chicago TAC" on an IFR base while the map drew the IFR area
 * chart.
 */
export function chartPair(layers: ChartLayer[], base: string): { base: ChartLayer | null; overlay: ChartLayer | null } {
  const baseLayer = layers.find(l => l.kind === base) ?? layers.find(l => l.kind === "sec") ?? null;
  const overlay = baseLayer ? layers.find(l => !l.base && l.over.includes(baseLayer.kind)) ?? null : null;
  return { base: baseLayer, overlay };
}

/** The overlay's sheet at a point -- what pinning the overlay there
 *  would draw -- or null where it has none. */
export function sheetAt(overlay: ChartLayer | null, lat: number, lon: number): ChartSheet | null {
  return overlay?.sheets.find(s => s.south <= lat && lat <= s.north && s.west <= lon && lon <= s.east) ?? null;
}

/**
 * Where a chart kind's tiles come from. Published to a CDN (the AWS
 * deployment) they come straight from there and the cycle is a path
 * segment; served by the planner itself, through the gateway, the
 * cycle is the cache-busting query: the tiles are cacheable for weeks,
 * and a browser that cached this {z}/{x}/{y} under an earlier edition
 * must ask again when the edition changes.
 *
 * The revision rides along for the same reason: tiles rendered again
 * within an edition (a sheet cleaned on disk) keep {z}/{x}/{y} and the
 * cycle, and the service worker answers from its cache before it ever
 * asks the network -- one phone showed a white sliver the planner had
 * long since stopped drawing.
 */
export function tileTemplate(course: Course, kind: string): string {
  // A course cached offline from before the planner reported one has none.
  const revision = course.chart_revision ?? 0;
  return course.chart_tiles_base
    ? `${course.chart_tiles_base}/${course.chart_cycle}/${kind}/{z}/{x}/{y}.png?r=${revision}`
    : `/api/planner/chart-tile/${kind}/{z}/{x}/{y}.png?c=${course.chart_cycle}&r=${revision}`;
}

export function tileUrl(course: Course, kind: string, z: number, x: number, y: number): string {
  return tileTemplate(course, kind).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}
