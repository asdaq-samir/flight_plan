/** The badges' colours, by what a row is about: one per kind, the same
 *  on every card. Not the weather's colours (lib/map/flightCategory), so
 *  a badge is never read as a flight category. */
export const BADGE = {
  tower: "#2465b8",
  ground: "#0f766e",
  weather: "#0284c7",
  approach: "#5b5bd6",
  traffic: "#c2410c",
  other: "#6b7280",
  runway: "#3f4652",
  chart: "#475569",
  rule: "#64748b",
  hazard: "#b42318",
  lights: "#a16207",
} as const;

/** The consoles' rows -- the settings, the Personal tab's pages -- each
 *  in a colour of its own, as iOS's Settings leads every row with one,
 *  from the same palette as the cards'. */
export const SETTING_BADGE = {
  aircraft: BADGE.tower,
  flights: BADGE.ground,
  logbook: BADGE.traffic,
  minimums: BADGE.hazard,
  theme: BADGE.approach,
  layout: BADGE.weather,
  route: BADGE.ground,
  narrative: "#7e3fb8",
  tips: BADGE.lights,
  about: BADGE.other,
} as const;
