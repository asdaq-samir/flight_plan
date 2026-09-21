import { useEffect } from "react";
import { Pin, PinOff } from "lucide-react";
import { Button } from "./ui/button";
import type { OverlayOffer } from "../lib/map/ChartTiles";
import { usePreferences } from "../lib/preferences";

interface Props {
  /** What the map offers under its centre (see `ChartTiles`). */
  offer: OverlayOffer | null;
  /** The pin's hover: draws the overlay while on, pinned or not. */
  onPreview: (on: boolean) => void;
}

/**
 * The pin the map offers over a terminal area. Close in over Chicago
 * -- from the TAC's own first zoom, with the map's centre inside the
 * sheet -- a small pill at the map's top-right names it ("Chicago
 * TAC"); a tap pins it, which draws the terminal area chart over the
 * sectional (the IFR area chart over an IFR enroute chart) until it
 * is unpinned, and on a pointer, hovering the pill previews the sheet
 * without pinning it. Pinned, the pill stays wherever the map goes,
 * so it can be unpinned from anywhere. The same setting as the layers
 * popover's checkbox, remembered per browser (the preferences store).
 */
export default function OverlayPin({ offer, onPreview }: Props) {
  const pinned = usePreferences(s => s.tac);
  const setTac = usePreferences(s => s.setTac);

  // The preview ends with the pill: a pill that goes away under the
  // pointer (the map zoomed out past the offer) never gets its
  // pointerleave, and without this the preview stayed on -- the
  // terminal chart drawn everywhere, with nothing on screen to say why.
  const visible = !!offer && (offer.offered || pinned);
  useEffect(() => {
    if (!visible) onPreview(false);
    return () => onPreview(false);
  }, [visible, onPreview]);

  if (!visible) return null;
  return (
    <Button
      type="button"
      size="xs"
      variant={pinned ? "default" : "outline"}
      aria-pressed={pinned}
      title={pinned ? `Unpin the ${offer.label}` : `Pin the ${offer.label} over the chart`}
      data-testid="overlay-pin"
      // Placed by `MapControls`, under the map's own buttons.
      className="shadow-sm"
      // A tap decides; the preview ends with it either way, so an
      // unpin under a resting pointer shows the base chart at once.
      onClick={() => { onPreview(false); setTac(!pinned); }}
      // A hover preview for a pointer only: a finger's tap also fires
      // pointerenter and never a pointerleave, which would leave the
      // preview on after an unpin.
      onPointerEnter={e => { if (e.pointerType === "mouse" && !pinned) onPreview(true); }}
      onPointerLeave={() => onPreview(false)}
    >
      {pinned ? <PinOff /> : <Pin />}
      {offer.label}
    </Button>
  );
}
