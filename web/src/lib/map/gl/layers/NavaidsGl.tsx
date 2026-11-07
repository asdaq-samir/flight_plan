import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SymbolLayerSpecification } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import type { FixPin, VorPin } from "../../../api/types";
import { usePreferences } from "../../../preferences";
import { BLUE } from "../../../useAirspace";
import { WAYPOINT_MAGENTA } from "../../chartColors";
import { FixCard, VorCard, navaidsQuery } from "../../NavaidCards";
import { usePointActions } from "../../pointActions";
import { WaypointCard, waypointsQuery, type Waypoint } from "../../WaypointCard";
import { addSvgImages, useGlData, useGlLayer, useGlMap, useGlTap } from "../glLayer";
import { useGlView } from "../useGlView";
import { useGlProbe } from "../useGlProbe";
import { GL_FONT, TAP } from "./common";

/** The chart's own ink for a fix (NavaidCanvas' FIX_INK). */
const FIX_INK = "#1c1a17";

/** The marks' pictures, NavaidCanvas' own: the VOR's hexagon, a fix's
 *  triangle, a VFR waypoint's magenta one (FAA Aeronautical Chart User's
 *  Guide, Radio Aids to Navigation; VFR waypoints), and the VOR's blue
 *  ident box, stretched to its ident. */
const PICTURES: [string, () => string, { inset: number }?][] = [
  ["nav|vor", () => `<svg width="16" height="16" viewBox="0 0 16 16"><polygon points="15,8 11.5,14.06 4.5,14.06 1,8 4.5,1.94 11.5,1.94" fill="#fff" stroke="${BLUE}" stroke-width="2"/><circle cx="8" cy="8" r="1.6" fill="${BLUE}"/></svg>`],
  ["nav|fix", () => `<svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,1 9.4,8.8 0.6,8.8" fill="#fff" stroke="${FIX_INK}" stroke-width="1.2" stroke-linejoin="round"/></svg>`],
  ["nav|vfr", () => `<svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,1 9.4,8.8 0.6,8.8" fill="#fff" stroke="${WAYPOINT_MAGENTA}" stroke-width="1.6" stroke-linejoin="round"/></svg>`],
  ["nav|tag", () => `<svg width="12" height="12" viewBox="0 0 12 12"><rect width="12" height="12" rx="3" fill="${BLUE}"/></svg>`, { inset: 4 }],
];

const NAV = "navaids";
const VFR = "vfr-waypoints";
const empty = () => ({ type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } });

/** The mark, its ident beside it on whichever side is clear: MapLibre's
 *  variable anchor and collision, where declutter.ts picked a VOR's tag
 *  side by hand. A VOR's ident on its blue tag, a fix's and a waypoint's
 *  dark or magenta on a white halo. */
function marks(id: string, source: string): SymbolLayerSpecification[] {
  return [
    {
      id, type: "symbol", source,
      layout: { "icon-image": ["concat", "nav|", ["get", "kind"]], "icon-allow-overlap": true, "icon-ignore-placement": true },
    },
    {
      id: `${id}-idents`, type: "symbol", source,
      layout: {
        "text-field": ["get", "ident"], "text-font": GL_FONT, "text-size": 11,
        "text-variable-anchor": ["left", "right"], "text-radial-offset": 1.1, "text-justify": "auto",
        "icon-image": ["case", ["==", ["get", "kind"], "vor"], "nav|tag", ""],
        "icon-text-fit": "both", "icon-text-fit-padding": [1, 4, 1, 4],
      },
      paint: {
        "text-color": ["match", ["get", "kind"], "vor", "#ffffff", "vfr", WAYPOINT_MAGENTA, FIX_INK],
        "text-halo-color": ["match", ["get", "kind"], "vor", "rgba(0,0,0,0)", "#ffffff"],
        "text-halo-width": 1.5,
      },
    },
  ];
}

