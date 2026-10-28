import type L from "leaflet";
import type { LeafletEventHandlerFnMap } from "leaflet";
import { useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Popup, useMap } from "react-leaflet";
import { MapInsetsContext } from "../../components/mapChrome";
import { SheetCard } from "../../components/SheetCard";
import { useIsMobile } from "../../hooks/use-mobile";
import { Halo } from "./Halo";

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

type Props = ComponentProps<typeof Popup> & {
  /** Pans on opening only, for a popup whose holder draws again while it is
   *  open (the VFR waypoints'). The others keep Leaflet's pan, so a card
   *  that grows late -- a weather or airspace answer, say -- is still
   *  brought into sight. */
  panOnce?: boolean;
  /** On a phone, the ring round the thing tapped while its card is open
   *  (Halo), as a picked point wears it: a point's (a checkpoint, a
   *  waypoint). Not an area's (a TFR's), whose popup is where the finger
   *  was, nor where the caller rings it itself. */
  ring?: boolean;
  /** On a phone, whether its card moves the point clear of the panel
   *  (default yes); not where picking it flies the map in to it already
   *  (RouteMap's checkpoints, FocusOn), whose flight that pan stopped. */
  panCard?: boolean;
};

/**
 * On a phone, the card a tap opens is a card in the map's panel
 * (SheetCard), as Maps opens a place's in its sheet, where it was a
 * Leaflet popup over the chart beside it, a second surface with no close:
 * at the owner's ask ("let's have consistency and common code",
 * 2026-10-27). Leaflet's own popup still says when it is open -- opened by
 * the tap on its thing, put away by a tap on the chart or another card
 * opening, and by the map's closePopup -- drawn as nothing, its content in
 * the card instead; the card's close, Escape and Back put it away.
 */
export function MapPopup(props: Props) {
  return useIsMobile() ? <PopupCard {...props} /> : <PopupOver {...props} />;
}

function PopupCard({ eventHandlers, panOnce: _panOnce, ring = true, panCard = true, children, ...props }: Props) {
  const popup = useRef<L.Popup>(null);
  // Open, and where its thing is.
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ lat: number; lon: number } | null>(null);
  const handlers = useMemo<LeafletEventHandlerFnMap>(() => ({
    ...eventHandlers,
    add: event => {
      const point = (event.target as L.Popup).getLatLng();
      setOpen(true);
      setAt(point ? { lat: point.lat, lon: point.lng } : null);
      eventHandlers?.add?.(event);
    },
    remove: event => {
      setOpen(false);
      setAt(null);
      eventHandlers?.remove?.(event);
    },
  }), [eventHandlers]);
  // In sight over the panel come up for it: the point moved clear of the
  // half sheet, as Maps moves a place it opens, once the panel has said
  // what it covers -- where it went under the sheet coming up. Not where
  // the caller moves the map itself (autoPan off: the training pass).
  const pans = ring && panCard && props.autoPan !== false;
  return (
    <>
      {/* Leaflet's, for when the card is open; never in sight. */}
      <Popup ref={popup} {...props} className="hidden" autoPan={false} closeButton={false} eventHandlers={handlers} />
      {open && at && pans && <PanClear at={at} />}
      {open && at && ring && <Halo at={at} />}
      {open && <SheetCard onClose={() => popup.current?.close()}>{children}</SheetCard>}
    </>
  );
}

/** An open card's point kept in sight above the sheet as the sheet
 *  changes: its own part, so only an open card hears the sheet's room
 *  (MapInsetsContext). In every card, the 211 closed ones of a route's
 *  checkpoints and candidates drew again at every turn of the sheet,
 *  their marks with them (profiled on the phone project, half to the
 *  pill, 2026-10-27: 1,433 components in that commit). */
function PanClear({ at }: { at: { lat: number; lon: number } }) {
  const map = useMap();
  const insets = useContext(MapInsetsContext);
  const { lat, lon } = at;
  // After the map has stopped, where the same tap set it moving -- a
  // checkpoint's flies in to it (RouteMap's FocusOn): panInside's setView
  // stopped that flight at once at the old zoom, and the checkpoint was
  // never come in to (checkpoints and map specs, found by the other
  // session, 2026-10-27).
  const moving = useRef(false);
  useEffect(() => {
    const start = () => { moving.current = true; };
    const end = () => { moving.current = false; };
    map.on("movestart", start);
    map.on("moveend", end);
    return () => { map.off("movestart", start); map.off("moveend", end); };
  }, [map]);
  useEffect(() => {
    const pan = () => map.panInside([lat, lon], {
      paddingTopLeft: [insets.left + 24, insets.top + 24],
      paddingBottomRight: [24, insets.bottom + 24],
    });
    if (!moving.current) {
      pan();
      return;
    }
    map.once("moveend", pan);
    return () => { map.off("moveend", pan); };
  }, [map, lat, lon, insets.left, insets.top, insets.bottom]);
  return null;
}

function PopupOver({ eventHandlers, panOnce = false, ring: _ring, panCard: _panCard, ...props }: Props) {
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
