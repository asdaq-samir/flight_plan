/** The briefing's sections by title, in the order FlightBriefingView
 *  renders them -- the accordion values NavLogView opens for the
 *  printer. A module of its own (not an export beside the component)
 *  so the component's file keeps fast refresh. */
export const BRIEFING_SECTIONS = [
  "Adverse Conditions", "Current Conditions", "Destination Forecast", "En Route Forecast", "Cruise Altitude",
  "Winds Aloft", "NOTAMs", "ATC Delays", "Airport Information",
];
