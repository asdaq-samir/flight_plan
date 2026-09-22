// @vitest-environment jsdom
//
// Leaflet reaches for `window` the moment it is imported, and the
// project default is the node environment (vite.config.ts). This file
// is the one unit test that touches the map library.
import { describe, expect, it } from "vitest";
import { corridorTiles, CORRIDOR_NM } from "./keepRoute";

/**
 * The tiles a route keeps for the air.
 *
 * Which tile a point falls in is now Leaflet's projection rather than
 * two formulas written out here. That is only safe if it picks exactly
 * the tiles the slippy-map scheme defines, because the service worker
 * matches on URL: a tile computed one way and requested another is a
 * tile that was fetched for nothing and is missing when the connection
 * goes.
 *
 * The reference below is that scheme's own definition, which is what
 * every tile server and Leaflet itself implement.
 */
function referenceTile(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}

describe("corridorTiles", () => {
  it("covers the tile each point of the line actually falls in", () => {
    // A single-point-per-zoom check: the corridor around a degenerate
    // segment must at least contain the tile the point is in.
    const chicago: [number, number] = [41.8781, -87.6298];
    const duluth: [number, number] = [46.8372, -92.1833];
    const tiles = corridorTiles([chicago, duluth], [10]);

    for (const [lat, lon] of [chicago, duluth]) {
      const want = referenceTile(lat, lon, 10);
      expect(tiles).toContainEqual({ z: 10, x: want.x, y: want.y });
    }
  });

  it("agrees with the slippy-map definition at every zoom it keeps", () => {
    const point: [number, number] = [44.0, -89.0];
    for (const z of [8, 10, 12, 14]) {
      const want = referenceTile(point[0], point[1], z);
      const tiles = corridorTiles([point, point], [z], 0.01);
      expect(tiles).toContainEqual({ z, x: want.x, y: want.y });
    }
  });

  it("widens with the corridor and never leaves the tile grid", () => {
    // Zoom 13, where a tile is a couple of miles across: at zoom 10 a
    // single tile is wider than the whole corridor either way, so both
    // reach exactly one tile and the counts are equal.
    const line: [number, number][] = [[44.0, -89.0], [44.5, -88.0]];
    const narrow = corridorTiles(line, [13], 1);
    const wide = corridorTiles(line, [13], CORRIDOR_NM);
    expect(wide.length).toBeGreaterThan(narrow.length);

    const n = 2 ** 13;
    for (const t of wide) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(n);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(n);
    }
  });

  it("returns each tile once", () => {
    const line: [number, number][] = [[44.0, -89.0], [44.5, -88.0], [45.0, -87.5]];
    const tiles = corridorTiles(line, [9, 10]);
    const keys = tiles.map(t => `${t.z}/${t.x}/${t.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
