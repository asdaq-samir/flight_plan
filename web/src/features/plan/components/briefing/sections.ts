/** The planning panel's tabs that hold the briefing's sections, each a
 *  part of FlightBriefingView: the Brief (the airports among its
 *  sections), under the Nav Log's profile its Cruise Altitude, the
 *  Weather and the airplane's Performance. A module of its own, so the
 *  component's file keeps fast refresh. */
export type BriefingPart = "brief" | "profile" | "weather" | "performance";
