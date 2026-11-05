import { useEffect, useRef } from "react";
import type L from "leaflet";
import { cn } from "cn";
import { GLASS } from "./mapChrome";
import { TEXT } from "../lib/text";

/** How long the zoom stays said once the map has stopped zooming. */
const LINGER_MS = 1500;

/**
 * The map's zoom level, said in the banners' column while it changes and
 * for a moment after, at the owner's ask (2026-11-05: "Can I see the zoom
 * level on the top banner as I change zoom"). A pinch zooms in fractions
 * (lib/map/pinch.ts, zoomSnap 0), so to a tenth. Written straight into the
 * element on each of Leaflet's zoom events, not through React's state, so a
 * pinch's every frame is not a render; left out for VoiceOver, which would
 * read it at every frame.
 */
export default function ZoomBanner({ map }: { map: L.Map | null }) {
  const box = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    const text = figure.current;
    if (!map || !el || !text) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const say = (zoom: number) => {
      clearTimeout(timer);
      const shown = String(Math.round(zoom * 10) / 10);
      if (text.textContent !== shown) text.textContent = shown;
      el.hidden = false;
    };
    const onZoom = () => say(map.getZoom());
    // An animated zoom (a double tap, the buttons, a fit) says where it
    // is going as it sets off.
    const onAnim = (e: L.ZoomAnimEvent) => say(e.zoom);
    const onEnd = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { el.hidden = true; }, LINGER_MS);
    };
    map.on("zoom", onZoom);
    map.on("zoomanim", onAnim);
    map.on("zoomend", onEnd);
    return () => {
      clearTimeout(timer);
      map.off("zoom", onZoom);
      map.off("zoomanim", onAnim);
      map.off("zoomend", onEnd);
    };
  }, [map]);
  return (
    <div
      ref={box} hidden aria-hidden="true" data-testid="zoom-banner"
      className={cn(GLASS, "flex min-h-8 w-fit items-center gap-1 rounded-full px-3 tabular-nums", TEXT.detail)}
    >
      <span className="text-foreground/65">Zoom</span>
      <span ref={figure} className="font-semibold" />
    </div>
  );
}
