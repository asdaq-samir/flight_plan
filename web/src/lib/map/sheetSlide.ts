import L from "leaflet";
import { SHEET_SECONDS } from "../../components/mapChrome";
import { prefersReducedMotion } from "../motion";

/** The chart where the map is going asked for before it gets there: a
 *  phone's tiles load only once a move ends (Leaflet's updateWhenIdle),
 *  and the strip a slide brings in came blank until they did. GridLayer's
 *  `_update` takes the centre to load for. */
function preload(map: L.Map, by: L.Point) {
  const to = map.unproject(map.project(map.getCenter()).add(by));
  map.eachLayer(layer => {
    if (layer instanceof L.GridLayer) (layer as unknown as { _update(center: L.LatLng): void })._update(to);
  });
}

/** The map slid by `by` (what was at `by` from the middle comes to the
 *  middle) in the sheet's time: a desktop's card, out at the side. */
export function slideMap(map: L.Map, by: L.Point) {
  preload(map, by);
  map.panBy(by, { animate: !prefersReducedMotion(), duration: SHEET_SECONDS, easeLinearity: 0.5 });
}

/** The sheet followed on each map, how to stop it, and where its edge is
 *  going once the panel has said (the turn, MapShell). */
const following = new WeakMap<L.Map, { stop: () => void; going: (to: number) => void }>();
/** How far the map went with a dragged sheet that landed before the panel
 *  reported its turn: the turn's follow starts from there, not again. */
const gone = new WeakMap<L.Map, { from: number; offset: number; at: number }>();

/** Whether the map is going with the sheet: own ship's follow holds off
 *  (OwnShipLayer), a pan from a fix mid-way fighting it. */
export const followingSheet = (map: L.Map) => following.has(map);

/** Frames the sheet's edge stays put, the finger off it, before the map
 *  is taken to have landed. */
const STILL_FRAMES = 6;
/** The longest the map goes on following once the finger is off. */
const LONGEST_MS = 1500;

/**
 * The map going with a phone's sheet frame by frame, as Apple Maps' goes
 * with its own: under a finger's drag, through the settle after it, and
 * through a turn from a key or a tap. What was in the middle of the room
 * above the sheet stays in the middle of the room above it: the map moves
 * half as far as the sheet's edge, read each frame from the sheet itself
 * (its top, the transition's value in that frame). Not above `halfEdge`:
 * half way to all the way up and back the map stays put, at the owner's
 * ask. Eased on its own -- Leaflet's pan, its own curve and time -- the
 * map started before the sheet and landed 80 ms ahead of it, and under a
 * finger it waited until the sheet had landed (traced on the phone
 * project, half to the pill), the owner's "Something is off about the map
 * moving with markers and the sheet moving" (2026-10-27).
 *
 * `from` is where the edge of the room was as it began, the room the map
 * was placed for. The pane is moved as Leaflet's own pan moves it
 * (`_rawPanBy`), in whole device pixels (subpixel), with a movestart and
 * one moveend once the sheet is still and no move between: what is drawn
 * for the view -- the airports' canvas, the lines -- stays as it is and is
 * drawn again once, where the map lands. Started again while it runs (the
 * turn reported as a dragged sheet lands), the one running goes on.
 */
export function followSheet(map: L.Map, sheet: {
  el: HTMLElement; from: number; halfEdge: number; pressed: () => boolean; free: () => boolean; to?: number;
}) {
  const offsetAt = (edge: number) => (Math.max(edge, sheet.halfEdge) - Math.max(sheet.from, sheet.halfEdge)) / 2;
  if (sheet.to !== undefined) preload(map, L.point(0, -offsetAt(sheet.to)));
  const running = following.get(map);
  if (running) {
    if (sheet.to !== undefined) running.going(sheet.to);
    return;
  }
  const pane = map.getPane("mapPane")!;
  let start = L.DomUtil.getPosition(pane);
  const before = gone.get(map);
  gone.delete(map);
  if (before && Math.abs(before.from - sheet.from) < 1 && performance.now() - before.at < 1000) start = start.subtract(L.point(0, before.offset));
  let to = sheet.to;
  const dpr = window.devicePixelRatio || 1;
  let frame = 0;
  let moved = false;
  let lastEdge = NaN;
  let still = 0;
  let released = 0;
  let offset = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    following.delete(map);
    if (to === undefined && offset) gone.set(map, { from: sheet.from, offset, at: performance.now() });
    map.off("dragstart zoomstart", stop);
    if (moved) map.fire("moveend");
  };
  const put = (by: number, whole: boolean) => {
    offset = by;
    const y = start.y + by;
    const at = L.point(start.x, whole ? Math.round(y) : Math.round(y * dpr) / dpr);
    if (at.y === L.DomUtil.getPosition(pane).y) return;
    if (!moved) {
      moved = true;
      map.fire("movestart");
    }
    L.DomUtil.setPosition(pane, at);
  };
  const step = () => {
    if (!sheet.free() || !sheet.el.isConnected) return stop();
    const edge = sheet.el.getBoundingClientRect().top;
    still = Math.abs(edge - lastEdge) < 0.25 ? still + 1 : 0;
    lastEdge = edge;
    const pressed = sheet.pressed();
    if (!pressed && !released) released = performance.now();
    if (pressed) released = 0;
    // Where the panel has said it is going, landed there; else still.
    const there = to === undefined ? still >= STILL_FRAMES : Math.abs(edge - to) < 1 && still >= 2;
    const landed = !pressed && (there || performance.now() - released > LONGEST_MS);
    if (prefersReducedMotion() && !landed) {
      frame = requestAnimationFrame(step);
      return;
    }
    put(offsetAt(edge), landed);
    if (landed) stop();
    else frame = requestAnimationFrame(step);
  };
  following.set(map, { stop, going: edge => { to = edge; } });
  // The pilot's own move of the map takes over: it stops where it is.
  map.on("dragstart zoomstart", stop);
  frame = requestAnimationFrame(step);
}

/** The map no longer going with the sheet, left where it is: the route
 *  fitted to the room instead (MapShell). */
export const stopFollowingSheet = (map: L.Map) => following.get(map)?.stop();
