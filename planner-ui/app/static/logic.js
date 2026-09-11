/**
 * The decisions the labeling page makes, with no map and no document in
 * sight -- which is what lets them be tested.
 *
 * Everything here is a pure function of plain objects. That is not
 * incidental: the faults worth catching in this page have all been
 * decisions rather than drawing. Two filters that disagreed about which
 * points to count, a rating flag maintained separately from the rating
 * it came from, a walk numbered over a different set than the banner
 * counted. None of those needed a browser to go wrong, and none needed
 * one to find.
 */

/** Ratings, and the colour each is drawn in, everywhere it appears. */
export const COLORS = {
  0: "#8a8f94", 1: "#b3261e", 2: "#c2681a",
  3: "#b8860b", 4: "#4a9d4a", 5: "#1a7f37",
};

/** Beyond this far off course you are looking at it, not flying over it. */
export const DR_CORRIDOR_NM = 0.5;

export const FILTER_KEYS = ["dr", "visual", "detected", "added", "rated", "unrated"];

export const DEFAULT_FILTERS = {
  dr: true, visual: false,
  detected: true, added: true,
  rated: true, unrated: true,
};

/**
 * What job a point does. A detection carries no role until it is rated,
 * so one is inferred from how far off course it sits -- the same rule
 * the server applies when it stores one.
 */
export function roleOf(point) {
  return point.role
    || (Math.abs(point.cross_track_nm ?? 0) <= DR_CORRIDOR_NM ? "dr" : "visual");
}

/**
 * Where a point came from. Anything the detector put on the chart counts
 * as detected, including a pick made against one that has since drifted
 * out of matching range; only a point placed by hand is added.
 */
export function sourceOf(point) {
  return point.source === "added" ? "added" : "detected";
}

/**
 * Whether a point has been rated. Derived from the rating every time
 * rather than read from a flag stored beside it: the two are meant to
 * agree, and when they were kept separately they did not -- a marker
 * drawn green from its rating sat next to a label reading "unrated".
 */
export function ratedOf(point) {
  return point.rating !== null && point.rating !== undefined ? "rated" : "unrated";
}

export function hasRating(point) {
  return ratedOf(point) === "rated";
}

/**
 * Three independent axes, all of which must admit a point: what job it
 * does, where it came from, and whether it has been rated.
 */
export function isVisible(point, filters) {
  return Boolean(
    filters[roleOf(point)] && filters[sourceOf(point)] && filters[ratedOf(point)]
  );
}

/**
 * Every point in the order you fly past them. Endpoints are included so
 * the walk runs departure to destination, and filtered points are not,
 * so stepping never lands on something that is not drawn.
 */
export function orderedPoints({ endpoints = [], detections = [], added = [] }, filters) {
  return endpoints.map((d, i) => ({ d, kind: "endpoint", i }))
    .concat(detections.map((d, i) => ({ d, kind: "detected", i })))
    .concat(added.map((d, i) => ({ d, kind: "added", i })))
    .filter(x => x.d.endpoint || isVisible(x.d, filters))
    .filter(x => x.d.along_track_nm !== null && x.d.along_track_nm !== undefined)
    .sort((a, b) => a.d.along_track_nm - b.d.along_track_nm);
}

/**
 * Which way flying the route moves you across the screen, so the arrow
 * keys can follow the map rather than the order the points happen to be
 * stored in. Derived from the course, so any heading works.
 */
export function forwardIsUp(bearingDeg) {
  const b = ((bearingDeg % 360) + 360) % 360;
  return b < 90 || b > 270;
}

export function forwardIsLeft(bearingDeg) {
  return ((bearingDeg % 360) + 360) % 360 > 180;
}

/**
 * How many picks the filters are holding back, as one number. A
 * breakdown by axis split a single question -- how much am I not
 * seeing -- into arithmetic the reader had to finish.
 */
export function hiddenCount(picks, filters) {
  return picks.filter(p => !isVisible(p, filters)).length;
}
