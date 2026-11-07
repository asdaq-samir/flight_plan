/**
 * The colours the planner draws on the chart, each written once. They are
 * the chart's own and stay the same in the dark theme, as the sectional
 * under them does, so they are values here rather than index.css tokens:
 * MapLibre takes a line's colour as a value, and the marks and the cards'
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

/** Whether the Chart ink look is on (lib/brand puts it on <html> as
 *  data-brand), read where a colour is made outside a render: a canvas,
 *  a marker's html. A component asks lib/brand's useInkLook instead, so
 *  it draws again as the look changes. */
export function isInkLook(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.brand === "ink";
}

/** One of the ink look's own inks (index.css's --ink-magenta and
 *  --ink-brown on html[data-brand="ink"], the magenta with a shade for
 *  the night), as a value for what a token does not reach: a map layer's paint, a
 *  marker's html. An SVG path with a class
 *  takes the stylesheet's instead (CourseLine's course-core, the
 *  course-ink class on a hold's and a way's line). The light value where
 *  the stylesheet is not loaded (a test), or the look is not yet on
 *  <html> (the render it changes in: BrandLook sets it after). */
function inkToken(name: "--ink-magenta" | "--ink-brown", light: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || light;
}

/** The course's colour where it is drawn as a value: the chart's magenta,
 *  or the ink look's deeper one. `ink` from a component's useInkLook,
 *  so it draws again as the look changes; read off <html> otherwise. */
export function courseColour(ink = isInkLook()): string {
  return ink ? inkToken("--ink-magenta", "#b3338c") : COURSE_MAGENTA;
}

/** A checkpoint's mark on the map (RouteMap's dots) and in the nav log
 *  (PointMark): its score's colour (format's scoreColor), and in the ink
 *  look the sectional's brown, one ink for every checkpoint as the
 *  chart's own marks are. */
export function checkpointColour(scoreFill: string, ink = isInkLook()): string {
  return ink ? inkToken("--ink-brown", "#8a5a2b") : scoreFill;
}
