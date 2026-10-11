import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { googleMapsQuery } from "../queryClient";
import { TileLayer, useMap, useMapEvents } from "react-leaflet";
import { usePreferences, type MapOverlay, type OverlayStrength } from "../preferences";
import { GOOGLE, useGoogleSession } from "./googleSession";
import { useShownOverlay } from "./useShownOverlay";

/** Above the base chart (1) and the terminal sheet (5, ChartTiles): a
 *  pilot who asks for imagery sees it whole, with the sheet's airspace
 *  under it at Faint and Half. */
const OVERLAY_Z = 6;

/** How much of the overlay shows over the chart, by its strength. */
const OPACITY: Record<OverlayStrength, number> = { faint: 0.35, half: 0.6, full: 1 };

/** The USGS's aerial imagery of the United States (The National Map's
 *  orthoimagery, a public-domain work), its tiles to zoom 16 and the
 *  chart's upscaling past it. */
const USGS_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
const USGS_CREDIT = 'Imagery <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

/**
 * What is drawn over the chart, at the pilot's ask (the map's settings):
 * the USGS's aerial imagery, or Google's map or satellite imagery where
 * the deployment has a Google key -- faint, half or full over it, the
 * chart's own marks (the route, the airports, the traffic) over all of
 * it. Each credited as its maker asks, in the map's lower corner (as the traffic is): Google's
 * "Google Maps" and its data's copyright for the view, from its viewport
 * service. Google's tiles are never kept by the app (vite.config's
 * service worker leaves them to the network), as its terms ask.
 */
export function OverlayTiles() {
  const overlay = useShownOverlay();
  const strength = usePreferences(s => s.overlayStrength);
  if (overlay === "none") return null;
  return overlay === "usgs"
    ? <Usgs opacity={OPACITY[strength]} />
    : <Google kind={overlay === "google-map" ? "map" : "satellite"} opacity={OPACITY[strength]} overlay={overlay} />;
}

function Usgs({ opacity }: { opacity: number }) {
  const map = useMap();
  useEffect(() => {
    const credit = L.control.attribution({ prefix: false, position: "bottomleft" }).addAttribution(USGS_CREDIT).addTo(map);
    return () => { credit.remove(); };
  }, [map]);
  return <TileLayer url={USGS_URL} maxNativeZoom={16} maxZoom={20} opacity={opacity} zIndex={OVERLAY_Z} />;
}

function Google({ kind, opacity, overlay }: { kind: "map" | "satellite"; opacity: number; overlay: MapOverlay }) {
  const map = useMap();
  const { data: google } = useQuery(googleMapsQuery);
  const { data: session } = useGoogleSession(kind);
  // The data's copyright for what is in view, asked again as the view
  // settles (Google's viewport service), and "Google Maps" before it.
  const [copyright, setCopyright] = useState("");
  const [view, setView] = useState(() => map.getBounds());
  useMapEvents(useMemo(() => ({ moveend: () => setView(map.getBounds()) }), [map]));
  useEffect(() => {
    if (!google || !session) return;
    const zoom = Math.round(map.getZoom());
    const ask = new URLSearchParams({
      session: session.session, key: google.key, zoom: String(zoom),
      north: String(Math.min(89.9, view.getNorth())), south: String(Math.max(-89.9, view.getSouth())),
      east: String(Math.max(-179.9, Math.min(179.9, view.getEast()))), west: String(Math.max(-179.9, Math.min(179.9, view.getWest()))),
    });
    let live = true;
    void fetch(`${GOOGLE}/tile/v1/viewport?${ask}`).then(r => (r.ok ? r.json() : null)).then((info: { copyright?: string } | null) => {
      if (live && info?.copyright) setCopyright(info.copyright);
    }).catch(() => { /* the copyright as it was */ });
    return () => { live = false; };
  }, [google, session, view, map]);
  useEffect(() => {
    if (!session) return;
    const credit = L.control.attribution({ prefix: false, position: "bottomleft" })
      .addAttribution(`<span aria-label="Google Maps" data-testid="google-credit">Google Maps</span>${copyright ? ` · ${copyright}` : ""}`)
      .addTo(map);
    return () => { credit.remove(); };
  }, [map, session, copyright]);
  if (!google || !session) return null;
  return (
    <TileLayer
      key={`${overlay}-${session.session}`}
      url={`${GOOGLE}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session.session)}&key=${encodeURIComponent(google.key)}`}
      maxNativeZoom={kind === "map" ? 22 : 20} maxZoom={22} opacity={opacity} zIndex={OVERLAY_Z}
    />
  );
}
