import L from "leaflet";
import type { AirspaceClass } from "../preferences";
import { prefersReducedMotion } from "../motion";
import { AIRPORT_MARK, airportMarkSvg } from "./airportMark";
import { FadeIn } from "./fadeIn";
import { ViewCanvasLayer, type CanvasView } from "./ViewCanvas";

/** One field the chart's airports layer draws (AirportsLayer): its mark
 *  and ident where it wears one (`chip`), else nothing -- the chart's own
 *  symbol is there -- but a place a tap a little off is its own. */
export interface CanvasMark {
  ident: string;
  lat: number;
  lon: number;
  chip: boolean;
  space: AirspaceClass | null;
  weather: string;
  use: "military" | "private" | null;
}

/** The ident's type beside the mark, as airportMarkIcon set it. */
const LABEL_PX = 11;
const LABEL_INK = "#1c1a17";

/** Each look of mark rasterised once from its SVG, at twice its size for
 *  a sharp draw on a dense screen. */
const pictures = new Map<string, HTMLImageElement>();

function pictureOf(mark: CanvasMark, loaded: () => void): HTMLImageElement {
  const key = `${mark.space ?? ""}|${mark.weather}|${mark.use ?? ""}`;
  let picture = pictures.get(key);
  if (!picture) {
    const svg = airportMarkSvg(mark.space, mark.weather, mark.use, "")
      .replace(`width="${AIRPORT_MARK}" height="${AIRPORT_MARK}"`, `width="${AIRPORT_MARK * 2}" height="${AIRPORT_MARK * 2}"`)
      .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" `);
    picture = new Image();
    picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    pictures.set(key, picture);
  }
  if (!picture.complete) picture.addEventListener("load", loaded, { once: true });
  return picture;
}

/** Room round a mark's sprite for its shadow, points. */
const SHADOW_ROOM = 2;

/** Each look of mark drawn once with its drop shadow, at the canvas's
 *  density: a shadow drawn with each mark is a blur of its own, and a
 *  zoom draws every mark at every frame (ViewCanvas's redrawWhileZooming). */
const sprites = new Map<string, HTMLCanvasElement>();

function spriteOf(mark: CanvasMark, dpr: number, loaded: () => void): HTMLCanvasElement | null {
  const key = `${mark.space ?? ""}|${mark.weather}|${mark.use ?? ""}|${dpr}`;
  const made = sprites.get(key);
  if (made) return made;
  const picture = pictureOf(mark, loaded);
  if (!picture.complete || !picture.naturalWidth) return null;
  const side = AIRPORT_MARK + 2 * SHADOW_ROOM;
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = Math.ceil(side * dpr);
  const ctx = sprite.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  // airportMarkIcon's drop-shadow(0 1px 1px rgba(0,0,0,.35)).
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = dpr;
  ctx.shadowOffsetY = dpr;
  ctx.drawImage(picture, SHADOW_ROOM, SHADOW_ROOM, AIRPORT_MARK, AIRPORT_MARK);
  sprites.set(key, sprite);
  return sprite;
}

/** The fields whose marks have been drawn in the session, by ident: one
 *  new fades in, one drawn before -- panned off and back, zoomed out of
 *  and in again, in a new box's answer -- is there at once (fadeIn). */
const fades = new FadeIn();

/** Room round an ident's sprite for its halo, points. */
const HALO_ROOM = 3;
/** The most idents kept drawn: a few screens' worth, then begun again. */
const MOST_LABELS = 800;

/** Each ident drawn once, dark on its white halo, at the canvas's density:
 *  text drawn twice over (the halo, then the letters) for every field at
 *  every frame of a zoom was most of the canvas's paint. */
const labels = new Map<string, HTMLCanvasElement>();

function labelOf(ctx: CanvasRenderingContext2D, ident: string, font: string, dpr: number): HTMLCanvasElement | null {
  const key = `${ident}|${font}|${dpr}`;
  const made = labels.get(key);
  if (made) return made;
  if (labels.size >= MOST_LABELS) labels.clear();
  const width = ctx.measureText(ident).width + 2 * HALO_ROOM;
  const height = LABEL_PX + 2 * HALO_ROOM;
  const label = document.createElement("canvas");
  label.width = Math.ceil(width * dpr);
  label.height = Math.ceil(height * dpr);
  const own = label.getContext("2d");
  if (!own) return null;
  own.scale(dpr, dpr);
  own.font = font;
  own.textBaseline = "middle";
  own.lineJoin = "round";
  own.strokeStyle = "#fff";
  own.lineWidth = 3.5;
  own.strokeText(ident, HALO_ROOM, height / 2);
  own.fillStyle = LABEL_INK;
  own.fillText(ident, HALO_ROOM, height / 2);
  labels.set(key, label);
  return label;
}

/**
 * The chart's airports on one canvas, where each was a Leaflet marker of
 * its own -- a div, an SVG and a label, and a 44-point SVG circle for the
 * fields with no mark: crossing a zoom where more fields come into sight
 * made 900 of them at once, 2.4 s of a phone's main thread at a quarter of
 * a laptop's speed (the 23 Oct audit's zoom, 2026-10-23). The same look,
 * drawn: the mark (airportMarkSvg) with its drop shadow and the ident in
 * dark on a white halo. Out of the pointer's way (pointer-events none):
 * taps are the map's own click, given to the nearest field within a
 * finger's half-width (AirportsLayer), as they were for a tap a little off
 * a mark. Kept on the chart through pans and zooms as ViewCanvasLayer
 * keeps it. What is drawn is written on the canvas, for the browser tests
 * (`data-airport-marks`: each field's ident and where it is in the map's
 * own pixels).
 */
