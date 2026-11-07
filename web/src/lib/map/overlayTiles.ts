import { Protocol } from "pmtiles";
import type { OverlayTiles } from "../api/types";

/**
 * The map's FAA overlays as vector tiles, for a MapLibre map: the cycle's
 * airspace, special-use areas, airports, navaids and fixes in one PMTiles
 * archive the planner builds once a cycle (wingtip.vector_tiles) and
 * serves in byte ranges (/api/overlay-tiles/{name}.pmtiles), read here by
 * protomaps' own `pmtiles` protocol -- stock, nothing hand-rolled. A map
 * registers the protocol once, asks `api.overlayTiles()` for the cycle's
 * archive, and adds `overlaySource(tiles)` as a vector source; its
 * layers then draw from the source layers in OVERLAY_LAYERS, by the
 * fields docs/README.md lists. How each is drawn and written stays with
 * the map.
 */

/** The archive's source layers (wingtip.vector_tiles.LAYERS). */
export const OVERLAY_LAYERS = ["airspace", "special_use", "airports", "navaids", "fixes"] as const;
export type OverlayLayer = (typeof OVERLAY_LAYERS)[number];

/** MapLibre's addProtocol, as much of it as this needs: maplibre-gl itself
 *  is the map's import, not this module's. */
export interface ProtocolHost {
  addProtocol(name: string, loader: Protocol["tile"]): void;
}

const protocol = new Protocol({ metadata: true });
const registered = new WeakSet<ProtocolHost>();

/** The `pmtiles://` protocol added to a MapLibre once, however many maps
 *  are made: one Protocol, so every map shares the archives' headers and
 *  directories it has already read. */
export function registerOverlayProtocol(maplibre: ProtocolHost): void {
  if (registered.has(maplibre)) return;
  maplibre.addProtocol("pmtiles", protocol.tile);
  registered.add(maplibre);
}

/** The archive's address through the gateway (PlannerProxyController
 *  passes the Range on): absolute, as the pmtiles protocol fetches it. */
export function overlayArchiveUrl(tiles: Pick<OverlayTiles, "name">, origin: string = location.origin): string {
  return `${origin}/api/planner/overlay-tiles/${tiles.name}.pmtiles`;
}

/** A MapLibre vector source of the cycle's archive. Its zooms are the
 *  archive's: past max_zoom MapLibre draws the deepest tiles larger,
 *  within the archive's tolerance_m of the FAA's lines. */
export function overlaySource(tiles: OverlayTiles, origin?: string) {
  return {
    type: "vector" as const,
    url: `pmtiles://${overlayArchiveUrl(tiles, origin)}`,
    minzoom: tiles.min_zoom,
    maxzoom: tiles.max_zoom,
    attribution: `FAA NASR, cycle ${tiles.cycle}`,
  };
}
