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
    map.on("move moveend zoom resize viewreset", this.schedule, this);
    map.on("zoomanim", this.animate, this);
    this.draw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("move moveend zoom resize viewreset", this.schedule, this);
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

  private schedule(): void {
    if (this.frame || !this.canvas) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
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
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint(from));
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
    for (const mark of this.marks) {
      const at = map.latLngToContainerPoint([mark.lat, mark.lon]);
      if (at.x < -pad.x - half || at.y < -pad.y - half || at.x > size.x + pad.x + half || at.y > size.y + pad.y + half) continue;
      written.push({
        ident: mark.ident, x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10, chip: mark.chip,
        space: mark.space ?? "", use: mark.use ?? "", weather: mark.weather,
      });
      if (!mark.chip) continue;
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
