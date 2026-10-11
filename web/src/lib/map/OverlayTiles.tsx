import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TileLayer, useMap, useMapEvents } from "react-leaflet";
import { googleMapsQuery } from "../queryClient";
import { usePreferences, type MapOverlay, type OverlayStrength } from "../preferences";

/** How much of the overlay shows over the chart, by its strength. */
const OPACITY: Record<OverlayStrength, number> = { faint: 0.35, half: 0.6, full: 1 };

/** The USGS's aerial imagery of the United States (The National Map's
 *  orthoimagery, a public-domain work), its tiles to zoom 16 and the
 *  chart's upscaling past it. */
const USGS_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";
const USGS_CREDIT = 'Imagery <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

/** Google's Map Tiles API: a session for a kind of map, then its tiles. */
const GOOGLE = "https://tile.googleapis.com";

interface Session { session: string; expiry: number }

/**
 * A Google map session for a kind of map, kept in the browser until a day
 * before it runs out (two weeks, Google says): a session's tiles are one
 * set, asked for once rather than with every page. The satellite's has
 * Google's roads and names over it, as its Satellite view does.
 */
async function googleSession(key: string, kind: "map" | "satellite"): Promise<Session> {
  const kept = `vfr.googleSession.${kind}`;
  try {
    const held = JSON.parse(localStorage.getItem(kept) ?? "null") as Session | null;
    if (held && held.expiry * 1000 - Date.now() > 24 * 3600_000) return held;
  } catch {
    // No storage: a new session.
  }
  const resp = await fetch(`${GOOGLE}/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(kind === "map"
      ? { mapType: "roadmap", language: "en-US", region: "US", imageFormat: "png" }
      : { mapType: "satellite", language: "en-US", region: "US", layerTypes: ["layerRoadmap"] }),
  });
  if (!resp.ok) throw new Error(`Google's map session: ${resp.status}`);
  const answer = await resp.json() as { session: string; expiry: string };
  const session = { session: answer.session, expiry: Number(answer.expiry) };
  try {
    localStorage.setItem(kept, JSON.stringify(session));
  } catch {
    // Kept for this page only.
  }
  return session;
}

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
  const overlay = usePreferences(s => s.overlay);
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
  return <TileLayer url={USGS_URL} maxNativeZoom={16} maxZoom={20} opacity={opacity} zIndex={3} />;
}

function Google({ kind, opacity, overlay }: { kind: "map" | "satellite"; opacity: number; overlay: MapOverlay }) {
  const map = useMap();
  const { data: google } = useQuery(googleMapsQuery);
  const { data: session } = useQuery({
    queryKey: ["googleSession", kind], queryFn: () => googleSession(google!.key, kind), enabled: !!google,
    staleTime: 24 * 3600_000, meta: { silent: true },
  });
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
      maxNativeZoom={kind === "map" ? 22 : 20} maxZoom={22} opacity={opacity} zIndex={3}
    />
  );
}
