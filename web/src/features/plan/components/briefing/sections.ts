/** The planning panel's tabs that hold the briefing's sections, each a
 *  part of FlightBriefingView: the Brief, under the Nav Log's profile its
 *  Cruise Altitude, the Weather, the airplane's Performance and the
 *  Airports. A module of its own, so the component's file keeps fast
 *  refresh. */
export type BriefingPart = "brief" | "profile" | "weather" | "performance" | "airports";
