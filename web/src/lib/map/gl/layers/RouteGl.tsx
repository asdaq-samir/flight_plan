import type { CircleLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { useMemo, type ReactNode } from "react";
import type { Course } from "../../../api/types";
import type { AirspaceClass } from "../../../preferences";
import { courseColour } from "../../chartColors";
import { airportMarkIcon, fixMarkIcon } from "../../icons";
import { useGlData, useGlLayer, useGlMap, useGlTap } from "../glLayer";
import { CHECKPOINT_SOURCE, ROUTE_SOURCE, glZoom, pointFeatures, routeFeature, routeLayers } from "../glStyle";
import { useGlProbe } from "../useGlProbe";
import { GL_FONT, TAP } from "./common";
import { useGlMarks, type GlMark } from "./MarksGl";

export interface GlCheckpoint {
  key: string;
  lat: number;
  lon: number;
  number: number;
  /** Its name as its label shows it (RouteMap's labelOf). */
  name: string;
  colour: string;
  card: ReactNode;
  select: () => void;
}

export interface GlCandidate {
  key: string;
  lat: number;
  lon: number;
  colour: string;
  card: ReactNode;
}

export interface GlEndpoint {
  ident: string;
  lat: number;
  lon: number;
  colour: string;
  /** Its airspace's class (the mark's ring); a waypoint flown through has none. */
  space: AirspaceClass | null;
  fix: boolean;
  select: () => void;
}

/** RouteMap's NAME_ZOOM: every checkpoint in sight named from 10 (Leaflet's). */
const NAME_ZOOM = 10;

const empty = () => ({ type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } });
const CANDIDATES = "candidates";
const LINE_SOURCES = { [ROUTE_SOURCE]: empty() };
const MARK_SOURCES = { [CHECKPOINT_SOURCE]: empty(), [CANDIDATES]: empty() };

/** Every point the model scored, small and dim, under the chosen. */
const CANDIDATE_DOTS: CircleLayerSpecification = {
  id: "candidates", type: "circle", source: CANDIDATES,
  paint: { "circle-radius": 4, "circle-color": ["get", "colour"], "circle-opacity": 0.5, "circle-stroke-color": "#5b6b76", "circle-stroke-width": 1, "circle-stroke-opacity": 0.65 },
};
/** A checkpoint's name beside its dot, on whichever side is clear, from
 *  NAME_ZOOM: MapLibre's collision, where useLabelled placed each by hand. */
const NAMES: SymbolLayerSpecification = {
  id: "checkpoint-names", type: "symbol", source: CHECKPOINT_SOURCE, minzoom: glZoom(NAME_ZOOM),
  layout: {
    "text-field": ["get", "name"], "text-font": GL_FONT, "text-size": 12,
    "text-variable-anchor": ["left", "right"], "text-radial-offset": 1.3, "text-justify": "auto",
    "symbol-sort-key": ["get", "number"],
  },
  paint: { "text-color": "#1c1a17", "text-halo-color": "#ffffff", "text-halo-width": 2 },
};

/**
 * The route: the course line (CourseLine's white casing and magenta
 * core), its checkpoints numbered in flight order and named closer in (a
 * tap the checkpoint's card, the map flying in to it), the points they
 * were chosen from, and its departure, stops and destination as every
 * airport's mark on the chart, in its weather (a tap its card).
 */
export function RouteGl({ course, checkpoints, candidates, endpoints }: {
  course: Course | null; checkpoints: GlCheckpoint[]; candidates: GlCandidate[]; endpoints: GlEndpoint[];
}) {
  const layers = useMemo(() => routeLayers(GL_FONT, courseColour()), []);
  // The line in the route's slot, the marks over every mark on the chart.
  useGlLayer("route", LINE_SOURCES, layers.filter(l => "source" in l && l.source === ROUTE_SOURCE));
  useGlLayer("top", MARK_SOURCES, [CANDIDATE_DOTS, ...layers.filter(l => "source" in l && l.source === CHECKPOINT_SOURCE), NAMES]);
  const line = useMemo(() => (course ? routeFeature(course.course_line as [number, number][]) : null), [course]);
  useGlData(ROUTE_SOURCE, line);
  const dots = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: checkpoints.map(c => ({
      type: "Feature", properties: { key: c.key, label: String(c.number), number: c.number, name: c.name, colour: c.colour },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  }), [checkpoints]);
  useGlData(CHECKPOINT_SOURCE, dots);
  const others = useMemo(() => pointFeatures(candidates.map(c => ({ key: c.key, lat: c.lat, lon: c.lon, label: "", colour: c.colour }))), [candidates]);
  useGlData(CANDIDATES, others);
  const fields = useMemo<GlMark[]>(() => endpoints.map(e => ({
    key: e.ident, lat: e.lat, lon: e.lon, onTap: e.select,
    icon: e.fix ? fixMarkIcon(e.ident) : airportMarkIcon(e.ident, e.space, e.colour),
  })), [endpoints]);
  useGlMarks(fields);
  useGlProbe("checkpoint-marks", ["checkpoints"], f => ({ key: f.properties.key, number: f.properties.number }));
  const { openCard } = useGlMap();
  useGlTap(["checkpoints"], TAP.mark, TAP.rank.checkpoint, feature => {
    const c = checkpoints.find(p => p.key === String(feature.properties.key));
    if (!c) return;
    c.select();
    openCard(c.card);
  });
  useGlTap(["candidates"], 8, TAP.rank.checkpoint + 0.5, feature => {
    const c = candidates.find(p => p.key === String(feature.properties.key));
    if (c) openCard(c.card);
  });
  return null;
}
