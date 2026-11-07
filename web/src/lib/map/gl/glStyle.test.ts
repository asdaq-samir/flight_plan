import { describe, expect, it } from "vitest";
import type { AirspaceVolume, ChartInfo } from "../../api/types";
import { absoluteTiles, airspaceFeatures, airspaceLayers, chartStyle, glZoom } from "./glStyle";

const chart = {
  chart_cycle: "10-29-2026", chart_revision: 6, chart_tiles_base: null,
  chart_layers: [
    { kind: "sec", label: "Sectional", min_zoom: 3, max_zoom: 12, base: true, over: [], sheets: [], cycle: "10-29-2026", revision: 6 },
    { kind: "tac", label: "Terminal area", min_zoom: 10, max_zoom: 13, base: false, over: ["sec"], sheets: [], cycle: "10-29-2026", revision: 6 },
  ],
} as unknown as ChartInfo;

describe("chartStyle", () => {
  it("asks for the tiles ChartTiles asks for, at the same zooms", () => {
    const style = chartStyle(chart, "sec", false, "https://wingtip.test")!;
    expect(style.sources.chart!.tiles).toEqual(["https://wingtip.test/api/planner/chart-tile/sec/{z}/{x}/{y}.png?c=10-29-2026&r=6"]);
    expect(style.sources.chart).toMatchObject({ minzoom: 3, maxzoom: 12, tileSize: 256 });
    // The region's level under it, as ChartTiles' underlay.
    expect(style.sources["chart-under"]).toMatchObject({ minzoom: 5, maxzoom: 5 });
    // Two levels past the chart's last, in MapLibre's zoom (Leaflet's less one).
    expect(style.maxZoom).toBe(13);
    expect(style.layers.map(l => l.id)).toEqual(["chart-under", "chart"]);
  });

  it("puts the terminal sheet over the chart only while pinned", () => {
    const style = chartStyle(chart, "sec", true, "https://wingtip.test")!;
    expect(style.layers.map(l => l.id)).toEqual(["chart-under", "chart", "chart-terminal"]);
    expect(style.layers[2]!.minzoom).toBe(glZoom(10));
  });

  it("leaves a CDN's address as it is, and keeps the braces", () => {
    expect(absoluteTiles("https://cdn.test/c/sec/{z}/{x}/{y}.png?r=1", "https://wingtip.test")).toBe("https://cdn.test/c/sec/{z}/{x}/{y}.png?r=1");
  });
});

describe("airspaceFeatures", () => {
  const volume = {
    id: "ORD-B-1", airspace_class: "B", floor_ft: 3000, floor_sfc: false, ceiling_ft: 10000, ceiling_excluded: false,
    lines: [[[41.9, -87.9], [42.0, -87.8]], [[41.0, -87.0]]],
  } as unknown as AirspaceVolume;

  it("makes each of a volume's lines a feature in [lon, lat], with its altitudes", () => {
    const { features } = airspaceFeatures([volume]);
    // The one-point line is dropped: no line to draw.
    expect(features).toHaveLength(1);
    expect(features[0]!.geometry.coordinates).toEqual([[-87.9, 41.9], [-87.8, 42.0]]);
    expect(features[0]!.properties).toEqual({ id: "ORD-B-1", cls: "B", label: "100/30" });
  });

  it("draws each class from AirspaceLayer's zoom, the labels from 8", () => {
    const layers = airspaceLayers(["Inter"]);
    const from = Object.fromEntries(layers.map(l => [l.id, l.minzoom]));
    expect(from).toMatchObject({ "airspace-B": glZoom(6), "airspace-C": glZoom(7), "airspace-D": glZoom(8), "airspace-labels": glZoom(8) });
  });
});
