import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SymbolLayerSpecification, CircleLayerSpecification } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../api/client";
import type { AirportPin } from "../../../api/types";
import { usePreferences } from "../../../preferences";
import { airportMarkSvg } from "../../airportMark";
import { airportsQuery } from "../../airportsQuery";
import { colourOf } from "../../flightCategory";
import { addSvgImages, useGlData, useGlLayer, useGlMap, useGlMiss, useGlTap } from "../glLayer";
import { glZoom } from "../glStyle";
import { useGlView } from "../useGlView";
import { useGlProbe } from "../useGlProbe";
import { GL_FONT, TAP } from "./common";

/** AirportsLayer's zooms, Leaflet's: every field from 8, the reporting
 *  ones from 4, each kind from its own (SHOWN_FROM), a field with no
 *  report wearing its mark from 10, a private one from 11. */
const FROM_ZOOM = 8;
const FARTHEST_ZOOM = 4;
const REPORTING_FROM_ZOOM = 7;
const NO_REPORT_FROM_ZOOM = 10;
const PRIVATE_FROM_ZOOM = 11;
const SHOWN_FROM: Record<AirportPin["kind"], number> = { large: 6, medium: 8, small: 10, other: 12 };
const shownFrom = (a: AirportPin) =>
  Math.min(SHOWN_FROM[a.kind], a.airspace_class === "B" ? FARTHEST_ZOOM : a.airspace_class === "C" ? 6 : a.airspace_class === "D" ? FROM_ZOOM : Infinity);
/** Which field keeps its place where two would overlap: the primary field
 *  of a Class B, C or D first, then the bigger kind -- MapLibre's
 *  collision drops the later (symbol-sort-key), where declutter.ts and
 *  the 80 px rule of AirportsLayer did it by hand. */
const KIND_RANK: Record<AirportPin["kind"], number> = { large: 0, medium: 1, small: 2, other: 3 };
const PRIMARY_RANK: Record<"B" | "C" | "D", number> = { B: 0, C: 1, D: 2 };
const rankOf = (a: AirportPin) => (a.primary_of ? PRIMARY_RANK[a.primary_of] : 3) * 10 + KIND_RANK[a.kind];

const SOURCE = "airports";
const SELECTED = "airport-selected";
const empty = () => ({ type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } });
const SOURCES = { [SOURCE]: empty(), [SELECTED]: empty() };

const markId = (space: string | null, weather: string, use: string | null) => `apt|${space ?? ""}|${weather}|${use ?? ""}`;

