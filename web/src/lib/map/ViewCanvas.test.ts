// @vitest-environment jsdom
import L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewCanvasLayer } from "./ViewCanvas";

/** A layer whose paint asks for another frame until `until`, as a canvas
 *  with a mark still fading in does (fadeIn), counting its drawings. */
class Fading extends ViewCanvasLayer {
  drawings = 0;
  until = 0;
  protected paint(): void {
    this.drawings++;
    if (performance.now() < this.until) this.schedule();
  }
}

// The browser's frames by hand, a frame each 16 ms, so the drawings in
// each can be counted.
let clock = 0;
let next = 1;
const waiting = new Map<number, FrameRequestCallback>();
function frame(layer: Fading): number {
  const before = layer.drawings;
  const due = [...waiting.values()];
  waiting.clear();
  clock += 16;
  for (const run of due) run(clock);
  return layer.drawings - before;
}

describe("ViewCanvasLayer's frames", () => {
  let map: L.Map;
  let layer: Fading;

  beforeEach(() => {
    clock = 1000;
    waiting.clear();
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      waiting.set(next, run);
      return next++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { waiting.delete(id); });
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    // jsdom draws nothing; the layer needs only a context to clear.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      { setTransform() {}, clearRect() {} } as unknown as CanvasRenderingContext2D,
    );
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400 });
    Object.defineProperty(container, "clientHeight", { value: 800 });
    map = L.map(container, { zoomAnimation: false, fadeAnimation: false }).setView([42.3, -88.0], 9);
    layer = new Fading("overlayPane");
    layer.addTo(map);
  });

  afterEach(() => {
    layer.remove();
    map.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("draws a fade once a frame at rest, and asks for no frame once it is done", () => {
    layer.until = clock + 100;
    frame(layer);
    const counts: number[] = [];
    while (waiting.size && counts.length < 50) counts.push(frame(layer));
    expect(counts.every(n => n === 1)).toBe(true);
    expect(counts.length).toBeLessThanOrEqual(8);
    expect(waiting.size).toBe(0);
  });

  it("draws once a frame through a zoom's animation with a fade running, not once more each frame", () => {
    // A fade that outlasts the quarter second's animation (ViewCanvas's
    // ZOOM_MS), as a mark first drawn as the zoom starts does.
    layer.until = clock + 400;
    map.fire("zoomanim", { center: map.getCenter(), zoom: 10, noUpdate: false });
    const counts: number[] = [];
    for (let i = 0; i < 18; i++) counts.push(frame(layer));
    // The animation's end, as Leaflet fires it.
    map.fire("zoomend");
    while (waiting.size && counts.length < 60) counts.push(frame(layer));
    expect(Math.max(...counts)).toBe(1);
    expect(waiting.size).toBe(0);
  });
  it("gives a layer made again in its pane the canvas the last one left, cleared and with nothing written on it", () => {
    const ctx = { setTransform: vi.fn(), clearRect: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const canvasOf = (l: ViewCanvasLayer) => (l as unknown as { canvas: HTMLCanvasElement | null }).canvas;
    const first = canvasOf(layer)!;
    first.dataset.marks = "[1]";
    layer.remove();
    expect(first.isConnected).toBe(false);
    expect(first.dataset.marks).toBeUndefined();
    expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, first.width, first.height);
    const again = new Fading("overlayPane");
    again.addTo(map);
    expect(canvasOf(again)).toBe(first);
    expect(first.isConnected).toBe(true);
    // Another while that one is in use has its own; and one in another
    // pane never takes it.
    const beside = new Fading("overlayPane");
    beside.addTo(map);
    expect(canvasOf(beside)).not.toBe(first);
    beside.remove();
    again.remove();
    const elsewhere = new Fading("markerPane");
    elsewhere.addTo(map);
    expect(canvasOf(elsewhere)).not.toBe(first);
    expect(canvasOf(elsewhere)).not.toBe(canvasOf(beside));
    elsewhere.remove();
  });
});
