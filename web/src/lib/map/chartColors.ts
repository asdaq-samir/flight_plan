import type L from "leaflet";

/**
 * The colours the planner draws on the chart, each written once. They are
 * the chart's own and stay the same in the dark theme, as the sectional
 * under them does, so they are values here rather than index.css tokens:
 * Leaflet takes a path's colour as a value, and the marks and the cards'
 * copies of them (the nav log's, the route list's) read the same ones.
 */

/** The course line's magenta, as an FAA chart draws a course: the route,
 *  a hold's racetrack, a top of climb's or descent's tag. */
export const COURSE_MAGENTA = "#e600e6";

/** The sectional's magenta, a VFR waypoint's colour on the chart. */
export const WAYPOINT_MAGENTA = "#c0309f";

/** iOS's own blue (systemBlue), the blue Maps draws its own marks in: the
 *  position dot, a point held on the chart, a procedure's "Direct to".
 *  Not --tint, which is a step deeper for words on white and lighter in
 *  the dark theme, where the chart stays light. */
export const MAP_BLUE = "#007aff";

/** The white casing under a procedure's or a traffic pattern's line, so
 *  the line reads over any chart. */
export const LINE_CASING: L.PathOptions = { color: "#ffffff", weight: 7, opacity: 0.9, lineJoin: "round" };

/** Whether the Chart ink look is on (lib/brand puts it on <html> as
 *  data-brand), read where a colour is made outside a render: a canvas,
 *  a marker's html. A component asks lib/brand's useInkLook instead, so
 *  it draws again as the look changes. */
export function isInkLook(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.brand === "ink";
}

/** One of the ink look's own inks (index.css's --ink-magenta and
 *  --ink-brown on html[data-brand="ink"], the magenta with a shade for
 *  the night), as a value for what a token does not reach: a Leaflet
 *  path's options, a marker's html, a canvas. An SVG path with a class
 *  takes the stylesheet's instead (CourseLine's course-core, the
 *  course-ink class on a hold's and a way's line). The light value where
 *  the stylesheet is not loaded (a test), or the look is not yet on
 *  <html> (the render it changes in: BrandLook sets it after). */
function inkToken(name: "--ink-magenta" | "--ink-brown", light: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || light;
}

/** A checkpoint's mark on the map (RouteMap's dots) and in the nav log
 *  (PointMark): its score's colour (format's scoreColor), and in the ink
 *  look the sectional's brown, one ink for every checkpoint as the
 *  chart's own marks are. */
export function checkpointColour(scoreFill: string, ink = isInkLook()): string {
  return ink ? inkToken("--ink-brown", "#8a5a2b") : scoreFill;
}
