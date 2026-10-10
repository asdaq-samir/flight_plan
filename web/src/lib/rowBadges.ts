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
