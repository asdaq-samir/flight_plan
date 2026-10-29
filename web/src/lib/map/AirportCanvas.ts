import L from "leaflet";
import type { AirspaceClass } from "../preferences";
import { AIRPORT_MARK, airportMarkSvg } from "./airportMark";

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

/** How far round the view the canvas reaches, a share of it each side:
 *  a pan shows marks already there as it starts, redrawn when it ends. */
const PAD = 0.25;
/** The most device pixels a CSS pixel is drawn at: a phone's 3 made a
 *  padded canvas 30 MB. */
const MOST_DPR = 2;
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
 * a mark. Moved with the map in its pane, scaled with it through a zoom's
 * animation as Leaflet scales its own canvas, and drawn again as each
 * move or zoom ends. What is drawn is written on the canvas, for the
 * browser tests (`data-airport-marks`: each field's ident and where it is
 * in the map's own pixels).
 */
export class AirportMarksLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private marks: CanvasMark[] = [];
  private frame = 0;
  private topLeft: L.LatLng | null = null;
  /** The zoom the drawing is for. */
  private drawnZoom = 0;
  /** What the last drawing covers, in the map's layer points. */
  private drawn: L.Bounds | null = null;
  private font = "";

  constructor(pane: string) {
    super();
    // Leaflet's classes take their options in initialize, which an ES
    // subclass's constructor does not reach: set here, or it is the
    // overlay pane's, under the selected field's ring.
    L.setOptions(this, { pane });
  }

  onAdd(map: L.Map): this {
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-animated", map.getPane(this.options.pane!));
    canvas.style.pointerEvents = "none";
    canvas.dataset.airportMarks = "[]";
    this.canvas = canvas;
    this.font = `700 ${LABEL_PX}px ${getComputedStyle(map.getContainer()).fontFamily || "system-ui, sans-serif"}`;
    // Drawn again through a pan too, a frame at a time: past the canvas's
    // edge a long pan's fields came in only as it ended.
    map.on("resize viewreset", this.schedule, this);
    map.on("moveend", this.ended, this);
    map.on("zoom", this.zoomed, this);
    map.on("move", this.moved, this);
    map.on("zoomanim", this.animate, this);
    this.draw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("resize viewreset", this.schedule, this);
    map.off("moveend", this.ended, this);
    map.off("zoom", this.zoomed, this);
    map.off("move", this.moved, this);
    map.off("zoomanim", this.animate, this);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  setMarks(marks: CanvasMark[]): void {
    this.marks = marks;
    this.schedule();
  }

  /** Under a finger's pan the canvas moves with the map's pane already:
   *  drawn again only once the view nears the edge of what was drawn (its
   *  PAD round the screen), not at every frame -- the redraws were most of
   *  a pan's main-thread time on a phone (measured 2026-10-26: drawImage
   *  and the labels 400 ms of a 20-step pan at 4x throttle). As it comes
   *  to rest it is drawn again in full (moveend). */
  private moved(): void {
    const map = this._map;
    if (!map || !this.drawn) return this.schedule();
    const size = map.getSize();
    const margin = size.multiplyBy(PAD / 2);
    const tl = map.containerPointToLayerPoint(L.point(0, 0)).subtract(margin);
    const br = map.containerPointToLayerPoint(size).add(margin);
    if (!this.drawn.contains(tl) || !this.drawn.contains(br)) this.schedule();
  }

  /** A move ended: drawn again only where it left what was drawn, or the
   *  zoom changed. A map following an airplane -- own ship, a dry run's --
   *  ends a small move several times a second, and the whole canvas was
   *  drawn again at each: 56 to 250 ms of three seconds of a dry run at
   *  200x, 4x a phone's (2026-10-29). */
  private ended(): void {
    if (this._map?.getZoom() !== this.drawnZoom) return this.schedule();
    this.moved();
  }

  private schedule(): void {
    if (this.frame || !this.canvas) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** At each step of a pinch (or a flight's zoom), the drawing kept on
   *  the chart at once -- moved and scaled to where the map now puts it,
   *  as Leaflet keeps its own canvas -- and drawn again at the next frame.
   *  Drawn again only, the marks were a step behind the chart in every
   *  other frame and back with it in the next, and shook through a pinch:
   *  the owner, 2026-10-27, "When I zoom in they seem to be vibrating"
   *  (phone project, a pinch in over KATW: the mark 3-4 chart pixels off
   *  and back, frame after frame; the route's own markers 0.3). */
  private zoomed(): void {
    const map = this._map;
    if (map && this.canvas && this.topLeft) {
      const zoom = map.getZoom();
      const at = map.project(this.topLeft, zoom).subtract(map.getPixelOrigin());
      L.DomUtil.setTransform(this.canvas, at, map.getZoomScale(zoom, this.drawnZoom));
    }
    this.schedule();
  }

  /** Through a zoom's animation the canvas scaled and moved where the map
   *  will be, as Leaflet's own layers are; drawn again as it ends. */
  private animate(e: L.ZoomAnimEvent): void {
    const map = this._map as L.Map & { _latLngToNewLayerPoint: (latlng: L.LatLng, zoom: number, center: L.LatLng) => L.Point };
    if (!this.canvas || !this.topLeft) return;
    const scale = map.getZoomScale(e.zoom, map.getZoom());
    L.DomUtil.setTransform(this.canvas, map._latLngToNewLayerPoint(this.topLeft, e.zoom, e.center), scale);
  }

  private draw(): void {
    const map = this._map;
    const canvas = this.canvas;
    if (!map || !canvas) return;
    const size = map.getSize();
    const pad = size.multiplyBy(PAD).round();
    const from = L.point(-pad.x, -pad.y);
    const width = size.x + 2 * pad.x, height = size.y + 2 * pad.y;
    this.topLeft = map.containerPointToLatLng(from);
    this.drawnZoom = map.getZoom();
    const origin = map.containerPointToLayerPoint(from);
    L.DomUtil.setPosition(canvas, origin);
    this.drawn = L.bounds(origin, origin.add(L.point(width, height)));
    const dpr = Math.min(window.devicePixelRatio || 1, MOST_DPR);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, pad.x * dpr, pad.y * dpr);
    ctx.clearRect(-pad.x, -pad.y, width, height);
    ctx.font = this.font;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const half = AIRPORT_MARK / 2;
    const written: { ident: string; x: number; y: number; chip: boolean; space: string; use: string; weather: string }[] = [];
    // Each mark at its exact place, to the fraction of a point, as the
    // chart's tiles are while a pinch or a flight zooms (pinch.ts): by the
    // layer's own origin, where latLngToContainerPoint rounds the
    // projection to a whole point. On a 3x phone each mark stepped a point
    // at a time against the chart sliding smoothly under it, and back as
    // the rounding turned -- the owner's recording, 2026-10-27, "map markers
    // show jitter when zooming in": KARR's mark moved only in whole points
    // (568.2, 565.2, 568.2, 565.1 device pixels a frame apart) through a
    // slow pinch. The container's point is the layer's less the canvas's
    // layer origin, plus where the canvas starts (`from`).
    const pixelOrigin = map.getPixelOrigin();
    for (const mark of this.marks) {
      const at = map.project([mark.lat, mark.lon]).subtract(pixelOrigin).subtract(origin).add(from);
      // Every field written, in sight or not, as every marker was in the
      // page; drawn only where the canvas reaches.
      written.push({
        ident: mark.ident, x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10, chip: mark.chip,
        space: mark.space ?? "", use: mark.use ?? "", weather: mark.weather,
      });
      if (!mark.chip) continue;
      if (at.x < -pad.x - half || at.y < -pad.y - half || at.x > size.x + pad.x + half || at.y > size.y + pad.y + half) continue;
      const picture = pictureOf(mark, () => this.schedule());
      if (picture.complete && picture.naturalWidth) {
        // airportMarkIcon's drop-shadow(0 1px 1px rgba(0,0,0,.35)).
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 1 * dpr;
        ctx.shadowOffsetY = 1 * dpr;
        ctx.drawImage(picture, at.x - half, at.y - half, AIRPORT_MARK, AIRPORT_MARK);
        ctx.shadowColor = "transparent";
      }
      // The ident one point clear of the mark, dark on a white halo, as
      // the chart letters a field.
      const x = at.x + half + 1;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3.5;
      ctx.strokeText(mark.ident, x, at.y);
      ctx.fillStyle = LABEL_INK;
      ctx.fillText(mark.ident, x, at.y);
    }
    canvas.dataset.airportMarks = JSON.stringify(written);
  }
}