export class AirportMarksLayer extends ViewCanvasLayer {
  private marks: CanvasMark[] = [];
  private font = "";
  /** Whether the fields written on the canvas are older than its marks. */
  private unwritten = true;

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this.canvas!.dataset.airportMarks ||= "[]";
    return this;
  }

  setMarks(marks: CanvasMark[]): void {
    this.marks = marks;
    this.unwritten = true;
    this.schedule();
  }

  /** The marks' places projected once at zoom 0 (Leaflet's Web Mercator
   *  is the one projection scaled), for the marks array they were made
   *  for: a frame of a zoom projected all thousand fields again, four
   *  Points made for each, and paint was the largest piece of JavaScript
   *  in a zoom (Session2's profile, 2026-11-03: about 100 ms a frame
   *  unthrottled at a zoom's end). */
  private projected: { marks: CanvasMark[]; xs: Float64Array; ys: Float64Array } | null = null;

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
    this.font ||= `700 ${LABEL_PX}px ${getComputedStyle(map.getContainer()).fontFamily || "system-ui, sans-serif"}`;
    ctx.font = this.font;
    const moving = warp(from) !== from || !!(map as L.Map & { touchZoom?: { _zooming?: boolean } }).touchZoom?._zooming;
    // At rest each sprite on a whole device pixel, as crisp as the text it
    // was drawn from; under a zoom at its exact place, as the marks were.
    const px = (v: number) => (moving ? v : Math.round(v * dpr) / dpr);
    const half = AIRPORT_MARK / 2;
    // Each mark at its exact place, to the fraction of a point, as the
    // chart's tiles are while a pinch or a flight zooms (pinch.ts): by the
    // layer's own origin, where latLngToContainerPoint rounds the
    // projection to a whole point. On a 3x phone each mark stepped a point
    // at a time against the chart sliding smoothly under it, and back as
    // the rounding turned -- the owner's recording, 2026-10-27, "map markers
    // show jitter when zooming in": KARR's mark moved only in whole points
    // (568.2, 565.2, 568.2, 565.1 device pixels a frame apart) through a
    // slow pinch. The container's point is the layer's less the canvas's
    // layer origin, plus where the canvas starts (`from`): a zoom-0 point
    // p is at p * k - (ox, oy); and where the chart has it at this frame
    // of a zoom's animation is `warp` of that, affine with one scale, so
    // two points give it and the rest is arithmetic (the rings the same).
    const pixelOrigin = map.getPixelOrigin();
    const k = map.getZoomScale(map.getZoom(), 0);
    const ox = pixelOrigin.x + origin.x - from.x, oy = pixelOrigin.y + origin.y - from.y;
    const w0 = warp(ORIGIN), w1 = warp(UNIT);
    const ws = w1.x - w0.x, wx = w0.x, wy = w0.y;
    const { xs, ys } = this.projectedOf(map);
    // Every field written, in sight or not, as every marker was in the
    // page -- for the tests, as the marks change and as the map comes to
    // rest, not at each frame of a zoom: a thousand fields' places made
    // into a string and set on the page every frame.
    const writing = this.unwritten || !moving;
    const written: { ident: string; x: number; y: number; chip: boolean; space: string; use: string; weather: string }[] = [];
    const now = performance.now();
    const still = prefersReducedMotion();
    let fading = false;
    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i]!;
      const x = xs[i]! * k - ox, y = ys[i]! * k - oy;
      if (writing) {
        written.push({
          ident: mark.ident, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, chip: mark.chip,
          space: mark.space ?? "", use: mark.use ?? "", weather: mark.weather,
        });
      }
      if (!mark.chip) continue;
      // Drawn only where the canvas reaches.
      const sx = x * ws + wx, sy = y * ws + wy;
      if (sx < -pad.x - half || sy < -pad.y - half || sx > size.x + pad.x + half || sy > size.y + pad.y + half) continue;
      // A field's mark new to the session fades in from this drawing; one
      // drawn before is whole at once (fadeIn).
      const alpha = fades.alpha(mark.ident, now, still);
      if (alpha < 1) {
        ctx.globalAlpha = alpha;
        fading = true;
      }
      const sprite = spriteOf(mark, dpr, () => this.schedule());
      if (sprite) ctx.drawImage(sprite, px(sx - half - SHADOW_ROOM), px(sy - half - SHADOW_ROOM), sprite.width / dpr, sprite.height / dpr);
      // The ident one point clear of the mark, dark on a white halo, as
      // the chart letters a field.
      const label = labelOf(ctx, mark.ident, this.font, dpr);
      if (label) ctx.drawImage(label, px(sx + half + 1 - HALO_ROOM), px(sy - label.height / dpr / 2), label.width / dpr, label.height / dpr);
      ctx.globalAlpha = 1;
    }
    // Drawn again next frame while any is still coming in.
    if (fading) this.schedule();
    if (writing) {
      canvas.dataset.airportMarks = JSON.stringify(written);
      this.unwritten = false;
    }
  }
}

/** Two points that give a frame's `warp` (paint). */
const ORIGIN = L.point(0, 0);
const UNIT = L.point(1, 0);
