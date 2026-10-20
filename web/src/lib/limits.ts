/**
 * What Wingtip Maps is and is not, in one place: the words Settings' About
 * and the briefing's foot both say, so they cannot drift apart. The pilot
 * in command's authority and the preflight duty are 14 CFR 91.3 and
 * 91.103; the official briefing is Flight Service's (1800wxbrief.com,
 * 1-800-WX-BRIEF). There is no first-launch dialog to accept them, at the
 * owner's ask ("no aviation app does that").
 */

export const LIMITS =
  "Wingtip Maps is a planning aid for VFR flight. It does not replace an official weather briefing (1800wxbrief.com or 1-800-WX-BRIEF), current FAA charts and publications, or the pilot in command’s judgement and final authority (14 CFR 91.3, 91.103). Its checkpoints are a model’s suggestions: check them against the chart.";

/** The reminder a planning aid owes its pilot: the limits, then what to
 *  check before flight (14 CFR 91.103). About's, the printed briefing's
 *  foot and wherever else it is said. */
export const PLANNING_AID =
  `${LIMITS} Before flight, verify current weather, NOTAMs, TFRs, airport status, aircraft performance, and applicable regulations (14 CFR 91.103).`;

/** Where the planner's data comes from, each with the terms it is used
 *  under (About). The FAA's, NOAA's and the USGS's are works of the US
 *  government, which carry no copyright (17 U.S.C. 105); adsb.lol's is
 *  under the Open Database License, whose 4.3 asks for this credit;
 *  adsb.fi's for personal, non-commercial use, credited and linked;
 *  OurAirports puts its data in the public domain; Virtual Radar Server's
 *  routes are CC0. */
export const DATA_SOURCES: { name: string; licence: string; href?: string }[] = [
  { name: "FAA sectional and terminal area charts", licence: "Public domain" },
  { name: "FAA airports, airspace, obstacles and procedures", licence: "Public domain" },
  { name: "FAA aircraft registry", licence: "Public domain" },
  { name: "NOAA weather models, winds aloft and magnetic declination", licence: "Public domain" },
  { name: "aviationweather.gov METARs, TAFs and SIGMETs", licence: "Public domain" },
  { name: "USGS The National Map imagery", licence: "Public domain" },
  { name: "OurAirports runways, frequencies and fields abroad", licence: "Public domain", href: "https://ourairports.com/data/" },
  { name: "adsb.lol ADS-B traffic", licence: "ODbL 1.0", href: "https://opendatacommons.org/licenses/odbl/1-0/" },
  // Its terms ask for its name and a link to its home page.
  { name: "adsb.fi ADS-B traffic", licence: "Personal use", href: "https://adsb.fi" },
  { name: "Virtual Radar Server flight routes", licence: "CC0", href: "https://creativecommons.org/publicdomain/zero/1.0/" },
];
