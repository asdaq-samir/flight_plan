import { Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { SHEET_SECONDS } from "../../../../components/mapChrome";
import { prefersReducedMotion } from "../../../motion";
import { usePreferences } from "../../../preferences";
import { underway } from "../../glide";
import { ownShipHtml } from "../../icons";
import { useOwnShip } from "../../ownShip";
import { useGlMap } from "../glLayer";
import { glZoom } from "../glStyle";

/** OwnShipLayer's: the location arrow's close-in, Leaflet's zoom. */
const LOCAL_ZOOM = 9;

/**
 * Own ship as a MapLibre marker: an element the map places in the same
 * frame it draws the chart, so it stays on its point through a pinch, at
 * the GPS's heading on the map (rotationAlignment). Followed while the
 * location arrow says so, a drag ending that as on the Leaflet map; the
 * arrow's tap flies to it (recentred); grey at its last place when own
 * ship is turned off (the owner, 2026-10-06).
 */
export function OwnShipGl() {
  const { map } = useGlMap();
  const look = usePreferences(s => s.ownShipLook);
  const enabled = useOwnShip(s => s.enabled);
  const fix = useOwnShip(s => s.fix);
  const simulated = useOwnShip(s => s.simulated);
  const follow = useOwnShip(s => s.follow);
  const recentred = useOwnShip(s => s.recentred);
  const recentreZoom = useOwnShip(s => s.recentreZoom);
  const marker = useRef<Marker | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.style.pointerEvents = "none";
    marker.current = new Marker({ element: el, rotationAlignment: "map" });
    const stop = (e: { originalEvent?: Event }) => {
      if (e.originalEvent && useOwnShip.getState().follow) useOwnShip.getState().setFollow(false);
    };
    map.on("dragstart", stop);
    return () => { map.off("dragstart", stop); marker.current?.remove(); marker.current = null; };
  }, [map]);
  useEffect(() => {
    const m = marker.current;
    if (!m) return;
    if (!fix) { m.remove(); return; }
    // The Leaflet map's own mark (icons.ts ownShipHtml, the same
    // `data-own-ship` the specs find), turned by the marker to the heading.
    const heading = enabled ? fix.headingDeg : null;
    const { size, html } = ownShipHtml(heading == null ? null : 0, !enabled, look, enabled && (simulated || underway(fix)));
    const el = m.getElement();
    el.style.width = el.style.height = `${size}px`;
    el.innerHTML = html;
    m.setLngLat([fix.lon, fix.lat]).setRotation(heading ?? 0).addTo(map);
  }, [map, fix, enabled, simulated, look]);
  const flown = useRef(recentred);
  useEffect(() => {
    if (!fix || !enabled) return;
    if (flown.current !== recentred) {
      flown.current = recentred;
      const zoom = recentreZoom !== null ? glZoom(recentreZoom) : Math.max(map.getZoom(), glZoom(LOCAL_ZOOM));
      map.flyTo({ center: [fix.lon, fix.lat], zoom, duration: prefersReducedMotion() ? 0 : SHEET_SECONDS * 2000 });
      return;
    }
    if (follow) map.easeTo({ center: [fix.lon, fix.lat], duration: prefersReducedMotion() ? 0 : 500 });
  }, [map, fix, enabled, follow, recentred, recentreZoom]);
  return null;
}
