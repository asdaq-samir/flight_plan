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
