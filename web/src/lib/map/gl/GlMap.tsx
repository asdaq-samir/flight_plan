import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, LngLatBoundsLike, MapMouseEvent, PaddingOptions, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The worker MapLibre parses its sources in: a file of its own, which a
// bundle cannot find beside maplibre-gl.mjs as the library looks for it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
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
import type { AirspaceVolume, Course } from "../../api/types";
import { chartQuery, queryClient } from "../../queryClient";
import { usePreferences } from "../../preferences";
import { prefersReducedMotion } from "../../motion";
import { useSunlight } from "../../sunlight";
import { AirspaceCardBody, airspaceQuery } from "../AirspaceLayer";
import { BUTTONS_CLEAR } from "../clear";
import { MAP_BLUE, courseColour } from "../chartColors";
import { COUNTRY_ZOOM, OPEN_ZOOM, useOwnShip } from "../ownShip";
import { ownShipSvg } from "../ownShipLook";
import { levelOf } from "../useView";
import { aheadOf } from "../view";
import {
  AIRSPACE_LINE_LAYERS, AIRSPACE_SOURCE, CHECKPOINT_SOURCE, ENDPOINT_SOURCE, ROUTE_SOURCE,
  airspaceFeatures, airspaceLayers, chartPaint, chartStyle, glZoom, leafletZoomOf, pointFeatures, routeFeature, routeLayers,
  type RoutePoint,
} from "./glStyle";

maplibregl.setWorkerUrl(workerUrl);

/** The map's words, in the page's Inter. */
const FONT = ["Inter"];
const COUNTRY: [number, number] = [39.5, -98.35];
/** A tap's reach round a mark, px each side: a 44 pt target. */
const MARK_PX = 22;
/** And round an airspace line: AirspaceLayer's TAP_PX. */
const LINE_PX = 10;
/** As MapShell's: the least the map is fitted to round a route, ~10 nm. */
const MIN_FIT_DEG = 0.08;
/** RouteMap's: how close in an airport's card brings the map. */
const PLACE_ZOOM = 9;
/** OwnShipLayer's: the location arrow's close-in. */
const LOCAL_ZOOM = 9;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export interface GlCheckpoint {
  key: string;
  lat: number;
  lon: number;
  number: number;
  colour: string;
  card: ReactNode;
  select: () => void;
}

export interface GlEndpoint {
  ident: string;
  lat: number;
  lon: number;
  colour: string;
  select: () => void;
}

interface Props {
  course: Course | null;
  checkpoints: GlCheckpoint[];
  endpoints: GlEndpoint[];
  /** A checkpoint or the airport whose card is open: the map flies to it. */
  focus: { lat: number; lon: number } | null;
  focusZoom: number;
  place: { lat: number; lon: number } | null;
  /** The map holds a point: the sheet's turns slide it, never refit. */
  held: boolean;
}

type Picked = { kind: "airspace"; volume: AirspaceVolume } | { kind: "checkpoint"; key: string };

/**
 * The map spike's map (lib/map/gl): the FAA chart, the airspace, the
 * route with its checkpoints and own ship in one MapLibre GL map, one
 * WebGL canvas the GPU draws every frame of a pinch or a pan, where
 * Leaflet moves images and CSS-scales its overlays' canvases and draws
 * them again at the gesture's end. What it does not draw yet -- the
 * airports' marks, the VORs, the weather, the TFRs and the rest -- the
 * pull request lists, with what each would take.
 *
 * The map follows the sheet with MapLibre's own padding: the middle of
 * what the sheet leaves stays the middle, eased in the sheet's time
 * (SHEET_SECONDS), from the sheet's turn (MapPanel's sheetturn) as
 * MapShell's does; a route is fitted to what the sheet leaves.
 */
