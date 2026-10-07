/**
 * The route's own panel -- its box, the airplane's and the time's chips,
 * the nav log and the briefing's tabs, Save and Print, the kneeboard --
 * in a chunk of its own (PlanWorkspace), at the pilot's ask for a faster
 * app: the planner opens on the search and the chart, which needs none
 * of it, and the first load carried all of it. Fetched as soon as the
 * page is idle, so it is in hand before a route is.
 */
export { default as NavLogView } from "./components/navlog/NavLogView";
export { default as FlightBriefingView, BriefingNotices, PlanningAidNote, SaveFlightButton } from "./components/briefing/FlightBriefingView";
export { default as RouteBox } from "./components/RouteBox";
export { default as Kneeboard } from "./components/Kneeboard";
export { default as FlightInputs } from "./components/navlog/FlightInputs";
export { default as AltitudeButton } from "./components/navlog/AltitudeButton";
export { default as BriefNarrative } from "./components/briefing/BriefNarrative";
export { default as RouteProblem } from "./components/RouteProblem";
export { default as PrintMenu } from "./components/navlog/PrintMenu";
