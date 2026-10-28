import L from "leaflet";
import { SHEET_SECONDS } from "../../components/mapChrome";
import { prefersReducedMotion } from "../motion";

/** The slide running on each map, to be stopped by the next. */
const running = new WeakMap<L.Map, () => void>();

/** Whether the map is being slid with the sheet: own ship's follow holds
 *  off (OwnShipLayer), a pan from a fix mid-way cutting it short. */
export const slidingWithSheet = (map: L.Map) => running.has(map);

/** The longest a slide waits on the sheet: a sheet that never lands (a
 *  drag taken up again, a frame the browser skipped) leaves the map where
 *  it was meant to go. */
const LONGEST_MS = 1200;

/**
 * The map slid by `by` (layer points, what was at `by` from the middle
 * comes to the middle), the chart where it comes to rest asked for first:
 * a phone's tiles load only once a move ends (Leaflet's updateWhenIdle),
 * and the strip a slide brings in came blank until they did. GridLayer's
 * `_update` takes the centre to load for.
 *
 * With `sheet`, locked to the sheet frame by frame, as Apple Maps' map is
 * to its sheet: at each frame the map has gone the share of its way the
 * sheet's edge has, from where that edge was as it turned to `sheet.to`,
 * the edge of the room it is going to. Eased on its own -- Leaflet's pan,
 * its own curve and time -- the map started before the sheet and landed
 * 80 ms ahead of it, the two drifting apart (traced on the phone project,
 * half to the pill: the map 98% of its way where the sheet was 84%), the
 * owner's "Something is off about the map moving with markers and the
 * sheet moving" (2026-10-27). The pane is moved as Leaflet's own pan
 * moves it (`_rawPanBy`), in whole device pixels (subpixel), with a
 * movestart and one moveend as it lands and no move between: what is
 * drawn for the view -- the airports' canvas, the lines -- stays as it is
 * through the slide and is drawn again once, where it lands.
 */
export function slideMap(map: L.Map, by: L.Point, sheet?: { el: HTMLElement; to: number }) {
  running.get(map)?.();
  const to = map.unproject(map.project(map.getCenter()).add(by));
  map.eachLayer(layer => {
    if (layer instanceof L.GridLayer) (layer as unknown as { _update(center: L.LatLng): void })._update(to);
  });
  if (prefersReducedMotion()) {
    map.panBy(by, { animate: false });
    return;
  }
  const from = sheet?.el.getBoundingClientRect().top;
  const span = sheet && from !== undefined ? sheet.to - from : 0;
  if (!sheet || Math.abs(span) < 2) {
    map.panBy(by, { animate: true, duration: SHEET_SECONDS, easeLinearity: 0.5 });
    return;
  }
  const pane = map.getPane("mapPane")!;
  const start = L.DomUtil.getPosition(pane);
  const dpr = window.devicePixelRatio || 1;
  const began = performance.now();
  let frame = 0;
  const end = () => {
    cancelAnimationFrame(frame);
    running.delete(map);
    map.off("dragstart zoomstart", end);
    map.fire("moveend");
  };
  const step = () => {
    const share = performance.now() - began > LONGEST_MS
      ? 1 : Math.min(1, Math.max(0, (sheet.el.getBoundingClientRect().top - from!) / span));
    const at = start.subtract(by.multiplyBy(share));
    L.DomUtil.setPosition(pane, share === 1 ? at.round() : L.point(Math.round(at.x * dpr) / dpr, Math.round(at.y * dpr) / dpr));
    if (share === 1) end();
    else frame = requestAnimationFrame(step);
  };
  running.set(map, end);
  // The pilot's own move takes over: the slide stops where it is.
  map.on("dragstart zoomstart", end);
  map.fire("movestart");
  frame = requestAnimationFrame(step);
}