const NONE_VORS: VorPin[] = [];
const NONE_FIXES: FixPin[] = [];
const FIX_ZOOM = 10;

function point(kind: string, p: { ident: string; lat: number; lon: number }, key: string): GeoJSON.Feature {
  return { type: "Feature", properties: { kind, ident: p.ident, key }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } };
}

function usePictures(): boolean {
  const { map } = useGlMap();
  const [ready, setReady] = useState(false);
  useEffect(() => { void addSvgImages(map, PICTURES).then(() => setReady(true)); }, [map]);
  return ready;
}

/**
 * The VORs and, closer in, the low enroute chart's fixes, as NavaidsLayer
 * draws them on the Leaflet map: the same question (navaidsQuery), the
 * same zooms and the settings' VORs and Fixes; a tap a station's card
 * (VorCard, FixCard).
 */
export function NavaidsGl() {
  const show = usePreferences(s => s.navaids);
  const { box, level } = useGlView();
  const query = navaidsQuery(box, level, show);
  const { data } = useQuery({ ...query, placeholderData: keepPreviousData });
  const vors = query.enabled ? data?.vors ?? NONE_VORS : NONE_VORS;
  const fixes = query.enabled && level >= FIX_ZOOM ? data?.fixes ?? NONE_FIXES : NONE_FIXES;
  useEffect(() => { usePointActions.setState({ stations: show ? vors : [] }); }, [vors, show]);
  const ready = usePictures();
  useGlLayer("marks", { [NAV]: empty() }, marks(NAV, NAV));
  const features = useMemo<GeoJSON.FeatureCollection | null>(() => (ready ? {
    type: "FeatureCollection",
    features: [...fixes.map(f => point("fix", f, `fix-${f.ident}`)), ...vors.map(v => point("vor", v, `${v.ident}-${v.lat}`))],
  } : null), [ready, vors, fixes]);
  useGlData(NAV, features);
  useGlProbe("navaid-marks", [NAV], f => ({ ident: f.properties.ident, kind: f.properties.kind }));
  const { openCard } = useGlMap();
  useGlTap([NAV], TAP.mark, TAP.rank.mark + 1, feature => {
    const key = String(feature.properties.key);
    const vor = vors.find(v => `${v.ident}-${v.lat}` === key);
    const fix = fixes.find(f => `fix-${f.ident}` === key);
    if (vor) openCard(<VorCard key={key} vor={vor} />);
    else if (fix) openCard(<FixCard key={key} fix={fix} vors={vors} />);
  });
  return null;
}

/** The VFR waypoints from zoom 10, as WaypointsLayer: magenta triangles,
 *  a tap the waypoint's card; the route's own left to it (`exclude`). */
export function WaypointsGl({ exclude }: { exclude: Set<string> }) {
  const { box, level } = useGlView();
  const query = waypointsQuery(box, level);
  const { data } = useQuery({ ...query, placeholderData: keepPreviousData });
  const shown = useMemo(() => (query.enabled ? (data ?? []).filter(w => !exclude.has(w.ident)) : []), [query.enabled, data, exclude]);
  const ready = usePictures();
  useGlLayer("marks", { [VFR]: empty() }, marks(VFR, VFR));
  const features = useMemo<GeoJSON.FeatureCollection | null>(() => (ready ? {
    type: "FeatureCollection", features: shown.map(w => point("vfr", w, `vfr-${w.ident}`)),
  } : null), [ready, shown]);
  useGlData(VFR, features);
  useGlProbe("navaid-marks", [VFR], f => ({ ident: f.properties.ident, kind: "vfr" }));
  const { openCard } = useGlMap();
  useGlTap([VFR], TAP.mark, TAP.rank.mark + 1, feature => {
    const w: Waypoint | undefined = shown.find(p => p.ident === feature.properties.ident);
    if (w) openCard(<WaypointCard key={w.ident} waypoint={w} />);
  });
  return null;
}
