import { useQuery } from "@tanstack/react-query";
import type { FillLayerSpecification, LineLayerSpecification, RasterLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../api/client";
import type { MapPirep, StationWind } from "../../../api/types";
import { areaColour, barbSvg, pirepMark } from "../../../weatherMap";
import { AreaCard, PirepCard, RADAR_URL, SATELLITE_URL, WindCard, weatherBoxOf } from "../../WeatherLayer";
import { useWeatherLayers } from "../../weatherLayers";
import { addSvgImages, useGlData, useGlLayer, useGlMap, useGlTap } from "../glLayer";
import { glZoom } from "../glStyle";
import { TAP } from "./common";

const REFRESH_MS = 5 * 60_000;
const empty = () => ({ type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } });

const AREAS = "wx-areas";
const MARKS = "wx-marks";
/** An advisory's area bold, a forecast's (a G-AIRMET) dashed, each in its
 *  hazard's colour over a wash of it (weatherMap areaColour). */
const AREA_LAYERS: (FillLayerSpecification | LineLayerSpecification)[] = [
  { id: "wx-area-fill", type: "fill", source: AREAS, paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.12 } },
  { id: "wx-area-line", type: "line", source: AREAS, filter: ["!", ["get", "forecast"]], paint: { "line-color": ["get", "colour"], "line-width": 2.5 } },
  { id: "wx-area-forecast", type: "line", source: AREAS, filter: ["get", "forecast"], paint: { "line-color": ["get", "colour"], "line-width": 2, "line-dasharray": [3, 2.5] } },
];
const MARK_LAYER: SymbolLayerSpecification = {
  id: "wx-marks", type: "symbol", source: MARKS,
  layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true, "symbol-sort-key": ["get", "rank"] },
};

/** A PIREP's chip as the Leaflet map's (WeatherLayer pirepIcon), as SVG. */
function pirepSvg(p: MapPirep): string {
  const { glyph, colour, level } = pirepMark(p);
  const words = `${glyph} ${level}`.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const w = 14 + words.length * 7;
  return `<svg width="${w}" height="22" viewBox="0 0 ${w} 22"><rect x="1" y="1" width="${w - 2}" height="20" rx="10" fill="#fff" stroke="${colour}" stroke-width="2"/>`
    + `<text x="${w / 2}" y="15.5" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="12" font-weight="700" fill="${colour}">${words}</text></svg>`;
}

const pirepKey = (p: MapPirep, i: number) => `${p.lat},${p.lon},${p.observed_at ?? i}`;

/**
 * The weather on the map at the pilot's pick (useWeatherLayers), as
 * WeatherLayer: radar and satellite as raster layers from IEM, the
 * advisories' areas, the PIREPs and the winds aloft from the planner's
 * weather map for the view -- drawn bold, as what changes by the hour
 * over the chart. A tap on an area, a PIREP or a barb opens its card.
 */
