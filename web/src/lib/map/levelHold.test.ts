// @vitest-environment jsdom
/**
 * The chart's whole-level change: a new zoom level held until its tiles
 * are in, then shown at once or faded in short, the last kept under it
 * until it is opaque, and every way a hold ends leaving every level
 * visible. Driven through a stand-in for Leaflet's tile layer (its
 * events, its level, its pruning), with the clock and the frames faked.
 */
import L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, LEVEL_FADE_MS, holdLevels, levelFade, pruneOnlyAtRest, type Levels } from "./levelHold";

/** A tile layer as far as the hold reads it, at `zoom`. */
function fakeLayer(zoom: number) {
  const handlers = new Map<string, Set<() => void>>();
  const prune = vi.fn();
  const first = document.createElement("div");
  const layer = {
    _level: { el: first, zoom }, _tileZoom: zoom, _pruneTiles: prune,
    on(type: string, fn: () => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
      return layer;
    },
    off(type: string, fn: () => void) {
      handlers.get(type)?.delete(fn);
      return layer;
    },
  };
  const fire = (type: string) => { for (const fn of [...(handlers.get(type) ?? [])]) fn(); };
  /** The map gone to zoom `z`, its level `el`, and a tile of it asked
   *  for unless all its tiles are there already. */
  const zoomTo = (z: number, el = document.createElement("div"), asked = true) => {
    layer._level = { el, zoom: z };
    layer._tileZoom = z;
    if (asked) fire("tileloadstart");
    return el;
  };
  return { layer: layer as unknown as Levels, prune, fire, zoomTo, first };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a held level's fade", () => {
  it("is none for a level in within a frame or two, or under Reduce Motion, and short otherwise", () => {
    expect(levelFade(0, false)).toBe(0);
    expect(levelFade(1, false)).toBe(0);
    expect(levelFade(2, false)).toBe(LEVEL_FADE_MS);
    expect(levelFade(2, true)).toBe(0);
    expect(LEVEL_FADE_MS).toBeLessThanOrEqual(150);
  });
});

