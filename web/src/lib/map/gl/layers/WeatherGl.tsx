import { useQuery } from "@tanstack/react-query";
import type { FillLayerSpecification, LineLayerSpecification, RasterLayerSpecification } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../api/client";
import { areaColour } from "../../../weatherMap";
import { AreaCard, PirepCard, RADAR_URL, SATELLITE_URL, WindCard, barbIcon, pirepIcon, weatherBoxOf } from "../../WeatherCards";
import { useWeatherLayers } from "../../weatherLayers";
import { useGlData, useGlLayer, useGlMap, useGlTap } from "../glLayer";
import { glZoom } from "../glStyle";
import { useGlProbe } from "../useGlProbe";
import { TAP } from "./common";
import { useGlMarks, type GlMark } from "./MarksGl";

const REFRESH_MS = 5 * 60_000;
const empty = () => ({ type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } });

const AREAS = "wx-areas";
/** An advisory's area bold, a forecast's (a G-AIRMET) dashed, each in its
 *  hazard's colour over a wash of it (weatherMap areaColour). */
const AREA_LAYERS: (FillLayerSpecification | LineLayerSpecification)[] = [
  { id: "wx-area-fill", type: "fill", source: AREAS, paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.12 } },
  { id: "wx-area-line", type: "line", source: AREAS, filter: ["!", ["get", "forecast"]], paint: { "line-color": ["get", "colour"], "line-width": 2.5 } },
  { id: "wx-area-forecast", type: "line", source: AREAS, filter: ["get", "forecast"], paint: { "line-color": ["get", "colour"], "line-width": 2, "line-dasharray": [3, 2.5] } },
];

/**
 * The weather on the map at the pilot's pick (useWeatherLayers): radar and
 * satellite as raster layers from IEM, the advisories' areas, the PIREPs
 * and the winds aloft from the planner's weather map for the view --
 * drawn bold, as what changes by the hour over the chart. A tap on an
 * area, a PIREP or a barb opens its card.
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
  const areaFeatures = useMemo<GeoJSON.FeatureCollection | null>(() => (areas && data ? {
    type: "FeatureCollection",
    features: data.advisories.map(a => ({
      type: "Feature", properties: { id: a.id, colour: areaColour(a), forecast: a.kind === "gairmet" },
      geometry: { type: "Polygon", coordinates: [(a.coords as [number, number][]).map(([lat, lon]) => [lon, lat])] },
    })),
  } : null), [areas, data]);
  useGlData(AREAS, areaFeatures);
  useGlProbe("weather-areas", ["wx-area-fill"], f => ({ id: f.properties.id, colour: f.properties.colour }));
  useGlTap(["wx-area-fill"], 1, TAP.rank.area + 1, feature => {
    const a = data?.advisories.find(q => q.id === feature.properties.id);
    if (a) openCard(<AreaCard key={a.id} area={a} line={line} altitudeFt={altitudeFt} />);
  });

  // The PIREPs and the barbs as the app's own chips (WeatherCards' icons),
  // each a marker a tap opens the card of.
  const marks = useMemo<GlMark[]>(() => [
    ...(pireps ? (data?.pireps ?? []).map((p, i) => ({
      key: `pirep-${p.lat},${p.lon},${p.observed_at ?? i}`, lat: p.lat, lon: p.lon, icon: pirepIcon(p),
      onTap: () => openCard(<PirepCard key={`${p.lat},${p.lon},${i}`} pirep={p} />),
    })) : []),
    ...(windsFt !== null ? (data?.winds?.stations ?? []).map(w => ({
      key: `wind-${w.ident}`, lat: w.lat, lon: w.lon, icon: barbIcon(w),
      title: `${w.ident}: ${Math.round(w.dir_true_deg)}° true at ${Math.round(w.speed_kt)} kt`,
      onTap: () => openCard(<WindCard key={w.ident} wind={w} altitudeFt={windsFt} />),
    })) : []),
  ], [data, pireps, windsFt, openCard]);
  useGlMarks(marks);
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
