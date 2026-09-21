import type { Course } from "../api/types";

/**
 * Where a chart kind's tiles come from. Published to a CDN (the AWS
 * deployment) they come straight from there and the cycle is a path
 * segment; served by the planner itself, through the gateway, the
 * cycle is the cache-busting query: the tiles are cacheable for weeks,
 * and a browser that cached this {z}/{x}/{y} under an earlier edition
 * must ask again when the edition changes.
 */
export function tileTemplate(course: Course, kind: string): string {
  return course.chart_tiles_base
    ? `${course.chart_tiles_base}/${course.chart_cycle}/${kind}/{z}/{x}/{y}.png`
    : `/api/planner/chart-tile/${kind}/{z}/{x}/{y}.png?c=${course.chart_cycle}`;
}

export function tileUrl(course: Course, kind: string, z: number, x: number, y: number): string {
  return tileTemplate(course, kind).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}
