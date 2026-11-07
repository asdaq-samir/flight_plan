import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { AirspaceVolume } from "../../../api/types";
import { usePreferences } from "../../../preferences";
import { AirspaceCardBody, airspaceQuery } from "../../AirspaceCard";
import { useGlData, useGlLayer, useGlMap, useGlTap } from "../glLayer";
import { AIRSPACE_LINE_LAYERS, AIRSPACE_SOURCE, airspaceFeatures, airspaceLayers } from "../glStyle";
import { useGlView } from "../useGlView";
import { useGlProbe } from "../useGlProbe";
import { GL_FONT, TAP } from "./common";

const SOURCES = { [AIRSPACE_SOURCE]: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] }, tolerance: 0.5 } };
const LAYERS = airspaceLayers(GL_FONT);
const NONE: AirspaceVolume[] = [];

/**
 * The Class B, C and D over the chart, as AirspaceLayer draws them on the
 * Leaflet map: the same question to the planner for the view and a
 * screen round it (airspaceQuery, its cache shared), each volume's lines
 * and its altitudes along them -- here MapLibre's line layers and
 * line-placed labels, kept off each other by its collision, where
 * AirspaceLinesCanvas and AirspaceLabelsCanvas drew them by hand. A tap
 * on a line opens the volume's card. The settings' Airspace turns them
 * off. The GeoJSON source is the seam for the vector tiles
 * (claude/vector-tiles): the same layers on a vector source.
 */
export function AirspaceGl() {
  const show = usePreferences(s => s.airspace);
  const { box, level } = useGlView();
  const query = useMemo(() => airspaceQuery(box, level, show), [box, level, show]);
  const { data } = useQuery({ ...query, placeholderData: keepPreviousData });
  const volumes = query.enabled ? data ?? NONE : NONE;
  useGlLayer("lines", SOURCES, LAYERS);
  const features = useMemo(() => airspaceFeatures(volumes), [volumes]);
  useGlData(AIRSPACE_SOURCE, features);
  // What is drawn, for the specs and the load log (AirspaceLinesCanvas' and
  // AirspaceLabelsCanvas' records were these).
  useGlProbe("airspace-lines", AIRSPACE_LINE_LAYERS, f => ({ id: f.properties.id, cls: f.properties.cls }));
  useGlProbe("airspace-edge-labels", ["airspace-labels"], f => ({ id: f.properties.id, text: f.properties.label }));
  const byId = useMemo(() => new Map(volumes.map(v => [v.id, v])), [volumes]);
  const { openCard } = useGlMap();
  useGlTap(AIRSPACE_LINE_LAYERS, TAP.line, TAP.rank.line, feature => {
    const volume = byId.get(String(feature.properties.id));
    if (volume) openCard(<AirspaceCardBody key={volume.id} volume={volume} close={() => openCard(null)} />);
  });
  return null;
}
