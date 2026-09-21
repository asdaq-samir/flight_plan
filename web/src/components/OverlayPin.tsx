import type L from "leaflet";
import { useEffect, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { Button } from "./ui/button";
import { chartLayers, useChartLayers } from "../lib/map/chartLayers";
import type { Basemaps } from "../lib/map/leaflet";

interface Props {
  map: L.Map | null;
  basemaps: Basemaps | null;
}

/**
 * The pin the map offers over a terminal area. Close in over Chicago
 * -- from the TAC's own first zoom, with the map's centre inside the
 * sheet -- a small pill at the map's top-right names it ("Chicago
 * TAC"); a tap pins it, which draws the terminal area chart over the
 * sectional (the IFR area chart over an IFR enroute chart) until it
 * is unpinned, and on a pointer, hovering the pill previews the sheet
 * without pinning it. Pinned, the pill stays wherever the map goes,
 * so it can be unpinned from anywhere. The same setting as the info
 * popover's checkbox, remembered per browser (see `chartLayers`).
 *
 * Nothing replaces the base chart on its own: past the sectional's
 * own detail the map upscales the sectional rather than swapping in
 * a busier sheet the pilot did not ask for.
 */
export default function OverlayPin({ map, basemaps }: Props) {
  const { tac: pinned } = useChartLayers();
  const [offer, setOffer] = useState<{ label: string; offered: boolean } | null>(null);

  useEffect(() => {
    if (!map || !basemaps) return;
    const update = () => setOffer(basemaps.overlayAt());
    update();
    map.on("moveend zoomend", update);
    const unsubscribe = chartLayers.subscribe(update);
    return () => { map.off("moveend zoomend", update); unsubscribe(); };
  }, [map, basemaps]);

  if (!offer || !(offer.offered || pinned)) return null;
  return (
    <Button
      type="button"
      size="xs"
      variant={pinned ? "default" : "outline"}
      aria-pressed={pinned}
      title={pinned ? `Unpin the ${offer.label}` : `Pin the ${offer.label} over the chart`}
      data-testid="overlay-pin"
      // z-[1000]: over Leaflet's own panes (tiles at 200, markers at
      // 600, popups at 700), the same level Leaflet gives its controls;
      // still inside the map's own stacking context, so a drawer
      // opened over the map covers it along with the map.
      className="absolute right-2 top-2 z-[1000] shadow-sm"
      onClick={() => chartLayers.setTac(!pinned)}
      // A hover preview for a pointer only: a finger's tap also fires
      // pointerenter and never a pointerleave, which would leave the
      // preview on after an unpin.
      onPointerEnter={e => { if (e.pointerType === "mouse") basemaps?.preview(true); }}
      onPointerLeave={() => basemaps?.preview(false)}
    >
      {pinned ? <PinOff /> : <Pin />}
      {offer.label}
    </Button>
  );
}
