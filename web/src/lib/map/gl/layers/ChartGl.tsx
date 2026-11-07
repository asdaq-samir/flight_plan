import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Course } from "../../../api/types";
import { chartQuery } from "../../../queryClient";
import { usePreferences } from "../../../preferences";
import { useSunlight } from "../../../sunlight";
import { useGlLayer, useGlMap, useGlPaint } from "../glLayer";
import { chartPaint, chartStyle, type ChartStyle } from "../glStyle";

const CHART_LAYERS = ["chart-under", "chart", "chart-terminal"];

/**
 * The FAA chart as ChartTiles draws it (glStyle's chartStyle): the base
 * chart, the region's level under it and the terminal sheet over it while
 * pinned, made again as the base, the pin or the cycle changes; dimmed at
 * night and brightened in sunlight as index.css does Leaflet's tiles.
 */
export function ChartGl({ course, previewing = false }: { course: Course | null; previewing?: boolean }) {
  const { data: chartOnly } = useQuery({ ...chartQuery, enabled: !course });
  const chart = course ?? chartOnly ?? null;
  const base = usePreferences(s => s.base);
  // Pinned, or a Class B chip hovered (ClassBGl), as ChartTiles' previewing.
  const pinned = usePreferences(s => s.tac) || previewing;
  const chartNight = usePreferences(s => s.chartNight);
  const sunlight = useSunlight();
  const dark = useDarkTheme();
  // On <html> as ChartTiles puts it, for index.css's night colours.
  useEffect(() => { document.documentElement.dataset.chartNight = chartNight; }, [chartNight]);
  const spec = useMemo(() => (chart ? chartStyle(chart, base, pinned, window.location.origin) : null), [chart, base, pinned]);
  // The base and the terminal sheet each made again only as its own tiles
  // change: pinning the TAC left the sectional's tiles where they were.
  const parts = useMemo(() => (spec ? (["base", "terminal"] as const).map(part => {
    const ids = part === "base" ? ["chart-under", "chart"] : ["chart-terminal"];
    const sources = Object.fromEntries(Object.entries(spec.sources).filter(([id]) => ids.includes(id)));
    return { part, spec: { ...spec, sources, layers: spec.layers.filter(l => ids.includes(l.id)) } };
  }).filter(p => p.spec.layers.length) : []), [spec]);
  const night = dark && chartNight === "dimmed";
  // Which charts are drawn and how, on the map's element, for the browser
  // tests: each part's kind (its tiles' path) and the paint's look.
  const { map } = useGlMap();
  const kinds = parts.map(p => /\/(?:chart-tile\/)?([a-z_]+)\/\{z\}/.exec(Object.values(p.spec.sources).at(-1)?.tiles?.[0] ?? "")?.[1] ?? "").join(" ");
  const look = night ? "dimmed" : sunlight ? "bright" : "normal";
  useEffect(() => {
    const el = map.getContainer();
    el.dataset.chartKinds = kinds;
    el.dataset.chartLook = look;
  }, [map, kinds, look]);
  return parts.map(({ part, spec }) => <ChartSources key={`${part}:${JSON.stringify(spec.sources)}`} spec={spec} night={night} sunlight={sunlight} />);
}

/** One chart's sources and layers, made again (`key`) as its tiles change;
 *  its paint set as the night and the sunlight change. */
function ChartSources({ spec, night, sunlight }: { spec: ChartStyle; night: boolean; sunlight: boolean }) {
  const { map } = useGlMap();
  useGlLayer("chart", spec.sources, spec.layers);
  useGlPaint(CHART_LAYERS, chartPaint(night, sunlight) as Record<string, unknown>);
  useEffect(() => {
    map.setMaxZoom(spec.maxZoom);
    // The frame the chart's first tile is drawn in, for the speed
    // measurements (a canvas is no Largest Contentful Paint candidate, as
    // Leaflet's tile images are): `chart-drawn`, once a page.
    const drawn = (e: { sourceId?: string; tile?: unknown }) => {
      if (e.sourceId !== "chart" || !e.tile) return;
      map.off("sourcedata", drawn);
      if (!performance.getEntriesByName("chart-drawn").length) map.once("render", () => performance.mark("chart-drawn"));
    };
    map.on("sourcedata", drawn);
    // The level of the chart's tiles drawn now, on the map's element, for
    // the browser tests: the zoom rounded, as raster tiles are chosen, no
    // further than the chart's own last level.
    const chart = spec.sources.chart;
    const level = () => {
      if (chart) map.getContainer().dataset.chartZoom = String(Math.min(chart.maxzoom ?? 22, Math.round(map.getZoom() + 1)));
    };
    level();
    map.on("moveend", level);
    return () => { map.off("sourcedata", drawn); map.off("moveend", level); };
  }, [map, spec]);
  return null;
}

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