export default function GlMap({ course, checkpoints, endpoints, focus, focusZoom, place, held }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const insets = useContext(MapInsetsContext);
  const insetsRef = useRef(insets);
  const { data: chartOnly } = useQuery({ ...chartQuery, enabled: !course });
  const chart = course ?? chartOnly ?? null;
  const base = usePreferences(s => s.base);
  const pinned = usePreferences(s => s.tac);
  const chartNight = usePreferences(s => s.chartNight);
  const showAirspace = usePreferences(s => s.airspace);
  const look = usePreferences(s => s.ownShipLook);
  const sunlight = useSunlight();
  const dark = useDarkTheme();
  const night = dark && chartNight === "dimmed";
  useEffect(() => { document.documentElement.dataset.chartNight = chartNight; }, [chartNight]);

  // Made once the chart is known, at the pilot's last position or the
  // country, in the middle of what the panel leaves (padding).
  const madeFor = useRef(false);
  useEffect(() => {
    if (!box.current || !chart || madeFor.current) return;
    madeFor.current = true;
    const last = useOwnShip.getState().lastFix;
    const [lat, lon] = last ? [last.lat, last.lon] : COUNTRY;
    const style: StyleSpecification = {
      version: 8, sources: {}, layers: [],
      "font-faces": { Inter: [{ url: interUrl, "unicode-range": ["U+0000-00FF", "U+2000-206F"] }] },
    };
    const m = new maplibregl.Map({
      container: box.current, style, center: [lon, lat], zoom: glZoom(last ? OPEN_ZOOM : COUNTRY_ZOOM),
      minZoom: glZoom(3), attributionControl: false,
      // A chart is read north up, as Leaflet's is: no turn, no tilt.
      dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false,
      // Symbols placed at once, not faded in over 0.3 s.
      fadeDuration: 0,
      renderWorldCopies: false,
    });
    m.touchZoomRotate.disableRotation();
    m.setPadding(padOf(insetsRef.current));
    // A terminal sheet's tile where it has none is a 404, as Leaflet's
    // overlay leaves blank: not an error to say.
    m.on("error", () => {});
    m.on("load", () => setMap(m));
    return () => { madeFor.current = false; setMap(null); m.remove(); };
  }, [chart]);

  // The chart, again as the base, the pin or the course's cycle changes.
  const chartSpec = useMemo(() => (chart ? chartStyle(chart, base, pinned, window.location.origin) : null), [chart, base, pinned]);
  useEffect(() => {
    if (!map || !chartSpec) return;
    for (const id of ["chart-terminal", "chart", "chart-under"]) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    for (const [id, source] of Object.entries(chartSpec.sources)) map.addSource(id, source);
    // Under the overlays, whatever is drawn already.
    const under = map.getStyle().layers[0]?.id;
    for (const layer of chartSpec.layers) map.addLayer(layer, under);
    map.setMaxZoom(chartSpec.maxZoom);
    // The frame the chart's first tile is drawn in, for the speed
    // measurements (a canvas is no Largest Contentful Paint candidate, as
    // Leaflet's tile images are): `chart-drawn`, once a page.
    const drawn = (e: { sourceId?: string; tile?: unknown }) => {
      if (e.sourceId !== "chart" || !e.tile) return;
      map.off("sourcedata", drawn);
      if (!performance.getEntriesByName("chart-drawn").length) map.once("render", () => performance.mark("chart-drawn"));
    };
    map.on("sourcedata", drawn);
    return () => { map.off("sourcedata", drawn); };
  }, [map, chartSpec]);
  useEffect(() => {
    if (!map) return;
    const paint = chartPaint(night, sunlight)!;
    for (const id of ["chart-under", "chart", "chart-terminal"]) {
      if (!map.getLayer(id)) continue;
      for (const [k, v] of Object.entries(paint)) map.setPaintProperty(id, k as Parameters<typeof map.setPaintProperty>[1], v);
    }
  }, [map, night, sunlight, chartSpec]);

  // The overlays' sources and layers, once, over the chart.
  useEffect(() => {
    if (!map) return;
    map.addSource(AIRSPACE_SOURCE, { type: "geojson", data: EMPTY, tolerance: 0.5 });
    for (const layer of airspaceLayers(FONT)) map.addLayer(layer);
    map.addSource(ROUTE_SOURCE, { type: "geojson", data: EMPTY });
    map.addSource(CHECKPOINT_SOURCE, { type: "geojson", data: EMPTY });
    map.addSource(ENDPOINT_SOURCE, { type: "geojson", data: EMPTY });
    for (const layer of routeLayers(FONT, courseColour())) map.addLayer(layer);
  }, [map]);

  // The airspace for the view and a screen round it, the same question and
  // the same cache as AirspaceLayer's (airspaceQuery), at each rest.
  const volumes = useRef(new Map<string, AirspaceVolume>());
  useEffect(() => {
    if (!map) return;
    let asked = "";
    const ask = () => {
      const zoom = levelOf(leafletZoomOf(map.getZoom()));
      const query = airspaceQuery(aheadOf(map.getBounds()), zoom, showAirspace);
      const source = map.getSource<GeoJSONSource>(AIRSPACE_SOURCE);
      if (!query.enabled) {
        source?.setData(EMPTY);
        asked = "";
        return;
      }
      const key = JSON.stringify(query.queryKey);
      if (key === asked) return;
      asked = key;
      void queryClient.fetchQuery({ queryKey: query.queryKey, queryFn: query.queryFn, staleTime: query.staleTime, meta: query.meta }).then(data => {
        if (asked !== key) return;
        volumes.current = new Map(data.map(v => [v.id, v]));
        source?.setData(airspaceFeatures(data));
      }, () => {});
    };
    ask();
    map.on("moveend", ask);
    return () => { map.off("moveend", ask); };
  }, [map, showAirspace]);

  // The route, its checkpoints and its airports.
  useEffect(() => {
    if (!map) return;
    map.getSource<GeoJSONSource>(ROUTE_SOURCE)?.setData(course ? routeFeature(course.course_line as [number, number][]) : EMPTY);
  }, [map, course]);
  useEffect(() => {
    if (!map) return;
    const points: RoutePoint[] = checkpoints.map(c => ({ key: c.key, lat: c.lat, lon: c.lon, label: String(c.number), colour: c.colour }));
    map.getSource<GeoJSONSource>(CHECKPOINT_SOURCE)?.setData(pointFeatures(points));
  }, [map, checkpoints]);
  useEffect(() => {
    if (!map) return;
    const points: RoutePoint[] = endpoints.map(e => ({ key: e.ident, lat: e.lat, lon: e.lon, label: e.ident, colour: e.colour }));
    map.getSource<GeoJSONSource>(ENDPOINT_SOURCE)?.setData(pointFeatures(points));
  }, [map, endpoints]);

  // A tap: the route's airport, else a checkpoint, else an airspace line,
  // each within a finger's reach -- the nearest kind first, as the Leaflet
  // map gives a field's mark the tap before a ring under it.
  const [picked, setPicked] = useState<Picked | null>(null);
  const tapRef = useRef({ checkpoints, endpoints });
  useEffect(() => { tapRef.current = { checkpoints, endpoints }; }, [checkpoints, endpoints]);
  useEffect(() => {
    if (!map) return;
    const near = (e: MapMouseEvent, px: number, layers: string[]) => map.queryRenderedFeatures(
      [[e.point.x - px, e.point.y - px], [e.point.x + px, e.point.y + px]], { layers: layers.filter(l => map.getLayer(l)) },
    );
    const tap = (e: MapMouseEvent) => {
      const field = near(e, MARK_PX, ["endpoints"])[0];
      if (field) {
        tapRef.current.endpoints.find(p => p.ident === field.properties.key)?.select();
        setPicked(null);
        return;
      }
      const dot = near(e, MARK_PX, ["checkpoints"])[0];
      if (dot) {
        const key = String(dot.properties.key);
        tapRef.current.checkpoints.find(c => c.key === key)?.select();
        setPicked({ kind: "checkpoint", key });
        return;
      }
      const line = near(e, LINE_PX, AIRSPACE_LINE_LAYERS)[0];
      const volume = line && volumes.current.get(String(line.properties.id));
      setPicked(volume ? { kind: "airspace", volume } : null);
    };
    map.on("click", tap);
    return () => { map.off("click", tap); };
  }, [map]);
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
    const { top, bottom, left } = insetsRef.current;
    map.fitBounds(bounds, {
      padding: { top: 30 + top, bottom: 30 + bottom, left: 30 + BUTTONS_CLEAR + left, right: 30 + BUTTONS_CLEAR },
      duration: animate && !prefersReducedMotion() ? SHEET_SECONDS * 1000 * 2 : 0,
    });
  }, [map, course]);
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!routeKey) { fitted.current = null; return; }
    if (!map || fitted.current === routeKey) return;
    fit(fitted.current !== null);
    fitted.current = routeKey;
  }, [map, routeKey, fit]);
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
  // the room left stays in the middle -- from the sheet's turn, as it sets
  // off (MapPanel's sheetturn), not only once the page hears it landed.
  const follow = useCallback((to: MapInsets) => {
    const was = insetsRef.current;
    insetsRef.current = to;
    if (!map || (was.top === to.top && was.bottom === to.bottom && was.left === to.left)) return;
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

  // A checkpoint or an airport picked: flown to, in close enough, as
  // FocusOn.
  useEffect(() => {
    if (!map || !focus) return;
    const ownShip = useOwnShip.getState();
    if (ownShip.enabled && ownShip.follow) ownShip.setFollow(false);
    map.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), glZoom(focusZoom)), duration: prefersReducedMotion() ? 0 : SHEET_SECONDS * 1000 * 2 });
  }, [map, focus, focusZoom]);
  useEffect(() => {
    if (!map || !place) return;
    map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), glZoom(PLACE_ZOOM)), duration: prefersReducedMotion() ? 0 : SHEET_SECONDS * 1000 * 2 });
  }, [map, place]);

  useOwnShipMarker(map, look);

  const card = picked?.kind === "airspace"
    ? <AirspaceCardBody volume={picked.volume} close={() => setPicked(null)} />
    : picked?.kind === "checkpoint" ? checkpoints.find(c => c.key === picked.key)?.card : null;
  return (
    <div className="relative h-full w-full">
      <div ref={box} className="h-full w-full bg-slate-100 dark:bg-slate-900" data-testid="gl-map" data-held={held || undefined} />
      {card && <SheetCard onClose={() => setPicked(null)}>{card}</SheetCard>}
      <MapBanners map={null} />
      <MapControls />
    </div>
  );
}

