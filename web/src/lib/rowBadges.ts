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
  // A stop's services (StopServices): the fuel, a car, food, a bed.
  fuel: "#b45309",
  car: "#2563eb",
  food: "#be185d",
  lodging: "#7e3fb8",
} as const;

/** The consoles' rows -- the settings, the Personal tab's pages -- each
 *  in a colour of its own, as iOS's Settings leads every row with one,
 *  from the same palette as the cards'. */
export const SETTING_BADGE = {
  aircraft: BADGE.tower,
  flights: BADGE.ground,
  logbook: BADGE.traffic,
  minimums: BADGE.hazard,
  subscription: "#be185d",
  pilot: "#0e7490",
  theme: BADGE.approach,
  layout: BADGE.weather,
  chartNight: BADGE.chart,
  look: BADGE.food,
  route: BADGE.ground,
  narrative: "#7e3fb8",
  position: "#2563eb",
  tips: BADGE.lights,
  about: BADGE.other,
  // Setup's own rows (PilotPanel): the settings grey as iPhone's General,
  // the guide the tint's blue.
  general: "#8e8e93",
  guide: BADGE.tower,
} as const;
