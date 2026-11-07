import { divIcon, type IconLike } from "./icons";
import { STOP_KINDS, type StopKind } from "../stopKinds";

/** A stop's pin: the caution's orange, its glyph in white (lucide's), its
 *  point in the middle of the field's mark drawn under it (StopPin), as
 *  Tesla's trip map pins its chargers (the owner's screenshot,
 *  2026-10-21) -- the field under the pin, with its ident, at the owner's
 *  asks ("Put airports under the fuel markers"; "at the middle of the
 *  airport markers", 2026-10-26). */
function stopPin(glyph: string) {
  return divIcon({
    className: "",
    html: '<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 2 23.5 2 14a13 13 0 0 1 26 0c0 9.5-13 23-13 23z" fill="#d9480f" stroke="#fff" stroke-width="2"/>'
      + `<g transform="translate(7.5 6.5) scale(0.62)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`,
    iconSize: [30, 38], iconAnchor: [15, 37],
  });
}
/** A suggested fuel stop's: the pump (lucide's Fuel). */
export const FUEL_PIN = stopPin('<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>');
/** A break's on a long flight the tanks hold (fuelstops.suggest_break): a cup (lucide's Coffee). */
export const BREAK_PIN = stopPin('<path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>');
/** A suggested stop pinned on the chart (the totals' fuel_stops). */
export type StopPin = { ident: string; lat: number; lon: number; reason?: "fuel" | "break" };

/** A field's stacked pins (the owner's pick of the Stops canvas, I,
 *  2026-10-27): one teardrop for each kind it has, in the kind's colour
 *  with its glyph in white, each fanned eight points right and four up
 *  from the one before so every glyph shows, the first kind in front, its
 *  tip on the field. One icon each set of kinds, made once: a new icon
 *  for every render would have the marker made again. */
const stackedPins = new Map<string, IconLike>();
export function stackedPin(kinds: StopKind[]): IconLike {
  const key = kinds.join(",");
  const kept = stackedPins.get(key);
  if (kept) return kept;
  const n = kinds.length;
  const width = 30 + (n - 1) * 8, height = 38 + (n - 1) * 4;
  // Back to front: the last kind drawn first, behind the others.
  const pins = kinds.map((kind, i) => {
    const { colour, paths } = STOP_KINDS[kind];
    const glyph = paths.map(d => `<path d="${d}"/>`).join("");
    return `<g transform="translate(${i * 8} ${(n - 1 - i) * 4})"><path d="M15 37C15 37 2 23.5 2 14a13 13 0 0 1 26 0c0 9.5-13 23-13 23z" fill="${colour}" stroke="#fff" stroke-width="2"/>`
      + `<g transform="translate(7.5 6.5) scale(0.62)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></g>`;
  }).reverse().join("");
  const icon = divIcon({
    className: "",
    html: `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${pins}</svg>`,
    iconSize: [width, height], iconAnchor: [15, height - 1],
  });
  stackedPins.set(key, icon);
  return icon;
}

