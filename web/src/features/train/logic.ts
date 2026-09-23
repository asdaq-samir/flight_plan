import { isEndpoint, type Point, type Rating, type Role, type Source } from "../../lib/api/types";
import { compassPoint } from "../../lib/compass";

export { compassPoint };

/**
 * The decisions the training workspace makes, with no map and no document in
 * sight -- which is what lets them be tested, and what lets React treat
 * them as derivations rather than state to keep in step.
 *
 * Every fault worth catching in this page has been a decision rather
 * than drawing: two counts over different sets, a rated flag maintained
 * apart from the rating it came from, a walk numbered over a set the
 * banner did not count. None needed a browser to go wrong.
 */

export const COLORS: Record<Rating, string> = {
  0: "#8a8f94", 1: "#b3261e", 2: "#c2681a",
  3: "#b8860b", 4: "#4a9d4a", 5: "#1a7f37",
};

/** The scale, in the order the buttons show it. */
export const RATINGS: readonly Rating[] = [0, 1, 2, 3, 4, 5];

/** Beyond this far off course you are looking at it, not flying over it. */
export const DR_CORRIDOR_NM = 0.5;


/**
 * The categories a point has actually been seen carrying, from
 * `CANDIDATE_SPECS` in `src/vfr/osm.py` (`lake_or_pond`, `reservoir`,
 * `stadium`, `town`), the FAA-sourced and synthetic ones assigned
 * elsewhere in that pipeline (`airport`, `tower`, `vor`, `wind_farm`,
 * `intersection`), and what a manual add or a chart reading has produced
 * in practice (`river`, `road_or_rail`, `water`, `other`). Not an enum
 * the server enforces -- `category` is a plain string end to end -- so
 * a value outside this list is shown too, never dropped.
 */
export const CATEGORIES = [
  "airport", "intersection", "lake_or_pond", "reservoir", "river",
  "road_or_rail", "stadium", "tower", "town", "vor", "water",
  "wind_farm", "other",
] as const;

export const FILTER_KEYS = [
  "dr", "visual", "detected", "added", "rated", "unrated",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Record<FilterKey, boolean>;

export const DEFAULT_FILTERS: Filters = {
  dr: true, visual: false,
  detected: true, added: true,
  rated: true, unrated: true,
};

/**
 * What job a point does. A detection carries no role until it is rated,
 * so one is inferred from how far off course it sits -- the same rule the
 * server applies when it stores one.
 */
export function roleOf(point: Point): Role {
  const stored = (point as { role?: Role | null }).role;
  if (stored) return stored;
  const cross = (point as { cross_track_nm?: number }).cross_track_nm ?? 0;
  return Math.abs(cross) <= DR_CORRIDOR_NM ? "dr" : "visual";
}

/**
 * Where a point came from. Anything the detector put on the chart counts
 * as detected, including a pick made against one that has since drifted
 * out of matching range; only a point placed by hand is added.
 */
export function sourceOf(point: Point): Source {
  return (point as { source?: string }).source === "added" ? "added" : "detected";
}

/**
 * Derived from the rating every time rather than read from a flag stored
 * beside it. Kept separately, the two disagreed: a marker drawn green
 * from its rating sat next to a label reading "unrated".
 */
export function hasRating(point: Point): boolean {
  const rating = (point as { rating?: Rating | null }).rating;
  return rating !== null && rating !== undefined;
}

export function ratedOf(point: Point): "rated" | "unrated" {
  return hasRating(point) ? "rated" : "unrated";
}

/** Three independent axes, all of which must admit a point. */
export function isVisible(point: Point, filters: Filters): boolean {
  return filters[roleOf(point)] && filters[sourceOf(point)] && filters[ratedOf(point)];
}

/** "lake_or_pond" reads as "lake or pond" outside a value picker; the
 *  raw string is what the server and the category select still use. */
export function prettyCategory(category: string): string {
  return category.replace(/_/g, " ");
}

export interface WalkEntry {
  point: Point;
  kind: "endpoint" | "detected" | "added";
  index: number;
}

/**
 * Every point in the order you fly past them. Endpoints are included so
 * the walk runs departure to destination; filtered points are not, so
 * stepping never lands on something that is not drawn.
 */
export function orderedPoints(
  parts: { endpoints: Point[]; detections: Point[]; added: Point[] },
  filters: Filters,
): WalkEntry[] {
  const entries: WalkEntry[] = [
    ...parts.endpoints.map((point, index) => ({ point, kind: "endpoint" as const, index })),
    ...parts.detections.map((point, index) => ({ point, kind: "detected" as const, index })),
    ...parts.added.map((point, index) => ({ point, kind: "added" as const, index })),
  ];
  return entries
    .filter(e => isEndpoint(e.point) || isVisible(e.point, filters))
    .filter(e => e.point.along_track_nm !== null && e.point.along_track_nm !== undefined)
    .sort((a, b) => a.point.along_track_nm - b.point.along_track_nm);
}

/**
 * Which way flying the route moves you across the screen, so the arrows
 * follow the map rather than the order points happen to be stored in.
 * Derived from the course, so any heading works.
 */
export function forwardIsUp(bearingDeg: number): boolean {
  const b = ((bearingDeg % 360) + 360) % 360;
  return b < 90 || b > 270;
}

export function forwardIsLeft(bearingDeg: number): boolean {
  return ((bearingDeg % 360) + 360) % 360 > 180;
}

/**
 * How many picks the filters hold back, as one number. A breakdown by
 * axis split a single question -- how much am I not seeing -- into
 * arithmetic the reader had to finish.
 */
export function hiddenCount(picks: Point[], filters: Filters): number {
  return picks.filter(p => !isVisible(p, filters)).length;
}

/**
 * How many candidates exist in each filter bucket, independent of any
 * checkbox's own on/off state -- a checkbox that counted only among
 * what its own filter already lets through would read 0 the moment it
 * was unchecked, telling a developer nothing about what turning it back
 * on would surface. Counted over every candidate (rated or not), the
 * same set the "Showing" total is counted over -- not `picks`, which
 * only includes already-rated points and would make `unrated` read 0
 * forever.
 */
export function filterCounts(candidates: Point[]): Record<FilterKey, number> {
  return {
    dr: candidates.filter(p => roleOf(p) === "dr").length,
    visual: candidates.filter(p => roleOf(p) === "visual").length,
    detected: candidates.filter(p => sourceOf(p) === "detected").length,
    added: candidates.filter(p => sourceOf(p) === "added").length,
    rated: candidates.filter(hasRating).length,
    unrated: candidates.filter(p => !hasRating(p)).length,
  };
}