describe("a new zoom level", () => {
  it("is held see-through, the last kept under it, until its tiles are in", () => {
    const { layer, prune, zoomTo } = fakeLayer(7);
    holdLevels(layer);
    const level = zoomTo(8);
    expect(level.style.opacity).toBe("0");
    layer._pruneTiles();
    expect(prune).not.toHaveBeenCalled();
  });

  it("comes at once when its tiles came within a frame, the last pruned a frame after", () => {
    const { layer, prune, fire, zoomTo } = fakeLayer(7);
    holdLevels(layer);
    const level = zoomTo(8);
    fire("load");
    expect(level.style.opacity).toBe("1");
    expect(level.style.transition).toBe("");
    expect(prune).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(level.style.opacity).toBe("");
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("fades in short when it was waited for, the last pruned once it is opaque", () => {
    const { layer, prune, fire, zoomTo } = fakeLayer(7);
    holdLevels(layer);
    const level = zoomTo(8);
    vi.advanceTimersByTime(100);
    expect(level.style.opacity).toBe("0");
    fire("load");
    expect(level.style.opacity).toBe("1");
    expect(level.style.transition).toContain("opacity");
    vi.advanceTimersByTime(LEVEL_FADE_MS - 20);
    expect(prune).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(level.style.opacity).toBe("");
    expect(level.style.transition).toBe("");
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("is shown as it is once the hold's limit is past, the rest of its tiles coming as they load", () => {
    const { layer, prune, zoomTo } = fakeLayer(7);
    holdLevels(layer);
    const level = zoomTo(8);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(level.style.opacity).toBe("0");
    vi.advanceTimersByTime(1);
    expect(level.style.opacity).toBe("1");
    vi.advanceTimersByTime(LEVEL_FADE_MS + 40);
    expect(level.style.opacity).toBe("");
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("zoomed on from before it is in, stays hidden under the next, and both are visible once the next is in", () => {
    const { layer, fire, zoomTo } = fakeLayer(7);
    holdLevels(layer);
    const eight = zoomTo(8);
    vi.advanceTimersByTime(100);
    const nine = zoomTo(9);
    expect(eight.style.opacity).toBe("0");
    expect(nine.style.opacity).toBe("0");
    vi.advanceTimersByTime(100);
    fire("load");
    expect(nine.style.opacity).toBe("1");
    // Under the one shown until that is opaque, not a patchwork beside it.
    expect(eight.style.opacity).toBe("0");
    vi.advanceTimersByTime(LEVEL_FADE_MS + 40);
    expect(eight.style.opacity).toBe("");
    expect(nine.style.opacity).toBe("");
  });

  it("gone back to before the next is in, all its tiles there, is the one shown when the hold ends", () => {
    const { layer, zoomTo } = fakeLayer(7);
    holdLevels(layer);
    const eight = zoomTo(8);
    const nine = zoomTo(9);
    // Leaflet asks for none of 8's: all its tiles are there.
    zoomTo(8, eight, false);
    vi.advanceTimersByTime(HOLD_MS);
    expect(eight.style.opacity).toBe("1");
    expect(nine.style.opacity).toBe("0");
    vi.advanceTimersByTime(LEVEL_FADE_MS + 40);
    expect(eight.style.opacity).toBe("");
    expect(nine.style.opacity).toBe("");
  });

  it("gone back to the level shown before it is in, leaves that level as it is", () => {
    const { layer, zoomTo, first } = fakeLayer(7);
    holdLevels(layer);
    const eight = zoomTo(8);
    // A tile of 7 asked for there: a pan's.
    zoomTo(7, first);
    expect(first.style.opacity).toBe("");
    vi.advanceTimersByTime(HOLD_MS + LEVEL_FADE_MS + 40);
    expect(first.style.opacity).toBe("");
    expect(eight.style.opacity).toBe("");
  });
});

describe("a pan at the level shown", () => {
  it("has its new tiles come as they load, and Leaflet's pruning go on", () => {
    const { layer, prune, zoomTo, first } = fakeLayer(7);
    holdLevels(layer);
    zoomTo(7, first);
    expect(first.style.opacity).toBe("");
    layer._pruneTiles();
    expect(prune).toHaveBeenCalledTimes(1);
  });
});

describe("the hold let go of", () => {
  it("leaves no level see-through, nothing running, and Leaflet's pruning its own", () => {
    const { layer, prune, zoomTo } = fakeLayer(7);
    const letGo = holdLevels(layer);
    const eight = zoomTo(8);
    letGo();
    expect(eight.style.opacity).toBe("");
    layer._pruneTiles();
    expect(prune).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(eight.style.opacity).toBe("");
  });
});

describe("every tile layer's pruning", () => {
  // The hold and the guard lean on Leaflet 1.9's private fields; a bump
  // that moves them should fail here, not leave a pilot's chart hidden.
  it("keeps a layer's tiles through a zoom's animation, on the Leaflet it was written for", () => {
    expect(L.version).toBe("1.9.4");
    pruneOnlyAtRest(L.GridLayer.prototype);
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400 });
    Object.defineProperty(container, "clientHeight", { value: 800 });
    const map = L.map(container, { zoomAnimation: false, fadeAnimation: false }).setView([42.3, -88.0], 9);
    const layer = L.tileLayer("/t/{z}/{x}/{y}.png").addTo(map) as unknown as Levels & { _tiles: Record<string, { current: boolean }> };
    expect(layer._tileZoom).toBe(9);
    expect(layer._level?.zoom).toBe(9);
    expect(layer._level?.el).toBeInstanceOf(HTMLElement);
    const count = () => Object.keys(layer._tiles).length;
    const drawn = count();
    expect(drawn).toBeGreaterThan(0);
    // Tiles a new level has taken the place of, as Leaflet marks them.
    for (const tile of Object.values(layer._tiles)) tile.current = false;
    const zooming = map as unknown as { _animatingZoom: boolean };
    zooming._animatingZoom = true;
    layer._pruneTiles();
    expect(count()).toBe(drawn);
    zooming._animatingZoom = false;
    layer._pruneTiles();
    expect(count()).toBe(0);
    map.remove();
  });

  it("waits out a zoom's animation, and is wrapped once however often it is asked to be", () => {
    const prune = vi.fn();
    const grid = { _pruneTiles: prune as () => void };
    pruneOnlyAtRest(grid);
    const wrapped = grid._pruneTiles;
    pruneOnlyAtRest(grid);
    expect(grid._pruneTiles).toBe(wrapped);
    const layer = { _map: { _animatingZoom: true }, _pruneTiles: grid._pruneTiles };
    layer._pruneTiles();
    expect(prune).not.toHaveBeenCalled();
    layer._map._animatingZoom = false;
    layer._pruneTiles();
    expect(prune).toHaveBeenCalledTimes(1);
  });
});
