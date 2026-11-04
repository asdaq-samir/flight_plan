import L from "leaflet";
import { prefersReducedMotion } from "../motion";
import { BLUE } from "../useAirspace";
import { WAYPOINT_MAGENTA } from "./chartColors";
import type { TagSide } from "./declutter";
import { FadeIn } from "./fadeIn";
import { ViewCanvasLayer, type CanvasView } from "./ViewCanvas";

/** One VOR or fix the navaids layer draws (NavaidsLayer): where it is,
 *  which mark it wears, and for a VOR which side its ident tag sits. */
export interface NavaidMark {
  key: string;
  ident: string;
  lat: number;
  lon: number;
  /** A VOR, an enroute fix (a GPS waypoint), or a VFR waypoint, which
   *  wears the fix's triangle and ident in the chart's magenta (the
   *  owner, 2026-11-04: "The VFR waypoints should look/behave similar to
   *  gps waypoints, just in different color"). */
  kind: "vor" | "fix" | "vfr";
  side: TagSide;
}

/** The marks as their icons drew them (airspaceMarks' vorIcon and
 *  enrouteFixIcon, now gone): the VOR's hexagon 16 across, the fix's
 *  triangle 10, each centred on the station. */
const HEXAGON_PX = 16;
const TRIANGLE_PX = 10;
const FIX_INK = "#1c1a17";
/** The idents in 11 px bold, the map's smallest type. */
const TEXT_PX = 11;
/** A VOR's tag: 11 px off the station, 14 tall, the ident with 4 px
 *  either side on the chart's blue (declutter's vorTagBoxes agrees). */
const TAG_GAP = 11;
const TAG_HEIGHT = 14;
const TAG_PAD = 4;
const TAG_RADIUS = 3;
/** A fix's ident 7 px right of the station, dark on a white halo. */
const FIX_LABEL_GAP = 7;
const HALO_ROOM = 3;
/** The stations and waypoints drawn in the session, by their mark's key
 *  (a VOR's ident and latitude, `fix-` or `vfr-` and the ident): one new
 *  fades in, one drawn before is there at once (fadeIn). One for both
 *  layers this module draws -- the VORs and fixes, the VFR waypoints --
 *  which are made again each time the map zooms back in to their level. */
const fades = new FadeIn();
/** The most idents' pictures kept before the lot is drawn again. */
const MOST_PICTURES = 800;

/** Two points that give a frame's `warp` (paint). */
const ORIGIN = L.point(0, 0);
const UNIT = L.point(1, 0);

/** The two marks' shapes rasterised once from their SVG, at twice their
 *  size for a sharp draw on a dense screen (AirportCanvas the same). */
const shapes = new Map<string, HTMLImageElement>();

function shapeOf(kind: NavaidMark["kind"], loaded: () => void): HTMLImageElement {
  let picture = shapes.get(kind);
  if (!picture) {
    const svg = kind === "vor"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${HEXAGON_PX * 2}" height="${HEXAGON_PX * 2}" viewBox="0 0 16 16">` +
        `<polygon points="15,8 11.5,14.06 4.5,14.06 1,8 4.5,1.94 11.5,1.94" fill="#fff" stroke="${BLUE}" stroke-width="2"/>` +
        `<circle cx="8" cy="8" r="1.6" fill="${BLUE}"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${TRIANGLE_PX * 2}" height="${TRIANGLE_PX * 2}" viewBox="0 0 10 10">` +
        `<polygon points="5,1 9.4,8.8 0.6,8.8" fill="#fff" stroke="${kind === "vfr" ? WAYPOINT_MAGENTA : FIX_INK}" stroke-width="${kind === "vfr" ? 1.6 : 1.2}" stroke-linejoin="round"/></svg>`;
    picture = new Image();
    picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    shapes.set(kind, picture);
  }
  if (!picture.complete) picture.addEventListener("load", loaded, { once: true });
  return picture;
}

/** Each ident drawn once at the canvas's density -- a VOR's white on its
 *  blue tag, a fix's dark on a white halo -- and copied at every frame:
 *  text drawn out for every station at every frame of a zoom was most of
 *  the airports' canvas's paint before its labels were kept (AirportCanvas). */
const pictures = new Map<string, HTMLCanvasElement>();

