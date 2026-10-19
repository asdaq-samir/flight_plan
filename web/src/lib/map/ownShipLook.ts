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
  // A high wing's span straight across, its tail at the back: drawn, not
  // blocks, at the owner's ask ("redesign the ship to look modern") -- a
  // fuselage tapering to the tail, the wing's tips rounded and its trailing
  // edge swept in to the cabin, a rounded tailplane.
  single: `<path d="M16 2 C17.3 2 18 3.6 18 5.6 L18 21.5 C18 24 17.3 27 16 29.5 C14.7 27 14 24 14 21.5 L14 5.6 C14 3.6 14.7 2 16 2 Z"/>`
    + `<path d="M3.2 10 L28.8 10 Q30 10 30 11.2 L30 12.4 Q30 13.4 28.9 13.5 L18 14.8 L14 14.8 L3.1 13.5 Q2 13.4 2 12.4 L2 11.2 Q2 10 3.2 10 Z"/>`
    + `<path d="M10.6 24 L21.4 24 Q22.2 24 22.2 24.8 L22.2 25.6 Q22.2 26.4 21.4 26.4 L10.6 26.4 Q9.8 26.4 9.8 25.6 L9.8 24.8 Q9.8 24 10.6 24 Z"/>`,
  // An engine on each wing, ahead of it.
  twin: `<rect x="14.4" y="4" width="3.2" height="24" rx="1.6"/><rect x="1" y="12.5" width="30" height="3.2" rx="1.4"/><rect x="7.4" y="8.5" width="3.4" height="9.5" rx="1.6"/><rect x="21.2" y="8.5" width="3.4" height="9.5" rx="1.6"/><rect x="10.5" y="24" width="11" height="2.8" rx="1.2"/>`,
  // Wings and tail swept back.
  jet: `<rect x="14.4" y="2" width="3.2" height="27" rx="1.6"/><path d="M16 10 L30 19 L30 21.5 L16 17 L2 21.5 L2 19 Z"/><path d="M16 23.5 L22.5 28 L22.5 29.5 L16 27.5 L9.5 29.5 L9.5 28 Z"/>`,
};

/** The look's SVG at `size` points, `fill` over a white casing. Moving
 * (`beam`), the plane with Maps' fading beam ahead of its nose and a faint
 * halo round it, so where it is going reads at a glance; still, the drawn
 * plane alone, at the owner's pick ("1 when still and 3 when moving",
 * from the canvas's own-ship row). The beam's box is twice the plane's,
 * the plane at its middle, so the marker's anchor stays the airplane. */
export function ownShipSvg(look: OwnShipLook, fill: string, size = 32, attrs = "", beam = false): string {
  const parts = PARTS[look] ?? PARTS.arrow;
  const plane = `<g fill="#ffffff" stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round">${parts}</g><g fill="${fill}">${parts}</g>`;
  if (beam && look !== "arrow") {
    return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" ${attrs}>`
      + `<defs><radialGradient id="own-ship-beam" cx="32" cy="32" r="31" gradientUnits="userSpaceOnUse">`
      + `<stop offset="0.25" stop-color="${fill}" stop-opacity="0.45"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient></defs>`
      + `<path d="M32 32 L17 3 A31 31 0 0 1 47 3 Z" fill="url(#own-ship-beam)"/>`
      + `<circle cx="32" cy="32" r="14" fill="${fill}" fill-opacity="0.12"/>`
      + `<g transform="translate(16 16)">${plane}</g></svg>`;
  }
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" ${attrs}>${plane}</svg>`;
}
