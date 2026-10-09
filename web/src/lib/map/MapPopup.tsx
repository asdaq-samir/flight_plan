import type L from "leaflet";
import type { LeafletEventHandlerFnMap } from "leaflet";
import { useContext, useMemo, type ComponentProps } from "react";
import { Popup } from "react-leaflet";
import { MapInsetsContext } from "../../components/mapChrome";

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
/** With `panOnce`, an opened popup pans the map to be in sight, and then holds still:
 *  react-leaflet updates an open popup each time what holds it draws
 *  again, and each of Leaflet's updates pans it again. The VFR waypoints'
 *  layer drew again at each move's end, so a popup a pixel out of place
 *  (a half point rounded the other way) panned the map a pixel, which
 *  ended a move, which drew it again -- the map crept for as long as the
 *  card was open, at the pilot's report (measured: a point every second
 *  or so on a 700-point screen). Its first pans are its content's, drawn
 *  into it just after it opens; past the time those take (Leaflet's
 *  quarter-second pan, and a frame or two), it pans no more until it is
 *  opened again. */
const SETTLES_MS = 600;
const settling = new WeakMap<L.Popup, number>();
const PAN_ONCE: LeafletEventHandlerFnMap = {
  add: event => {
    const popup = event.target as L.Popup;
    popup.options.autoPan = true;
    settling.set(popup, window.setTimeout(() => { popup.options.autoPan = false; }, SETTLES_MS));
  },
  remove: event => {
    const popup = event.target as L.Popup;
    window.clearTimeout(settling.get(popup));
    popup.options.autoPan = true;
  },
};

export function MapPopup({ eventHandlers, panOnce = false, ...props }: ComponentProps<typeof Popup> & {
  /** Pans on opening only, for a popup whose holder draws again while it is
   *  open (the VFR waypoints'). The others keep Leaflet's pan, so a card
   *  that grows late -- a weather or airspace answer, say -- is still
   *  brought into sight. */
  panOnce?: boolean;
}) {
  // Opened, it pans the map to be in sight past the panel over the map
  // (MapPanel), not just inside the map, which runs under the panel.
  const insets = useContext(MapInsetsContext);
  // The caller's handlers beside the one that pans once, as one object
  // while theirs is the same.
  const handlers = useMemo<LeafletEventHandlerFnMap | undefined>(() => {
    if (!panOnce) return eventHandlers;
    return eventHandlers ? {
      ...eventHandlers,
      add: event => { PAN_ONCE.add!(event); eventHandlers.add?.(event); },
      remove: event => { PAN_ONCE.remove!(event); eventHandlers.remove?.(event); },
    } : PAN_ONCE;
  }, [eventHandlers, panOnce]);
  // Props last: these are defaults, and a caller that means something
  // different says so.
  return (
    <Popup
      // Bounds, not the size: the card inside sizes itself to its
      // content and fills whatever box Leaflet settles on. 160 rather
      // than Leaflet's own 50 so a two-line card still reads as a card,
      // and low enough that a short one is not padded out to the width
      // of a card carrying a raw METAR.
      offset={[0, -12]} minWidth={160} maxWidth={360} autoPan
      autoPanPaddingTopLeft={[insets.left + 8, insets.top + 8]} autoPanPaddingBottomRight={[8, insets.bottom + 8]}
      // Leaflet's own close is off: it is a 24x24 glyph jammed into the
      // very corner of the wrapper, and the app's cards already carry a
      // close of their own at the size every other icon button uses.
      // One close, one place, one size -- see `MapCard`.
      closeButton={false}
      {...props}
      eventHandlers={handlers}
    />
  );
}
