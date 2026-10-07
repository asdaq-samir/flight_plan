/** The briefing's sections by title, in the order FlightBriefingView
 *  renders them -- the accordion values NavLogView opens for the
 *  printer. A module of its own (not an export beside the component)
 *  so the component's file keeps fast refresh. */
export const BRIEFING_SECTIONS = [
  "Adverse Conditions", "Current Conditions", "Destination Forecast", "En Route Forecast", "Cruise Altitude",
  "Winds Aloft", "Check before you fly", "Airport Information", "Pattern & Radio", "Weight & Balance",
  "Takeoff & Landing", "Risk Assessment",
];

/** The planning panel's tabs that hold the briefing's sections, each a
 *  part of FlightBriefingView: the Brief (the narrative, the risk and what
 *  to check), under the Profile its Cruise Altitude, the Weather, the
 *  airplane's Performance and the Airports. */
export type BriefingPart = "brief" | "profile" | "weather" | "performance" | "airports";
