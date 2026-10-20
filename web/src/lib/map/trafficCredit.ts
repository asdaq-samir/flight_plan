/** What the Open Database License asks of a map that draws adsb.lol's
 *  data: its source and the licence, named. Not a link: on the map's edge
 *  over the panel a link has no room for a 44-point hit area, and the
 *  console's About links adsb.lol with its licence. */
const ATTRIBUTION = "Traffic adsb.lol, ODbL";

/** Each source the planner names (vfr.traffic: "adsb.lol and adsb.fi"),
 *  credited as its terms ask: adsb.fi's by its name, linked in the
 *  console's About. */
const CREDITS: Record<string, string> = {
  "adsb.lol": ATTRIBUTION, "ADS-B Exchange": "ADS-B Exchange", "adsb.fi": "adsb.fi",
};

/** The map's traffic credit for the planner's `source`: adsb.lol's
 *  where it names none it knows. */
export function trafficCredit(source: string | undefined): string {
  const named = (source ?? "adsb.lol").split(" and ").map(s => CREDITS[s]).filter((c): c is string => !!c);
  if (!named.length) return ATTRIBUTION;
  return named[0] === ATTRIBUTION ? [ATTRIBUTION, ...named.slice(1)].join(" · ") : `Traffic ${named.join(" · ")}`;
}