export function WeatherGl({ line, altitudeFt }: { line: [number, number][] | null; altitudeFt: number | null }) {
  const { map, openCard } = useGlMap();
  const { radar, satellite, areas, pireps, winds } = useWeatherLayers();
  const [box, setBox] = useState(() => weatherBoxOf(map.getBounds()));
  useEffect(() => {
    const rest = () => setBox(was => {
      const next = weatherBoxOf(map.getBounds());
      return next.south === was.south && next.north === was.north && next.west === was.west && next.east === was.east ? was : next;
    });
    map.on("moveend", rest);
    return () => { map.off("moveend", rest); };
  }, [map]);
  const windsFt = winds === "off" ? null : winds === "plan" ? altitudeFt ?? 9000 : winds;
  const { data } = useQuery({
    queryKey: ["weatherMap", box, windsFt],
    queryFn: () => api.weatherMap(box, windsFt),
    enabled: areas || pireps || windsFt !== null || radar,
    staleTime: REFRESH_MS, refetchInterval: REFRESH_MS, meta: { silent: true },
  });
  const radarUrl = data?.radar_valid ? `${RADAR_URL}?v=${encodeURIComponent(data.radar_valid)}` : RADAR_URL;

  useGlLayer("areas", { [AREAS]: empty() }, AREA_LAYERS);
  useGlLayer("top", { [MARKS]: empty() }, [MARK_LAYER]);
  const areaFeatures = useMemo<GeoJSON.FeatureCollection | null>(() => (areas && data ? {
    type: "FeatureCollection",
    features: data.advisories.map(a => ({
      type: "Feature", properties: { id: a.id, colour: areaColour(a), forecast: a.kind === "gairmet" },
      geometry: { type: "Polygon", coordinates: [(a.coords as [number, number][]).map(([lat, lon]) => [lon, lat])] },
    })),
  } : null), [areas, data]);
  useGlData(AREAS, areaFeatures);

  const [marks, setMarks] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    let live = true;
    const pictures: [string, () => string][] = [];
    const features: GeoJSON.Feature[] = [];
    if (pireps) {
      (data?.pireps ?? []).forEach((p, i) => {
        const { glyph, colour, level } = pirepMark(p);
        const icon = `pirep|${glyph}|${colour}|${level}`;
        pictures.push([icon, () => pirepSvg(p)]);
        features.push({ type: "Feature", properties: { kind: "pirep", key: pirepKey(p, i), icon, rank: p.urgent ? 0 : 1 }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
      });
    }
    if (windsFt !== null) {
      for (const w of data?.winds?.stations ?? []) {
        const icon = `barb|${Math.round(w.dir_true_deg / 10)}|${Math.round(w.speed_kt / 5)}`;
        pictures.push([icon, () => barbSvg(w.dir_true_deg, w.speed_kt)]);
        features.push({ type: "Feature", properties: { kind: "wind", key: w.ident, icon, rank: 2 }, geometry: { type: "Point", coordinates: [w.lon, w.lat] } });
      }
    }
    void addSvgImages(map, pictures).then(() => { if (live) setMarks({ type: "FeatureCollection", features }); });
    return () => { live = false; };
  }, [map, data, pireps, windsFt]);
  useGlData(MARKS, marks);

  useGlTap(["wx-marks"], TAP.mark, TAP.rank.mark + 2, feature => {
    const key = String(feature.properties.key);
    if (feature.properties.kind === "pirep") {
      const p = data?.pireps.find((q, i) => pirepKey(q, i) === key);
      if (p) openCard(<PirepCard key={key} pirep={p} />);
    } else if (windsFt !== null) {
      const w: StationWind | undefined = data?.winds?.stations.find(s => s.ident === key);
      if (w) openCard(<WindCard key={key} wind={w} altitudeFt={windsFt} />);
    }
  });
  useGlTap(["wx-area-fill"], 1, TAP.rank.area + 1, feature => {
    const a = data?.advisories.find(q => q.id === feature.properties.id);
    if (a) openCard(<AreaCard key={a.id} area={a} line={line} altitudeFt={altitudeFt} />);
  });
  return (
    <>
      {satellite && <WeatherTiles key="sat" id="wx-satellite" url={SATELLITE_URL} max={9} opacity={0.45} />}
      {radar && <WeatherTiles key={radarUrl} id="wx-radar" url={radarUrl} max={10} opacity={0.6} />}
    </>
  );
}

/** A weather raster over the chart (IEM's tiles), made again as its
 *  address changes (the radar's time). */
function WeatherTiles({ id, url, max, opacity }: { id: string; url: string; max: number; opacity: number }) {
  const source = { [id]: { type: "raster" as const, tiles: [url], tileSize: 256, maxzoom: max } };
  const layer: RasterLayerSpecification = { id, type: "raster", source: id, minzoom: glZoom(3), paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } };
  useGlLayer("areas", source, [layer]);
  return null;
}