/** What the panel covers, as MapLibre's padding: its middle is the map's. */
function padOf({ top, bottom, left }: MapInsets): PaddingOptions {
  return { top, bottom, left, right: 0 };
}

/** The sheet's own ease-out (MapPanel, the owner's "no spring"). */
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Whether the page is in the dark theme (next-themes' class on <html>). */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const html = document.documentElement;
    const observer = new MutationObserver(() => setDark(html.classList.contains("dark")));
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * Own ship as a MapLibre marker: an element the map places in the same
 * frame it draws the chart, so it stays on its point through a pinch, at
 * the GPS's heading on the map (rotationAlignment). Followed while the
 * location arrow says so; a drag ends that, as on the Leaflet map; grey
 * at its last place when own ship is turned off.
 */
function useOwnShipMarker(map: maplibregl.Map | null, look: ReturnType<typeof usePreferences.getState>["ownShipLook"]) {
  const enabled = useOwnShip(s => s.enabled);
  const fix = useOwnShip(s => s.fix);
  const follow = useOwnShip(s => s.follow);
  const recentred = useOwnShip(s => s.recentred);
  const recentreZoom = useOwnShip(s => s.recentreZoom);
  const marker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    if (!map) return;
    const el = document.createElement("div");
    el.dataset.testid = "gl-own-ship";
    el.style.pointerEvents = "none";
    marker.current = new maplibregl.Marker({ element: el, rotationAlignment: "map" });
    const stop = (e: { originalEvent?: Event }) => {
      if (e.originalEvent && useOwnShip.getState().follow) useOwnShip.getState().setFollow(false);
    };
    map.on("dragstart", stop);
    return () => { map.off("dragstart", stop); marker.current?.remove(); marker.current = null; };
  }, [map]);
  useEffect(() => {
    const m = marker.current;
    if (!map || !m) return;
    if (!fix) { m.remove(); return; }
    m.getElement().innerHTML = ownShipSvg(look, enabled ? MAP_BLUE : "#8e8e93", 32);
    m.setLngLat([fix.lon, fix.lat]).setRotation(fix.headingDeg ?? 0).addTo(map);
  }, [map, fix, enabled, look]);
  const flown = useRef(recentred);
  useEffect(() => {
    if (!map || !fix || !enabled) return;
    if (flown.current !== recentred) {
      flown.current = recentred;
      const zoom = recentreZoom !== null ? glZoom(recentreZoom) : Math.max(map.getZoom(), glZoom(LOCAL_ZOOM));
      map.flyTo({ center: [fix.lon, fix.lat], zoom, duration: prefersReducedMotion() ? 0 : SHEET_SECONDS * 1000 * 2 });
      return;
    }
    if (follow) map.easeTo({ center: [fix.lon, fix.lat], duration: prefersReducedMotion() ? 0 : 500 });
  }, [map, fix, enabled, follow, recentred, recentreZoom]);
}
