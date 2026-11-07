import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection, Geometry } from "geojson";
import type { FillLayerSpecification, LineLayerSpecification } from "maplibre-gl";
import { useMemo } from "react";
import { usePreferences } from "../../../preferences";
import { tfrsQuery } from "../../../queryClient";
import { TFR_RED, TfrCard, inForce } from "../../TfrCard";
import { useGlData, useGlLayer, useGlMap, useGlTap } from "../glLayer";
import { TAP } from "./common";

const SOURCE = "tfrs";
const SOURCES = { [SOURCE]: { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } } };

/** A TFR is drawn bold, a thing that changes by the day over the chart
 *  that does not: in force a solid red line over a red wash, not yet in
 *  force dashed over a fainter one (TfrLayer's inks, a little heavier). */
const FILL: FillLayerSpecification = {
  id: "tfrs-fill", type: "fill", source: SOURCE,
  paint: { "fill-color": TFR_RED, "fill-opacity": ["case", ["get", "active"], 0.14, 0.06] },
};
const LINE: LineLayerSpecification = {
  id: "tfrs-line", type: "line", source: SOURCE, filter: ["get", "active"],
  layout: { "line-join": "round" },
  paint: { "line-color": TFR_RED, "line-width": 2.5 },
};
const LINE_LATER: LineLayerSpecification = {
  id: "tfrs-line-later", type: "line", source: SOURCE, filter: ["!", ["get", "active"]],
  paint: { "line-color": TFR_RED, "line-width": 2, "line-dasharray": [3, 2.5] },
};

/**
 * The temporary flight restrictions, as TfrLayer: the same answer
 * (tfrsQuery), the settings' TFRs, each area a fill and its edge -- all of
 * them in one source, where the Leaflet map made a polygon each, fifteen a
 * frame. A tap inside one opens its card.
 */
export function TfrGl() {
  const show = usePreferences(s => s.tfrs);
  const { data, dataUpdatedAt: now } = useQuery({ ...tfrsQuery, enabled: show });
  useGlLayer("areas", SOURCES, [FILL, LINE, LINE_LATER]);
  const features = useMemo<FeatureCollection | null>(() => (show && data ? {
    type: "FeatureCollection",
    features: data.map(tfr => ({ type: "Feature", properties: { id: tfr.notam_id, active: inForce(tfr, now) }, geometry: tfr.geometry as unknown as Geometry })),
  } : null), [show, data, now]);
  useGlData(SOURCE, features);
  const { openCard } = useGlMap();
  useGlTap(["tfrs-fill"], 1, TAP.rank.area, feature => {
    const tfr = data?.find(t => t.notam_id === feature.properties.id);
    if (tfr) openCard(<TfrCard key={tfr.notam_id} tfr={tfr} active={inForce(tfr, now)} />);
  });
  return null;
}
