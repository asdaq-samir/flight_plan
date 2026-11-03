import L from "leaflet";
import type { AirspaceVolume } from "../api/types";
import { AIRSPACE_LINE } from "./airspaceMarks";
import { ViewCanvasLayer, type CanvasView } from "./ViewCanvas";

/** How many dashes round a Class D's ring, about as many as the printed
 *  ring round a 4.4 nm surface area has on the 1:500,000 sectional: 102
 *  mm round, in dashes of 4 or 5 mm with their gaps. The same in number
 *  at every zoom, at the owner's ask (2026-11-02: "pick a number of
 *  dashes and stick with it instead of increasing them while zooming
 *  in"), where a dash of so many points made a ring of a dozen far out
 *  and a hundred close in. */
const RING_DASHES = 24;
/** No shorter a dash and its gap than this, px: far out, a ring's
 *  dashes are this, fewer of them, rather than a grey blur. */
const SHORTEST_DASH_PX = 6;
const NO_DASH: number[] = [];

/** Two points that give a frame's `warp` (paint). */
const ORIGIN = L.point(0, 0);
const UNIT = L.point(1, 0);
/** How many points round each ring in sight are written down at rest for
 *  the browser tests to tap (data-airspace-rings). */
const RING_POINTS = 8;

/** The square of how far (px, py) is from the segment (ax, ay)-(bx, by). */
function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}

/** A ring `px` round's dash and gap, two to one, as the chart's. */
export function ringDashes(px: number): [number, number] {
  const period = Math.max(SHORTEST_DASH_PX, px / RING_DASHES);
  return [period * 2 / 3, period / 3];
}

/** A volume's lines projected once, at zoom 0 in the map's own pixels:
 *  at zoom z each point is these times 2^z, Leaflet's Web Mercator being
 *  the one projection scaled. With the box round them, for what is in
 *  sight, and the longest line's length round, for a Class D's dashes. */
interface Projected {
  lines: Float64Array[];
  box: { x0: number; y0: number; x1: number; y1: number };
  longest: number;
}
const projected = new WeakMap<AirspaceVolume, Projected>();

function projectedOf(map: L.Map, volume: AirspaceVolume): Projected {
  let made = projected.get(volume);
  if (made) return made;
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let longest = 0;
  const lines = volume.lines.map(line => {
    const points = new Float64Array(line.length * 2);
    let length = 0;
    line.forEach((p, i) => {
      const at = map.project([p[0]!, p[1]!], 0);
      points[2 * i] = at.x;
      points[2 * i + 1] = at.y;
      if (at.x < box.x0) box.x0 = at.x;
      if (at.x > box.x1) box.x1 = at.x;
      if (at.y < box.y0) box.y0 = at.y;
      if (at.y > box.y1) box.y1 = at.y;
      if (i) length += Math.hypot(at.x - points[2 * i - 2]!, at.y - points[2 * i - 1]!);
    });
    if (length > longest) longest = length;
    return points;
  });
  made = { lines, box, longest };
  projected.set(volume, made);
  return made;
}

/**
 * The Class B, C and D lines drawn on a canvas kept on the chart, as the
 * airports' marks and the airspace's altitudes are (ViewCanvasLayer):
 * moved with the map's pane under a finger and drawn again as the view
 * nears what was drawn, and drawn afresh at each frame of a pinch or a
 * zoom's animation at its own width. Drawn on Leaflet's SVG, a ring was cut straight where
 * its renderer's box had been -- the view and a tenth round it, placed
 * only as a move ends -- at the owner's screenshots of 2026-11-02
 * (Minneapolis' and Kansas City's Class B, through a pan) and 2026-11-03
 * (Chicago's, cut down the middle of the screen at rest after a pinch).
 * A volume's lines come in at once, with the chart's tiles, not faded in
 * as the marks are: the fade was a fifth of a second more before the
 * rings were there after every zoom (the owner, 2026-11-03: "why do the
 * rings take a while to redraw?"). What is drawn is written on the canvas for
 * the browser tests (`data-airspace-lines`: how many volumes of each
 * class). Not a target: the taps are AirspaceLayer's own unseen lines.
 */
