import type { ComponentProps } from "react";
import { Tooltip } from "react-leaflet";
import { hovers } from "./view";

/**
 * Every hover label on either map, the counterpart to `MapPopup`.
 *
 * The same drift, one layer up: the course line's label took Leaflet's
 * defaults (direction "auto", so it flipped sides as the pointer
 * crossed the map, at 0.9 opacity) while a Class B marker's sat above
 * the marker at full opacity. Both sticky, nothing else in common.
 *
 * Above the thing, opaque, and following the pointer: a chart is busy
 * enough that a label reading through to the linework underneath is
 * hard to read, and a label that changes sides while you move is hard
 * to follow.
 */
export function MapTooltip(props: ComponentProps<typeof Tooltip>) {
  // None on a touch screen, where there is no pointer to follow: opened by
  // a tap, a sticky tooltip measured itself at every move of a pan (its
  // offsetWidth, a layout each time: 0.2 s of a phone's in three pans,
  // 2026-10-23), and a tap opens the thing's card anyway.
  if (!hovers) return null;
  return <Tooltip direction="top" offset={[0, -10]} opacity={1} sticky {...props} />;
}