function pictureOf(mark: NavaidMark, font: string, dpr: number): HTMLCanvasElement | null {
  const key = `${mark.kind}|${mark.ident}|${font}|${dpr}`;
  const made = pictures.get(key);
  if (made) return made;
  if (pictures.size >= MOST_PICTURES) pictures.clear();
  const picture = document.createElement("canvas");
  const own = picture.getContext("2d");
  if (!own) return null;
  own.font = font;
  const text = own.measureText(mark.ident).width;
  const width = mark.kind === "vor" ? text + 2 * TAG_PAD : text + 2 * HALO_ROOM;
  const height = mark.kind === "vor" ? TAG_HEIGHT : TEXT_PX + 2 * HALO_ROOM;
  picture.width = Math.ceil(width * dpr);
  picture.height = Math.ceil(height * dpr);
  // Sizing the canvas resets its state.
  own.scale(dpr, dpr);
  own.font = font;
  own.textAlign = "center";
  own.textBaseline = "middle";
  if (mark.kind === "vor") {
    own.fillStyle = BLUE;
    own.beginPath();
    own.roundRect(0, 0, width, height, TAG_RADIUS);
    own.fill();
    own.fillStyle = "#fff";
  } else {
    own.lineJoin = "round";
    own.lineWidth = HALO_ROOM;
    own.strokeStyle = "#fff";
    own.strokeText(mark.ident, width / 2, height / 2);
    own.fillStyle = mark.kind === "vfr" ? WAYPOINT_MAGENTA : FIX_INK;
  }
  own.fillText(mark.ident, width / 2, height / 2);
  pictures.set(key, picture);
  return picture;
}

/** The layers on the map, for a tap's or a pointer's question of what is
 *  drawn near a point (navaidAt). */
const layers = new Set<NavaidMarksLayer>();

/** The VOR or fix drawn nearest `point` (the map container's own points)
 *  within `withinPx`, or null: for a tap, given to the nearest station
 *  within a finger's half-width as the airports' marks are (AirportsLayer),
 *  and for the airspace rings' tap to yield to (AirspaceLayer). */
export function navaidAt(point: L.Point, withinPx: number): NavaidMark | null {
  let best: { mark: NavaidMark; px: number } | null = null;
  for (const layer of layers) {
    const near = layer.nearest(point, withinPx);
    if (near && (!best || near.px < best.px)) best = near;
  }
  return best?.mark ?? null;
}

/**
 * The VORs and the low enroute chart's fixes on one canvas, where each
 * was two Leaflet markers of its own -- its mark and a 44-point tap
 * target: 308 of them over Chicago at zoom 10, torn down and made again
 * with each box the map asked for, a third of the JavaScript of a zoom on
 * the phone viewport at 4x (a profile, 2026-11-03). The same look, drawn
 * as the airports' marks are (AirportCanvas): the VOR's blue hexagon with
 * its ident on a blue tag beside it, the fix's small triangle with its
 * ident haloed, kept on the chart through pans and zooms as
 * ViewCanvasLayer keeps it. Out of the pointer's way: taps are the map's
 * own click, given to the nearest station (NavaidsLayer, navaidAt). What
 * is drawn is written on the canvas for the browser tests
 * (`data-navaid-marks`: each station's ident, kind, tag side and where it
 * is in the map's own pixels).
 */