export class AirspaceLinesLayer extends ViewCanvasLayer {
  /** Drawn again at every frame of a pinch and of a zoom's animation, at
   *  their own width and where the chart's tiles then are, as the
   *  airports' marks are (AirportCanvas, the same `warp`). Scaled with
   *  the chart instead, as Leaflet's own canvas is, the rings' strokes
   *  grew with it: eight times their width through the location arrow's
   *  zoom of three levels, and two and a half times under a pinch until
   *  the fingers lifted (the owner's recordings, 2026-11-03 09:21 and
   *  09:24, after the canvases were left in sight through a big zoom).
   *  One drawing is a few thousand line segments from projections kept at
   *  zoom 0: 10 to 50 ms at CPU 4x on the phone viewport. */
  protected override redrawWhileZooming = true;
  private volumes: AirspaceVolume[] = [];
  private written = "";
  private writtenRings = "";

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this.canvas!.dataset.airspaceLines ||= "{}";
    return this;
  }

  set(volumes: AirspaceVolume[]): void {
    this.volumes = volumes;
    this.schedule();
  }

  /** The volume whose line is nearest a point of the map's container,
   *  within `withinPx` of it; null where none is. A tap on a ring opens
   *  its card this way (AirspaceLayer), where each volume had an unseen
   *  20 px line of Leaflet's SVG over its own: fifty of them, projected
   *  and written out again at every zoom's end and made anew with each
   *  box's answer, a tenth of the main thread's work after a zoom (a
   *  profile on the phone viewport at CPU 4x, 2026-11-03). The lines in
   *  sight are the kept zoom-0 projections, so the nearest is found by
   *  arithmetic alone. */
  volumeAt(at: L.Point, withinPx: number): AirspaceVolume | null {
    const map = this._map;
    if (!map) return null;
    const k = map.getZoomScale(map.getZoom(), 0);
    // The point in zoom-0 pixels (its layer point plus the pixel origin
    // is its projection at the map's zoom), and how far `withinPx` is there.
    const layer = map.containerPointToLayerPoint(at);
    const pixelOrigin = map.getPixelOrigin();
    const px = (layer.x + pixelOrigin.x) / k, py = (layer.y + pixelOrigin.y) / k, within = withinPx / k;
    let best: { volume: AirspaceVolume; d2: number } | null = null;
    for (const volume of this.volumes) {
      const { lines, box } = projectedOf(map, volume);
      if (px < box.x0 - within || px > box.x1 + within || py < box.y0 - within || py > box.y1 + within) continue;
      for (const points of lines) {
        for (let i = 2; i < points.length; i += 2) {
          const d2 = segmentDistance2(px, py, points[i - 2]!, points[i - 1]!, points[i]!, points[i + 1]!);
          if (d2 <= within * within && (!best || d2 < best.d2)) best = { volume, d2 };
        }
      }
    }
    return best?.volume ?? null;
  }

  protected paint(ctx: CanvasRenderingContext2D, { map, size, pad, origin, from, warp }: CanvasView): void {
    const zoom = map.getZoom();
    // Where the chart has a point of the map's present zoom at this frame
    // of a zoom's animation: `warp` is affine with one scale, so two
    // points give it, and each ring's points are moved by arithmetic
    // rather than by a Point made for each (thousands a frame).
    const w0 = warp(ORIGIN), w1 = warp(UNIT);
    const ws = w1.x - w0.x, wx = w0.x, wy = w0.y;
    // A zoom-0 point p is at p * k - (ox, oy) on this canvas.
    const k = map.getZoomScale(zoom, 0) * ws;
    const pixelOrigin = map.getPixelOrigin();
    const ox = (pixelOrigin.x + origin.x - from.x) * ws - wx, oy = (pixelOrigin.y + origin.y - from.y) * ws - wy;
    const left = -pad.x, top = -pad.y, right = size.x + pad.x, bottom = size.y + pad.y;
    const counts = { B: 0, C: 0, D: 0 };
    // At rest, a point of each ring in sight for the browser tests to tap
    // (data-airspace-rings), where they found one on the SVG's own line.
    const resting = ws === 1 && wx === 0 && wy === 0 && !(map as L.Map & { touchZoom?: { _zooming?: boolean } }).touchZoom?._zooming;
    const rings: { id: string; class: string; x: number; y: number }[] = [];
    ctx.lineJoin = "round";
    for (const volume of this.volumes) {
      const { lines, box, longest } = projectedOf(map, volume);
      if (box.x1 * k - ox < left || box.x0 * k - ox > right || box.y1 * k - oy < top || box.y0 * k - oy > bottom) continue;
      if (resting) {
        // A few points round each ring, so one is clear of the marks and
        // of a phone's sheet.
        let kept = 0;
        for (const points of lines) {
          const step = Math.max(2, Math.floor(points.length / RING_POINTS / 2) * 2);
          for (let i = 0; i < points.length && kept < RING_POINTS; i += step) {
            const x = points[i]! * k - ox, y = points[i + 1]! * k - oy;
            if (x >= 0 && y >= 0 && x <= size.x && y <= size.y) {
              rings.push({ id: volume.id, class: volume.airspace_class, x: Math.round(x), y: Math.round(y) });
              kept++;
            }
          }
          if (kept >= RING_POINTS) break;
        }
      }
      const style = AIRSPACE_LINE[volume.airspace_class];
      ctx.globalAlpha = style.opacity ?? 1;
      ctx.strokeStyle = style.color!;
      ctx.lineWidth = style.weight!;
      if (volume.airspace_class === "D") {
        ctx.setLineDash(ringDashes(longest * k));
        ctx.lineCap = "butt";
      } else {
        ctx.setLineDash(NO_DASH);
        ctx.lineCap = "round";
      }
      ctx.beginPath();
      for (const points of lines) {
        for (let i = 0; i < points.length; i += 2) {
          const x = points[i]! * k - ox, y = points[i + 1]! * k - oy;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
      }
      ctx.stroke();
      counts[volume.airspace_class]++;
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash(NO_DASH);
    // Written down for the tests as what is drawn changes, not at every
    // drawing: each write restyled the page.
    const written = JSON.stringify(counts);
    if (written !== this.written) {
      this.written = written;
      this.canvas!.dataset.airspaceLines = written;
    }
    if (resting) {
      const tappable = JSON.stringify(rings);
      if (tappable !== this.writtenRings) {
        this.writtenRings = tappable;
        this.canvas!.dataset.airspaceRings = tappable;
      }
    }
  }
}
