import * as maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, MapMouseEvent, PaddingOptions, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The worker MapLibre parses its sources in (worker.ts).
import "./worker";
// The app's own typeface for the map's words (MapLibre draws them from
// the font file, no glyph server): the Latin subset the page loads.
import interUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import MapControls from "../../../components/MapControls";
import MapBanners from "../../../components/MapBanners";
import { MapInsetsContext, SHEET_SECONDS, type MapInsets } from "../../../components/mapChrome";
import { SheetCard } from "../../../components/SheetCard";
import type { SheetTurn } from "../../../components/MapPanel";
import type { Course } from "../../api/types";
import { chartQuery } from "../../queryClient";
import { prefersReducedMotion } from "../../motion";
import { BUTTONS_CLEAR } from "../clear";
import { CardCloseContext } from "../cardClose";
import { COUNTRY_ZOOM, OPEN_ZOOM, useOwnShip } from "../ownShip";
import { GlMapContext, SLOTS, slotId, type GlMapApi, type GlTap } from "./glLayer";
import { glZoom } from "./glStyle";
import { RulerGl } from "./layers/RulerGl";
import { tvPlatform, zoomInKey, zoomOutKey } from "../../tv";

const COUNTRY: [number, number] = [39.5, -98.35];
/** As MapShell's: the least the map is fitted to round a route, ~10 nm. */
const MIN_FIT_DEG = 0.08;
/** RouteMap's: how close in an airport's card brings the map. */
const PLACE_ZOOM = 9;
/** Round a fit, over what the panel covers: a margin, and clear of the
 *  map's buttons at the sides (MapShell's). */
export const FIT_MARGIN = { top: 30, bottom: 30, left: 30 + BUTTONS_CLEAR, right: 30 + BUTTONS_CLEAR };
const flight = () => (prefersReducedMotion() ? 0 : SHEET_SECONDS * 1000 * 2);

interface Props {
  course: Course | null;
  /** A checkpoint picked: the map flies to it, in to `focusZoom`. */
  focus: { lat: number; lon: number } | null;
  focusZoom: number;
  /** The airport whose card is open: the map flies to it. */
  place: { lat: number; lon: number } | null;
  /** Its layers (lib/map/gl/layers), drawn once the map is made. */
  children: ReactNode;
}

/**
 * The WebGL map (MapLibre GL): the container, the camera and what moves
 * it -- a route's fit, a point picked, the sheet -- and the one tap the
 * layers share (glLayer). Every layer is a child: the chart, the
 * airspace, the route, own ship. Every map of the app is one: the planner's
 * (GlRouteMap) and the training page's (ChartMap).
 *
 * The map follows the sheet with MapLibre's own padding: the middle of
 * what the sheet leaves stays the middle, eased in the sheet's own time
 * from the sheet's turn (MapPanel's sheetturn), and a route is fitted to
 * what the sheet leaves, clear of the map's buttons.
 */