export class NavaidMarksLayer extends ViewCanvasLayer {
  private marks: NavaidMark[] = [];
  private font = "";
  /** Whether the marks written on the canvas are older than its marks. */
  private unwritten = true;
  /** The view they were last written for at rest (AirportCanvas the same). */
  private writtenAt = "";

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this.canvas!.dataset.navaidMarks ||= "[]";
    layers.add(this);
    return this;
  }

  onRemove(map: L.Map): this {
    layers.delete(this);
    return super.onRemove(map);
  }

  setMarks(marks: NavaidMark[]): void {
    this.marks = marks;
    this.unwritten = true;
    this.schedule();
  }

  /** The mark nearest `point` within `withinPx`, and how far. */
  nearest(point: L.Point, withinPx: number): { mark: NavaidMark; px: number } | null {
    const map = this._map;
    if (!map) return null;
    let best: { mark: NavaidMark; px: number } | null = null;
    for (const mark of this.marks) {
      const px = map.latLngToContainerPoint([mark.lat, mark.lon]).distanceTo(point);
      if (px <= withinPx && (!best || px < best.px)) best = { mark, px };
    }
    return best;
  }

  /** The marks' places projected once at zoom 0 (AirportCanvas the same). */
  private projected: { marks: NavaidMark[]; xs: Float64Array; ys: Float64Array } | null = null;

  private projectedOf(map: L.Map): { xs: Float64Array; ys: Float64Array } {
    if (this.projected?.marks === this.marks) return this.projected;
    const n = this.marks.length;
    const xs = new Float64Array(n), ys = new Float64Array(n);
    this.marks.forEach((mark, i) => {
      const at = map.project([mark.lat, mark.lon], 0);
      xs[i] = at.x;
      ys[i] = at.y;
    });
    this.projected = { marks: this.marks, xs, ys };
    return this.projected;
  }

  protected paint(ctx: CanvasRenderingContext2D, { map, size, pad, origin, from, dpr, warp }: CanvasView): void {
    const canvas = this.canvas!;
    this.font ||= `700 ${TEXT_PX}px ${getComputedStyle(map.getContainer()).fontFamily || "system-ui, sans-serif"}`;
    const moving = warp(from) !== from || !!(map as L.Map & { touchZoom?: { _zooming?: boolean } }).touchZoom?._zooming;
    // At rest each picture on a whole device pixel; under a zoom at its
    // exact place (AirportCanvas's paint says why, and the arithmetic).
    const px = (v: number) => (moving ? v : Math.round(v * dpr) / dpr);
    const pixelOrigin = map.getPixelOrigin();
    const k = map.getZoomScale(map.getZoom(), 0);
    const ox = pixelOrigin.x + origin.x - from.x, oy = pixelOrigin.y + origin.y - from.y;
    const w0 = warp(ORIGIN), w1 = warp(UNIT);
    const ws = w1.x - w0.x, wx = w0.x, wy = w0.y;
    const { xs, ys } = this.projectedOf(map);
    // Written as the marks change and once at rest for each view, not
    // again at each frame of a fade there (AirportCanvas says why).
    const at = `${k}|${ox}|${oy}`;
    const writing = this.unwritten || (!moving && at !== this.writtenAt);
    const written: { ident: string; kind: string; side: string; x: number; y: number }[] = [];
    const now = performance.now();
    const still = prefersReducedMotion();
    let fading = false;
    const reach = HEXAGON_PX + TAG_GAP + 8 * TEXT_PX;
    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i]!;
      const x = xs[i]! * k - ox, y = ys[i]! * k - oy;
      if (writing) written.push({ ident: mark.ident, kind: mark.kind, side: mark.side, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
      // Drawn only where the canvas reaches, the tag counted.
      const sx = x * ws + wx, sy = y * ws + wy;
      if (sx < -pad.x - reach || sy < -pad.y - reach || sx > size.x + pad.x + reach || sy > size.y + pad.y + reach) continue;
      // A station new to the session fades in from this drawing; one drawn
      // before is whole at once (fadeIn).
      const alpha = fades.alpha(mark.key, now, still);
      if (alpha < 1) {
        ctx.globalAlpha = alpha;
        fading = true;
      }
      const shape = shapeOf(mark.kind, () => this.schedule());
      const side = mark.kind === "vor" ? HEXAGON_PX : TRIANGLE_PX;
      if (shape.complete && shape.naturalWidth) ctx.drawImage(shape, px(sx - side / 2), px(sy - side / 2), side, side);
      const picture = mark.kind === "vor" && mark.side === "none" ? null : pictureOf(mark, this.font, dpr);
      if (picture) {
        const w = picture.width / dpr, h = picture.height / dpr;
        const left = mark.kind !== "vor" ? sx + FIX_LABEL_GAP - HALO_ROOM : mark.side === "left" ? sx - TAG_GAP - w : sx + TAG_GAP;
        ctx.drawImage(picture, px(left), px(sy - h / 2), w, h);
      }
      ctx.globalAlpha = 1;
    }
    if (fading) this.schedule();
    if (writing) {
      canvas.dataset.navaidMarks = JSON.stringify(written);
      this.unwritten = false;
      this.writtenAt = moving ? "" : at;
    }
  }
}
