import L from "leaflet";
import type { AirspaceVolume } from "../api/types";
import { prefersReducedMotion } from "../motion";
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
/** How long a volume's lines take to come in, ms, as the marks do. */
const FADE_MS = 200;
/** The most volumes remembered as drawn: a few states' worth. */
const MOST_KEPT = 3000;

/** Whether the map is animating a zoom (Leaflet's own flag, as the
 *  OwnShipLayer reads it). */
const animatingZoom = (map: L.Map | undefined) => !!(map as (L.Map & { _animatingZoom?: boolean }) | undefined)?._animatingZoom;

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
 * nears what was drawn, scaled with the chart through a zoom and drawn
 * again as it ends. Drawn on Leaflet's SVG, a ring was cut straight where
 * its renderer's box had been -- the view and a tenth round it, placed
 * only as a move ends -- at the owner's screenshots of 2026-11-02
 * (Minneapolis' and Kansas City's Class B, through a pan) and 2026-11-03
 * (Chicago's, cut down the middle of the screen at rest after a pinch).
 * A volume's lines coming in for the first time fade in, as the marks do;
 * at once under Reduce Motion. What is drawn is written on the canvas for
 * the browser tests (`data-airspace-lines`: how many volumes of each
 * class). Not a target: the taps are AirspaceLayer's own unseen lines.
 */
export class AirspaceLinesLayer extends ViewCanvasLayer {
  /** Scaled with the chart through a zoom's animation and drawn again as
   *  it ends, as Leaflet's own canvas is: the lines lie on the chart's
   *  printed ones and grow with them, so no frame of the animation needs
   *  them drawn afresh, and `warp` is never other than the identity here. */
  protected override redrawWhileZooming = false;
  private volumes: AirspaceVolume[] = [];
  private written = "";
  /** The volumes drawn once, which come in without a fade again. */
  private readonly drawnOnce = new Set<string>();
  /** When each volume was first drawn, while it fades in. */
  private readonly born = new Map<string, number>();

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this.canvas!.dataset.airspaceLines ||= "{}";
    // Drawn as a zoom's animation ends, for what came in through it (below).
    map.on("zoomend", this.schedule, this);
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("zoomend", this.schedule, this);
    return super.onRemove(map);
  }

  set(volumes: AirspaceVolume[]): void {
    this.volumes = volumes;
    this.schedule();
  }

  /** Not drawn through a zoom's animation (a double tap's, a fitted
   *  route's, the end of a pinch): the map's pane has Leaflet's
   *  .leaflet-zoom-anim then, under which every change of the canvas's
   *  transform is a 0.25 s transition, so a drawing placed mid-way --
   *  the next class's rings arriving as the zoom crossed their level --
   *  was carried across the screen from where the animation had the
   *  canvas to where the new drawing put it, Dallas's Class B gliding up
   *  past Oklahoma City and back (the owner's recording, 2026-11-03,
   *  05:51). Leaflet's own renderer skips its update through one the same
   *  way. The zoom's end draws it (zoomend, above). */
  protected override schedule(): void {
    if (animatingZoom(this._map)) return;
    super.schedule();
  }

  protected paint(ctx: CanvasRenderingContext2D, { map, size, pad, origin, from }: CanvasView): void {
    // Added to the map mid-animation (the layer comes with its zoom), the
    // canvas is placed but left blank until the zoom ends, as above.
    if (animatingZoom(map)) return;
    const zoom = map.getZoom();
    const k = map.getZoomScale(zoom, 0);
    const pixelOrigin = map.getPixelOrigin();
    // A zoom-0 point p is at p * k - (ox, oy) on this canvas.
    const ox = pixelOrigin.x + origin.x - from.x, oy = pixelOrigin.y + origin.y - from.y;
    const left = -pad.x, top = -pad.y, right = size.x + pad.x, bottom = size.y + pad.y;
    const now = performance.now();
    let fading = false;
    const counts = { B: 0, C: 0, D: 0 };
    ctx.lineJoin = "round";
    for (const volume of this.volumes) {
      const { lines, box, longest } = projectedOf(map, volume);
      if (box.x1 * k - ox < left || box.x0 * k - ox > right || box.y1 * k - oy < top || box.y0 * k - oy > bottom) continue;
      const style = AIRSPACE_LINE[volume.airspace_class];
      if (!this.drawnOnce.has(volume.id)) {
        if (this.drawnOnce.size > MOST_KEPT) this.drawnOnce.clear();
        this.drawnOnce.add(volume.id);
        if (!prefersReducedMotion()) this.born.set(volume.id, now);
      }
      const born = this.born.get(volume.id);
      let alpha = 1;
      if (born !== undefined) {
        alpha = (now - born) / FADE_MS;
        if (alpha >= 1) {
          this.born.delete(volume.id);
          alpha = 1;
        } else fading = true;
      }
      ctx.globalAlpha = (style.opacity ?? 1) * Math.max(0, alpha);
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
    if (fading) this.schedule();
    // Written down for the tests as what is drawn changes, not at every
    // drawing: each write restyled the page.
    const written = JSON.stringify(counts);
    if (written !== this.written) {
      this.written = written;
      this.canvas!.dataset.airspaceLines = written;
    }
  }
}