const MARKS: SymbolLayerSpecification = {
  id: "airports", type: "symbol", source: SOURCE,
  layout: {
    "icon-image": ["get", "icon"],
    "icon-allow-overlap": false,
    // Out at a few states, a mark's room is AirportsLayer's 80 px apart;
    // closer in, its own: every field at a field's own scale.
    "icon-padding": ["step", ["zoom"], 27, glZoom(REPORTING_FROM_ZOOM), 2],
    "symbol-sort-key": ["get", "rank"],
    "text-field": ["get", "ident"],
    "text-font": GL_FONT,
    "text-size": 11,
    "text-anchor": "left",
    "text-offset": [1.3, 0],
    // The ident gives way, the mark stays: a busy area keeps its fields.
    "text-optional": true,
    "text-padding": 1,
  },
  paint: { "text-color": "#1c1a17", "text-halo-color": "#ffffff", "text-halo-width": 1.75 },
};
/** The ring round the field whose card is open (icons.ts selectionIcon). */
const RING: CircleLayerSpecification = {
  id: "airport-selected", type: "circle", source: SELECTED,
  paint: { "circle-radius": 20, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ff3b00", "circle-stroke-width": 3 },
};

/**
 * The chart's airports, as AirportsLayer draws them on the Leaflet map:
 * the same questions for the view (airportsQuery) and along the route,
 * the same zooms and filters (military, private), each field's mark in
 * its airspace's ring with its weather in the middle (airportMark's own
 * SVG), its ident beside it -- as one symbol layer, kept apart by
 * MapLibre's collision. A tap within a finger's reach opens its card.
 */
export function AirportsGl({ selected, onSelect, others, route }: {
  selected: { ident: string; lat: number; lon: number } | null;
  onSelect: (ident: string | null) => void;
  /** The fields wearing a chip of their own already: the route's. */
  others: { ident: string; lat: number; lon: number }[];
  route: { south: number; west: number; north: number; east: number } | null;
}) {
  const { map } = useGlMap();
  const showMilitary = usePreferences(s => s.military);
  const showPrivate = usePreferences(s => s.privateFields);
  const { box, level } = useGlView();
  const { data: inView } = useQuery({ ...airportsQuery(box, level), refetchInterval: 10 * 60_000, placeholderData: keepPreviousData });
  const routeKey = route ? `${route.south},${route.west},${route.north},${route.east}` : null;
  const { data: alongRoute } = useQuery({
    queryKey: ["airportsReporting", routeKey],
    queryFn: () => api.airportsInView({ ...route!, limit: 1000, reporting: true }),
    enabled: !!route, staleTime: 10 * 60_000, refetchInterval: 10 * 60_000, meta: { silent: true },
  });
  const exclude = useMemo(() => new Set(others.map(a => a.ident)), [others]);
  const shown = useMemo(() => {
    if (level < FARTHEST_ZOOM) return [];
    const byIdent = new Map<string, AirportPin>();
    for (const list of [alongRoute, inView]) for (const a of list ?? []) byIdent.set(a.ident, a);
    const near = level >= FROM_ZOOM;
    return [...byIdent.values()].filter(a => !exclude.has(a.ident) && (level >= shownFrom(a) || a.ident === selected?.ident)
      && (near || a.flight_category) && (showMilitary || a.military !== "military") && (showPrivate || !a.private));
  }, [alongRoute, inView, exclude, level, selected, showMilitary, showPrivate]);

  useGlLayer("marks", SOURCES, [RING, MARKS]);
  // The pictures first, then the features that wear them.
  const [features, setFeatures] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    let live = true;
    const marks = shown.filter(a => !!a.flight_category || level >= (a.private ? PRIVATE_FROM_ZOOM : NO_REPORT_FROM_ZOOM));
    const looks = new Map<string, () => string>();
    const feats: GeoJSON.Feature[] = marks.map(a => {
      const weather = colourOf(a.flight_category);
      const use = a.military === "military" ? "military" : a.private ? "private" : null;
      const icon = markId(a.airspace_class ?? null, weather, use);
      looks.set(icon, () => airportMarkSvg(a.airspace_class ?? null, weather, use, ""));
      return { type: "Feature", properties: { ident: a.ident, icon, rank: rankOf(a), space: a.airspace_class ?? "", use: use ?? "", weather }, geometry: { type: "Point", coordinates: [a.lon, a.lat] } };
    });
    void addSvgImages(map, looks).then(() => { if (live) setFeatures({ type: "FeatureCollection", features: feats }); });
    return () => { live = false; };
  }, [map, shown, level]);
  useGlData(SOURCE, features);
  const ring = useMemo<GeoJSON.FeatureCollection | null>(() => (selected
    ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [selected.lon, selected.lat] } }] }
    : null), [selected]);
  useGlData(SELECTED, ring);
  useGlProbe("selected-airport", ["airport-selected"], () => ({ ring: true }));
  // The specs' view of the marks drawn (AirportCanvas' data-airport-marks).
  useGlProbe("airport-marks", ["airports"], f => ({ ident: f.properties.ident, chip: true, space: f.properties.space, use: f.properties.use, weather: f.properties.weather }));
  useGlTap(["airports"], TAP.mark, TAP.rank.mark, feature => onSelect(String(feature.properties.ident)));
  // The chart itself tapped: the airport's card put away, as on Leaflet.
  useGlMiss(() => onSelect(null));
  return null;
}
