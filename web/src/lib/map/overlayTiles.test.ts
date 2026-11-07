import { describe, expect, it, vi } from "vitest";
import type { OverlayTiles } from "../api/types";
import { OVERLAY_LAYERS, overlaySource, registerOverlayProtocol } from "./overlayTiles";

const TILES: OverlayTiles = {
  cycle: "2026-10-29", name: "2026-10-29-v1-0badf00d", version: 1, bytes: 1, built_at: 1, min_zoom: 4, max_zoom: 12,
  tolerance_m: 4.1, layers: OVERLAY_LAYERS.map(name => ({ name, features: 1 })),
};

describe("the overlay tiles", () => {
  it("are a vector source of the cycle's archive through the gateway, at its zooms", () => {
    expect(overlaySource(TILES, "https://wingtip.example")).toEqual({
      type: "vector",
      url: "pmtiles://https://wingtip.example/api/planner/overlay-tiles/2026-10-29-v1-0badf00d.pmtiles",
      minzoom: 4, maxzoom: 12, attribution: "FAA NASR, cycle 2026-10-29",
    });
  });

  it("add the pmtiles protocol to a MapLibre once", () => {
    const maplibre = { addProtocol: vi.fn() };
    registerOverlayProtocol(maplibre);
    registerOverlayProtocol(maplibre);
    expect(maplibre.addProtocol).toHaveBeenCalledOnce();
    expect(maplibre.addProtocol.mock.calls[0]![0]).toBe("pmtiles");
  });
});
