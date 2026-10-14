/**
 * How own ship is drawn on the chart, the pilot's pick in Settings
 * (Appearance, Position), at the owner's ask ("can we change the current
 * location marker on map to be a plane that can be picked from setup"): the
 * arrow it was, or a plane seen from above -- a single, a twin or a jet --
 * nose up, turned to the GPS's heading. Each as SVG in a 32-point box:
 * drawn once in a white casing and once in its colour over it, so the
 * outline holds over any chart and the parts read as one.
 */
export type OwnShipLook = "arrow" | "single" | "twin" | "jet";

export const OWN_SHIP_LOOKS: { value: OwnShipLook; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "twin", label: "Twin" },
  { value: "jet", label: "Jet" },
  { value: "arrow", label: "Arrow" },
];

/** Each look's parts, in a 32 by 32 box, nose to the top. */
const PARTS: Record<OwnShipLook, string> = {
  arrow: `<path d="M16 3 L26 28 L16 22 L6 28 Z"/>`,
  // A high wing's span straight across, its tail at the back.
  single: `<rect x="14.4" y="3" width="3.2" height="25" rx="1.6"/><rect x="2" y="10.5" width="28" height="3.6" rx="1.4"/><rect x="10" y="24" width="12" height="2.8" rx="1.2"/>`,
  // An engine on each wing, ahead of it.
  twin: `<rect x="14.4" y="4" width="3.2" height="24" rx="1.6"/><rect x="1" y="12.5" width="30" height="3.2" rx="1.4"/><rect x="7.4" y="8.5" width="3.4" height="9.5" rx="1.6"/><rect x="21.2" y="8.5" width="3.4" height="9.5" rx="1.6"/><rect x="10.5" y="24" width="11" height="2.8" rx="1.2"/>`,
  // Wings and tail swept back.
  jet: `<rect x="14.4" y="2" width="3.2" height="27" rx="1.6"/><path d="M16 10 L30 19 L30 21.5 L16 17 L2 21.5 L2 19 Z"/><path d="M16 23.5 L22.5 28 L22.5 29.5 L16 27.5 L9.5 29.5 L9.5 28 Z"/>`,
};

/** The look's SVG at `size` points, `fill` over a white casing. */
export function ownShipSvg(look: OwnShipLook, fill: string, size = 32, attrs = ""): string {
  const parts = PARTS[look] ?? PARTS.arrow;
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" ${attrs}>`
    + `<g fill="#ffffff" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${parts}</g>`
    + `<g fill="${fill}">${parts}</g></svg>`;
}
