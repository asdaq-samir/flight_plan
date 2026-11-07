import type { LineLayerSpecification } from "maplibre-gl";
import { useMemo } from "react";
import { useGlData, useGlLayer, type Slot } from "./glLayer";

export interface GlRun {
  /** [lat, lon], as the app keeps its lines. */
  points: [number, number][];
  colour: string;
  width: number;
  opacity?: number;
}

/**
 * Lines drawn as one source and two layers -- a casing under, each run in
 * its own colour and width over it -- the shape every track on the map
 * takes (own ship's trail, a flown track, a past flight, a tracked
 * airplane's path, a leg picked in the Brief), where the Leaflet map drew
 * a polyline each.
 */
export function useGlLines(id: string, slot: Slot, runs: GlRun[] | null, casing: { colour: string; width: number; opacity: number } | null, dash?: number[]) {
  const layers = useMemo<LineLayerSpecification[]>(() => [
    ...(casing ? [{
      id: `${id}-casing`, type: "line" as const, source: id,
      layout: { "line-join": "round" as const, "line-cap": "round" as const },
      paint: { "line-color": casing.colour, "line-width": casing.width, "line-opacity": casing.opacity },
    }] : []),
    {
      id, type: "line", source: id,
      layout: { "line-join": "round", "line-cap": dash ? "butt" : "round" },
      paint: { "line-color": ["get", "colour"], "line-width": ["get", "width"], "line-opacity": ["get", "opacity"], ...(dash ? { "line-dasharray": dash } : {}) },
    },
    // Read once a map (useGlLayer): the casing's look is the caller's constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [id]);
  const sources = useMemo(() => ({ [id]: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } } }), [id]);
  useGlLayer(slot, sources, layers);
  const data = useMemo<GeoJSON.FeatureCollection | null>(() => (runs ? {
    type: "FeatureCollection",
    features: runs.filter(r => r.points.length > 1).map(r => ({
      type: "Feature", properties: { colour: r.colour, width: r.width, opacity: r.opacity ?? 1 },
      geometry: { type: "LineString", coordinates: r.points.map(([lat, lon]) => [lon, lat]) },
    })),
  } : null), [runs]);
  useGlData(id, data);
}
