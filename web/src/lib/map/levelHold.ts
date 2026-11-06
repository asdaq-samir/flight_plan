import type L from "leaflet";
import { prefersReducedMotion } from "../motion";

/**
 * The longest a new zoom level is held back for all its tiles, ms: past
 * it, those in are shown and the rest come as they load, over the last
 * level's scaled. It was 1.5 s, and the chart sat at the last level's blur
 * long after most of the new one had come: after a zoom from 7 to 9 it
 * was whole 0.92 s after the map stopped (the map-load audit, 2026-11-04,
 * Chromium as a Pixel 7 at 4x CPU). The owner, that day: "make it fast but
 * stable".
 */
export const HOLD_MS = 400;
/** A level whose tiles were all in before this many frames were drawn
 *  came from a cache (the browser's, the service worker's, or the zoom's
 *  own ask ahead in ChartTiles): nothing was waited for, so it is shown at
 *  once. */
export const QUICK_FRAMES = 2;
/** How long a level that was waited for fades in over the last, ms: short,
 *  where 0.2 s added itself to every wait. */
export const LEVEL_FADE_MS = 120;

/** How long a held level fades in, ms: none when it came within a frame
 *  or two of being asked for, or under Reduce Motion. */
export function levelFade(framesWaited: number, reduceMotion: boolean): number {
  return reduceMotion || framesWaited < QUICK_FRAMES ? 0 : LEVEL_FADE_MS;
}

/** Leaflet's own, which the hold reaches into: the zoom's container of
 *  tiles, the zoom tiles are asked for at, and its pruning of the tiles of
 *  other zooms. */
export type Levels = L.TileLayer & { _level?: { el: HTMLElement; zoom: number }; _tileZoom?: number; _pruneTiles: () => void };

/**
 * A new zoom's tiles shown together once they are all in, over the last
 * zoom's, which stay meanwhile, as ForeFlight's chart changes zoom:
 * Leaflet shows each tile as it arrives, and a zoom showed a patchwork of
 * sharp new tiles among the old ones scaled, a few at a time (the owner's
 * recording, 2026-11-02, zooming in on Charlotte). Held no longer than
 * HOLD_MS; shown at once when its tiles came within a frame or two, else
 * faded in over LEVEL_FADE_MS (levelFade). A pan's new tiles at the same
 * zoom are shown as they come.
 *
 * The old zoom's tiles are kept (no pruning) while the new one is held and
 * until it is opaque, or they went as each new tile under them loaded and
 * the chart showed blank where the new one was not in. A zoom on before
 * the last level is in leaves that level hidden too, under the newest,
 * where shown it was a patchwork again; each is given back once the
 * newest is opaque, so every way a hold ends leaves every level visible.
 * Returns what lets go of the layer.
 */
export function holdLevels(layer: Levels): () => void {
  const prune = layer._pruneTiles;
  // Levels made see-through and not yet shown.
  const hidden = new Set<HTMLElement>();
  // Levels shown, or given back, whose styles are cleared and the tiles
  // under them pruned once the one shown is opaque.
  const settling = new Set<HTMLElement>();
  let held: HTMLElement | null = null;
  let shownZoom = layer._tileZoom;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let framesWaited = 0;
  let counting = 0;
  let settleFrame = 0;
  layer._pruneTiles = function pruneWhenShown(this: Levels) {
    if (!held && !settleFrame) prune.call(this);
  };
  const count = () => {
    framesWaited += 1;
    counting = framesWaited < QUICK_FRAMES ? requestAnimationFrame(count) : 0;
  };
  // Once the level shown is opaque -- a frame after it was shown at once,
  // so one frame is drawn with both -- styles cleared, the levels hidden
  // under it given back, and the tiles it covers pruned. Counted in drawn
  // frames, not a timer, which a busy page could run before the fade had
  // been drawn at all.
  const settle = (fade: number) => {
    cancelAnimationFrame(settleFrame);
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      if (now - start <= fade) {
        settleFrame = requestAnimationFrame(step);
        return;
      }
      settleFrame = 0;
      for (const el of settling) {
        // Hidden again since: a zoom back to it before this frame.
        if (hidden.has(el)) continue;
        el.style.transition = "";
        el.style.opacity = "";
      }
      settling.clear();
      layer._pruneTiles();
    };
    settleFrame = requestAnimationFrame(step);
  };
  const show = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    cancelAnimationFrame(counting);
    counting = 0;
    // A 'load' with nothing held: a pan's tiles, or a level come back to
    // with its own already there, all in and drawn.
    if (!held) {
      shownZoom = layer._tileZoom;
      return;
    }
    held = null;
    shownZoom = layer._tileZoom;
    const fade = levelFade(framesWaited, prefersReducedMotion());
    // The level drawn now, which may be one hidden before the newest when
    // the map went back to it; the others stay hidden under it until it
    // is opaque.
    const current = layer._level?.el;
    for (const el of hidden) {
      settling.add(el);
      if (el !== current) continue;
      el.style.transition = fade ? `opacity ${fade}ms ease-out` : "";
      el.style.opacity = "1";
    }
    hidden.clear();
    settle(fade);
  };
  // At each tile asked for: Leaflet's own 'loading' fires only when
  // nothing was loading, and a zoom begun while the last one's tiles were
  // still coming made its new zoom with none.
  const loading = () => {
    const level = layer._level;
    if (!level || level.zoom === shownZoom || held === level.el) return;
    held = level.el;
    hidden.add(held);
    held.style.transition = "";
    held.style.opacity = "0";
    if (timer) clearTimeout(timer);
    timer = setTimeout(show, HOLD_MS);
    cancelAnimationFrame(counting);
    framesWaited = 0;
    counting = requestAnimationFrame(count);
  };
  layer.on("tileloadstart", loading);
  layer.on("load", show);
  return () => {
    layer.off("tileloadstart", loading);
    layer.off("load", show);
    if (timer) clearTimeout(timer);
    cancelAnimationFrame(counting);
    cancelAnimationFrame(settleFrame);
    // A prune Leaflet has already queued with the wrapper goes ahead.
    held = null;
    settleFrame = 0;
    for (const el of [...hidden, ...settling]) {
      el.style.transition = "";
      el.style.opacity = "";
    }
    layer._pruneTiles = prune;
  };
}

/**
 * No tile of any layer taken away while the map runs a zoom's animation,
 * on a GridLayer's prototype. With Leaflet's fade of each tile off
 * (MapShell), a tile's arrival prunes the others at once, mid-zoom too:
 * zooming in, the last level's tiles round the edge of the screen, which
 * the new level does not reach until the zoom ends, went as the first new
 * tile came from the cache, and the imagery and the sea showed what lay
 * under them for the rest of the quarter second. Leaflet's fade kept them
 * (its _noPrune), as this does. Pruned once the zoom is over, by Leaflet's
 * own at the zoom's end.
 */
export function pruneOnlyAtRest(grid: object) {
  const proto = grid as { _pruneTiles: () => void; _prunesAtRest?: true };
  // Once, though the module may be run again (a page's hot reload).
  if (proto._prunesAtRest) return;
  proto._prunesAtRest = true;
  const prune = proto._pruneTiles;
  proto._pruneTiles = function pruneAtRest(this: { _map?: { _animatingZoom?: boolean } }) {
    if (!this._map?._animatingZoom) prune.call(this);
  };
}
