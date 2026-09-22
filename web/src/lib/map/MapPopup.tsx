import type { ComponentProps } from "react";
import { Popup } from "react-leaflet";

/**
 * Every popup a marker opens, on either map.
 *
 * There were five, in three different shapes: the planner's checkpoint
 * and airport popups took Leaflet's defaults and auto-sized themselves
 * (one came out 187px wide), the Class B card capped itself at 260-340
 * and refused to close on a map click, and the training map's used a
 * third pair of numbers again. Two of those live on the *same* map, so
 * the same gesture -- a tap on the chart -- dismissed one popup and
 * left the other sitting there.
 *
 * The defaults here are Leaflet's own dismissal: a tap on the map
 * closes the popup, and opening one closes the last, which is what
 * every map a pilot has used already does. A card that has to survive
 * that -- the training map's, which follows a selection the keys walk
 * rather than a tap -- overrides it explicitly, and the override reads
 * as the exception it is.
 *
 * Worth knowing before changing this: a click *inside* a popup never
 * reaches the map. Leaflet stops it at the popup's own container, so
 * `closeOnClick` cannot be triggered by the card's own buttons --
 * measured, not assumed (the Class B card's pin fires zero map clicks;
 * a tap on the chart fires one). That is why the pin can keep working
 * with dismissal left at Leaflet's default.
 */
export function MapPopup(props: ComponentProps<typeof Popup>) {
  // Props last: these are defaults, and a caller that means something
  // different says so.
  return (
    <Popup
      offset={[0, -12]} minWidth={220} maxWidth={340} autoPan
      // Leaflet's own close is off: it is a 24x24 glyph jammed into the
      // very corner of the wrapper, and the app's cards already carry a
      // close of their own at the size every other icon button uses.
      // One close, one place, one size -- see `MapCard`.
      closeButton={false}
      {...props}
    />
  );
}
