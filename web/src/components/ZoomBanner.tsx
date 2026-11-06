import { useEffect, useRef } from "react";
import type L from "leaflet";
import { cn } from "cn";
import { GLASS } from "./mapChrome";
import { TEXT } from "../lib/text";

/** How long the zoom stays said once the map has stopped zooming. */
const LINGER_MS = 1500;
/** How soon after a finger, a wheel or a key a zoom is the pilot's own:
 *  a double tap's zoom sets off a few hundred milliseconds after it. */
const OWN_MS = 800;
/** The scale bar's longest, in CSS px. */
const BAR_MOST = 96;
/** The international nautical mile, exactly, which the US adopted in 1954
 *  and the FAA's charts and this app's distances are in. */
const METRES_PER_NM = 1852;
/** The bar's lengths, in nm: the largest that fits BAR_MOST is drawn. */
const NICE_NM = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/** The bar for zoom `zoom` about `center`: its length in nm and in px. */
function scaleAt(map: L.Map, center: L.LatLng, zoom: number) {
  const at = map.project(center, zoom);
  const metres = map.distance(map.unproject(at, zoom), map.unproject(at.add([BAR_MOST, 0]), zoom));
  const nmPerPx = metres / METRES_PER_NM / BAR_MOST;
  const nm = [...NICE_NM].reverse().find(n => n / nmPerPx <= BAR_MOST) ?? 0.25;
  return { nm, px: Math.round(nm / nmPerPx) };
}

/**
 * The map's zoom level and a scale bar in nautical miles, said in the
 * banners' column while the pilot zooms and for a moment after, at the
 * owner's ask (2026-11-05: "Can I see the zoom level on the top banner as
 * I change zoom"), as Apple Maps shows its scale while a map is zoomed.
 * Only for the pilot's own zooms -- a pinch, a double tap, a wheel, a key
 * -- not the app's (a route fitted, the map brought to own ship on
 * opening). A pinch zooms in fractions (lib/map/pinch.ts, zoomSnap 0), so
 * to a tenth. Written straight into the elements on each of Leaflet's zoom
 * events, not through React's state, so a pinch's every frame is not a
 * render; left out for VoiceOver, which would read it at every frame.
 */
export default function ZoomBanner({ map }: { map: L.Map | null }) {
  const box = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const miles = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    const text = figure.current;
    if (!map || !el || !text || !bar.current || !miles.current) return;
    const line = bar.current;
    const length = miles.current;
    const container = map.getContainer();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Fingers on the map now, and when the pilot last touched, scrolled
    // or pressed a key on it: in the capture phase, as the pinch handler
    // keeps its events to itself.
    let fingers = 0;
    let lastInput = 0;
    const input = () => { lastInput = performance.now(); };
    const down = () => { fingers += 1; input(); };
    const up = () => { fingers = Math.max(0, fingers - 1); input(); };
    const own = () => fingers > 0 || performance.now() - lastInput < OWN_MS;
    const say = (zoom: number, center: L.LatLng) => {
      if (!own()) return;
      clearTimeout(timer);
      const shown = String(Math.round(zoom * 10) / 10);
      if (text.textContent !== shown) text.textContent = shown;
      const { nm, px } = scaleAt(map, center, zoom);
      const nmShown = `${nm} nm`;
      if (length.textContent !== nmShown) length.textContent = nmShown;
      line.style.width = `${px}px`;
      el.hidden = false;
    };
    const onZoom = () => say(map.getZoom(), map.getCenter());
    // An animated zoom (a double tap, the buttons) says where it is going
    // as it sets off.
    const onAnim = (e: L.ZoomAnimEvent) => say(e.zoom, e.center);
    const onEnd = () => {
      if (el.hidden) return;
      clearTimeout(timer);
      timer = setTimeout(() => { el.hidden = true; }, LINGER_MS);
    };
    const capture = { capture: true, passive: true } as const;
    container.addEventListener("pointerdown", down, capture);
    container.addEventListener("pointerup", up, capture);
    container.addEventListener("pointercancel", up, capture);
    container.addEventListener("wheel", input, capture);
    container.addEventListener("keydown", input, capture);
    map.on("zoom", onZoom);
    map.on("zoomanim", onAnim);
    map.on("zoomend", onEnd);
    return () => {
      clearTimeout(timer);
      container.removeEventListener("pointerdown", down, capture);
      container.removeEventListener("pointerup", up, capture);
      container.removeEventListener("pointercancel", up, capture);
      container.removeEventListener("wheel", input, capture);
      container.removeEventListener("keydown", input, capture);
      map.off("zoom", onZoom);
      map.off("zoomanim", onAnim);
      map.off("zoomend", onEnd);
    };
  }, [map]);
  return (
    <div
      ref={box} hidden aria-hidden="true" data-testid="zoom-banner"
      className={cn(GLASS, "flex min-h-8 w-fit items-center gap-3 rounded-full px-3 tabular-nums", TEXT.detail)}
    >
      <span className="flex items-baseline gap-1">
        <span className="text-foreground/65">Zoom</span>
        <span ref={figure} className="font-semibold" />
      </span>
      {/* The scale: a bar the length of a round distance, its ends ticked
          as a chart's scale is, and the distance after it. */}
      <span className="flex items-center gap-1.5">
        <span ref={bar} className="h-1.5 border-x-2 border-b-2 border-foreground/80" />
        <span ref={miles} className="font-semibold" />
      </span>
    </div>
  );
}