export default function GlMapShell({ course, focus, focusZoom, place, children }: Props) {
  // Once: a page is on a TV or not for its whole visit.
  const [onTv] = useState(() => tvPlatform() !== null);
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const insets = useContext(MapInsetsContext);
  const insetsRef = useRef(insets);
  // Where a point picked is being flown to (flyTo below), for the sheet
  // turning under the flight to aim it again rather than stop it.
  const flying = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const { data: chartOnly } = useQuery({ ...chartQuery, enabled: !course });
  const known = !!(course ?? chartOnly);

  // Made once the chart is known, at the pilot's last position or the
  // country, in the middle of what the panel leaves (padding), with an
  // empty layer for each slot the layers are put under.
  useEffect(() => {
    if (!box.current || !known) return;
    const last = useOwnShip.getState().lastFix;
    const [lat, lon] = last ? [last.lat, last.lon] : COUNTRY;
    const style: StyleSpecification = {
      version: 8, sources: {},
      layers: SLOTS.map(s => ({ id: slotId(s), type: "background", layout: { visibility: "none" } })),
      "font-faces": { Inter: [{ url: interUrl, "unicode-range": ["U+0000-00FF", "U+2000-206F"] }] },
    };
    const m = new maplibregl.Map({
      container: box.current, style, center: [lon, lat], zoom: glZoom(last ? OPEN_ZOOM : COUNTRY_ZOOM),
      minZoom: glZoom(3), attributionControl: false,
      // A chart is read north up, as Leaflet's is: no turn, no tilt.
      dragRotate: false, pitchWithRotate: false, touchPitch: false,
      // On a TV (lib/tv) the map takes the remote's arrows while focused.
      keyboard: onTv,
      // Symbols placed at once, not faded in over 0.3 s.
      fadeDuration: 0,
      renderWorldCopies: false,
    });
    // A remote has no pinch: the map's own + and - to reach with its arrows.
    if (onTv) m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.touchZoomRotate.disableRotation();
    m.setPadding(padOf(insetsRef.current));
    // A terminal sheet's tile where it has none is a 404, as Leaflet's
    // overlay leaves blank: not an error to say.
    m.on("error", () => {});
    // Whether it is moving, on its element, for the browser tests to wait
    // on a still map (e2e helpers' mapStill).
    const el = box.current;
    m.on("movestart", () => { el.dataset.moving = ""; });
    // And where it is: its middle, and where the point it opened on is on
    // the screen now (as Leaflet's pane's offset was), and the layers drawn
    // bottom to top.
    const anchor = m.getCenter();
    const say = () => {
      const c = m.getCenter(), p = m.project(anchor);
      el.dataset.center = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
      el.dataset.offset = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      // In the app's levels (Leaflet's: MapLibre's zoom plus one).
      el.dataset.zoom = (m.getZoom() + 1).toFixed(3);
    };
    say();
    m.on("moveend", () => { delete el.dataset.moving; say(); });
    m.on("idle", () => { el.dataset.layers = m.getStyle().layers.map(l => l.id).filter(id => !id.startsWith("slot-")).join(" "); });
    m.on("load", () => setMap(m));
    return () => { setMap(null); m.remove(); };
  }, [known, onTv]);

  // A remote has no pinch: its zoom keys zoom the map while it is focused
  // (TvMapKeys on the Leaflet map).
  useEffect(() => {
    if (!map || !onTv) return;
    const container = map.getCanvasContainer();
    const onKey = (event: KeyboardEvent) => {
      if (zoomInKey(event)) map.zoomIn();
      else if (zoomOutKey(event)) map.zoomOut();
      else return;
      event.preventDefault();
    };
    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [map, onTv]);
  // The one tap: the nearest thing's, in the taps' rank order.
  // Held in state, not refs: made once, read in the map's own handler.
  const [registry] = useState(() => ({ taps: new Set<GlTap>(), misses: new Set<(event: MapMouseEvent) => void>() }));
  const addTap = useCallback((tap: GlTap) => {
    registry.taps.add(tap);
    return () => { registry.taps.delete(tap); };
  }, [registry]);
  const addMiss = useCallback((miss: (event: MapMouseEvent) => void) => {
    registry.misses.add(miss);
    return () => { registry.misses.delete(miss); };
  }, [registry]);
  const [card, setCard] = useState<ReactNode | null>(null);
  const closeCard = useCallback(() => setCard(null), []);
  useEffect(() => {
    if (!map) return;
    const tap = (e: MapMouseEvent) => {
      for (const t of [...registry.taps].sort((a, b) => a.rank - b.rank)) {
        const layers = t.layers.filter(l => map.getLayer(l));
        if (!layers.length) continue;
        const r = t.reach;
        const hit = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers })[0];
        if (hit) {
          t.onTap(hit, e);
          return;
        }
      }
      // The chart itself: a card open is put away, as Leaflet's popup.
      setCard(null);
      for (const miss of registry.misses) miss(e);
    };
    map.on("click", tap);
    return () => { map.off("click", tap); };
  }, [map, registry]);
  const api = useMemo<GlMapApi | null>(() => (map ? { map, addTap, addMiss, openCard: setCard } : null), [map, addTap, addMiss]);

  // Fit to the route: once per route, clear of the panel and the buttons,
  // as MapShell's.
  const routeKey = course ? `${course.departure.ident}->${course.destination.ident}` : null;
  const fit = useCallback((animate: boolean) => {
    if (!map || !course) return;
    const line = course.course_line as [number, number][];
    const lats = line.map(p => p[0]), lons = line.map(p => p[1]);
    const pad = MIN_FIT_DEG / 2;
    const bounds: LngLatBoundsLike = [[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]];
    const ownShip = useOwnShip.getState();
    if (ownShip.enabled && ownShip.follow) ownShip.setFollow(false);
    // Over the map's own padding, the room the panel leaves (MapLibre adds
    // the two): a margin, and the map's buttons cleared.
    map.fitBounds(bounds, {
      padding: FIT_MARGIN,
      duration: animate ? flight() : 0,
    });
  }, [map, course]);
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!routeKey) { fitted.current = null; return; }
    if (!map || fitted.current === routeKey) return;
    fit(fitted.current !== null);
    fitted.current = routeKey;
  }, [map, routeKey, fit]);
  // The whole route again, from the location arrow (MyPositionButton).
  const routeAsked = useOwnShip(s => s.routeAsked);
  const routeAskedWas = useRef(routeAsked);
  useEffect(() => {
    if (routeAsked === routeAskedWas.current) return;
    routeAskedWas.current = routeAsked;
    useOwnShip.getState().setFollow(false);
    fit(true);
  }, [routeAsked, fit]);
  useEffect(() => {
    useOwnShip.setState({ routeDrawn: !!course && !!map });
    return () => { useOwnShip.setState({ routeDrawn: false, routeOutOfView: false }); };
  }, [course, map]);
  // Whether the route is out of sight at each rest, for the location
  // arrow to offer it back (MapShell's).
  useEffect(() => {
    if (!map || !course) return;
    const line = course.course_line as [number, number][];
    const check = () => {
      const { top, bottom, left } = insetsRef.current;
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const out = line.some(([lat, lon]) => {
        const p = map.project([lon, lat]);
        return p.x < left - 8 || p.x > w + 8 || p.y < top - 8 || p.y > h - bottom + 8;
      });
      if (useOwnShip.getState().routeOutOfView !== out) useOwnShip.setState({ routeOutOfView: out });
    };
    check();
    map.on("moveend", check);
    return () => { map.off("moveend", check); };
  }, [map, course]);

  // The map follows the sheet: MapLibre's padding is what the panel
  // covers, eased in the sheet's own time, so what was in the middle of
  // the room left stays in the middle -- from the sheet's turn as it sets
  // off (MapPanel's sheetturn), not only once the page hears it landed.
  const follow = useCallback((to: MapInsets) => {
    const was = insetsRef.current;
    insetsRef.current = to;
    if (!map || (was.top === to.top && was.bottom === to.bottom && was.left === to.left)) return;
    // A point still being flown to (a checkpoint tapped, whose card is what
    // turned the sheet): the flight aimed again with the new padding. A
    // second camera move stops MapLibre's first where it is, so an ease of
    // the padding alone left the map near the route's whole view, never
    // in to the point.
    const aim = flying.current;
    if (aim && map.isMoving()) {
      map.flyTo({ ...aim, padding: padOf(to), duration: prefersReducedMotion() ? 0 : SHEET_SECONDS * 1000 });
      return;
    }
    // Half way to all the way up and back the map stays put (MapShell).
    if (to.up !== was.up && to.out === was.out) {
      map.setPadding(padOf(to));
      return;
    }
    map.easeTo({ padding: padOf(to), duration: prefersReducedMotion() ? 0 : SHEET_SECONDS * 1000, easing: easeOut });
  }, [map]);
  useEffect(() => { follow(insets); }, [insets, follow]);
  useEffect(() => {
    if (!map) return;
    const doc = map.getContainer().ownerDocument;
    const turned = (event: Event) => {
      const going = (event as CustomEvent<SheetTurn | null>).detail?.insets;
      if (going) follow(going);
    };
    doc.addEventListener("sheetturn", turned, true);
    return () => doc.removeEventListener("sheetturn", turned, true);
  }, [map, follow]);

  // A point picked -- a checkpoint, an airport's card -- flown to, in
  // close enough, as FocusOn; own ship stops pulling the map back.
  const flyTo = useCallback((point: { lat: number; lon: number } | null, zoom: number) => {
    if (!map || !point) return;
    const ownShip = useOwnShip.getState();
    if (ownShip.enabled && ownShip.follow) ownShip.setFollow(false);
    flying.current = { center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), glZoom(zoom)) };
    map.flyTo({ ...flying.current, duration: flight() });
  }, [map]);
  // The flight's aim is let go once the map is at rest, or the pilot moves
  // it by hand. Not at the moveend a flight aimed again fires: MapLibre
  // stops the old one and starts the new in the same call, so the map is
  // moving again by the next microtask.
  useEffect(() => {
    if (!map) return;
    const rested = () => queueMicrotask(() => { if (!map.isMoving()) flying.current = null; });
    const byHand = (e: { originalEvent?: unknown }) => { if (e.originalEvent) flying.current = null; };
    map.on("moveend", rested);
    map.on("movestart", byHand);
    return () => { map.off("moveend", rested); map.off("movestart", byHand); };
  }, [map]);
  useEffect(() => { flyTo(focus, focusZoom); }, [flyTo, focus, focusZoom]);
  useEffect(() => { flyTo(place, PLACE_ZOOM); }, [flyTo, place]);

  return (
    <div className="relative h-full w-full">
      <div ref={box} className="h-full w-full bg-slate-100 dark:bg-slate-900" data-testid="gl-map" />
      {api && (
        <GlMapContext.Provider value={api}>
          {children}
          {/* Two fingers held on the chart measure it, on every map. */}
          <RulerGl />
        </GlMapContext.Provider>
      )}
      {card && (
        <SheetCard onClose={closeCard}>
          <CardCloseContext.Provider value={closeCard}>{card}</CardCloseContext.Provider>
        </SheetCard>
      )}
      <MapBanners map={map} />
      <MapControls />
    </div>
  );
}

/** What the panel covers, as MapLibre's padding: its middle is the map's. */
function padOf({ top, bottom, left }: MapInsets): PaddingOptions {
  return { top, bottom, left, right: 0 };
}

/** The sheet's own ease-out (MapPanel: the owner's "no spring"). */
const easeOut = (t: number) => 1 - (1 - t) ** 3;
