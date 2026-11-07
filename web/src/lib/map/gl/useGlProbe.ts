import type { MapGeoJSONFeature } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useGlMap } from "./glLayer";

/**
 * What a layer has drawn, where, for the browser tests: an empty element
 * in the map's container carrying `data-<name>` as JSON -- each feature
 * drawn, its `fields` and its place in the map's own points -- written
 * each time the map is idle, as the Leaflet canvases wrote theirs
 * (AirportCanvas' data-airport-marks, NavaidCanvas' data-navaid-marks).
 * A canvas drawn by WebGL has no elements for a test to find.
 */
export function useGlProbe(name: string, layers: string[], fields: (f: MapGeoJSONFeature) => Record<string, unknown>) {
  const { map } = useGlMap();
  const pick = useRef(fields);
  useEffect(() => { pick.current = fields; });
  const ids = layers.join();
  useEffect(() => {
    const el = document.createElement("div");
    el.hidden = true;
    el.dataset.glProbe = name;
    const attr = `data-${name}`;
    el.setAttribute(attr, "[]");
    map.getContainer().appendChild(el);
    const write = () => {
      const present = ids.split(",").filter(l => map.getLayer(l));
      const seen = new Set<string>();
      const out: Record<string, unknown>[] = [];
      for (const f of present.length ? map.queryRenderedFeatures({ layers: present }) : []) {
        if (f.geometry.type !== "Point") continue;
        const [lon, lat] = f.geometry.coordinates as [number, number];
        const at = map.project([lon, lat]);
        const row = { ...pick.current(f), x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 };
        const key = JSON.stringify(row);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
      el.setAttribute(attr, JSON.stringify(out));
    };
    map.on("idle", write);
    return () => { map.off("idle", write); el.remove(); };
  }, [map, name, ids]);
}
