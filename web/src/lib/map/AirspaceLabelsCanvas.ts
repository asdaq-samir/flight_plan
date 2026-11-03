import L from "leaflet";
import { prefersReducedMotion } from "../motion";
import { airportBox, overlaps, type Box, type DrawnField } from "./declutter";
import { spotBox } from "./edgeLabels";
import { ViewCanvasLayer, type CanvasView } from "./ViewCanvas";

/** One label along an airspace line, held to its place on it at every
 *  zoom (edgeLabels' edgeAnchors): the point on the line, the words'
 *  offset from it in screen points, their angle, and the zoom it is
 *  written from. `ink` is a CSS variable's name, read as it is drawn, so
 *  the words follow the theme. */
export interface CanvasEdgeLabel {
  key: string;
  lat: number;
  lon: number;
  dx: number;
  dy: number;
  angle: number;
  from: number;
  text: string;
  ink: string;
}

/** 11 px bold, the map's smallest type (iOS's Caption 2), on a 3 px halo
 *  of the map's ground, as the SVG's words were. */
const TEXT_PX = 11;
const LETTER_PX = 7;
const HEIGHT_PX = 14;
const HALO_PX = 3;
/** No altitudes this close to an airport's mark or its ident, px: the
 *  field is what a pilot reads there. */
const AIRPORT_CLEAR_PX = 20;
/** How long a label takes to come in, ms, as an airport's mark does. */
const FADE_MS = 200;
/** The most labels remembered as drawn: a few flights' worth. */
const MOST_KEPT = 5000;

/** Room round the words on their picture for the halo, px. */
const HALO_ROOM = 3;
/** Pictures kept before the lot is dropped and drawn again as needed. */
const MOST_PICTURES = 600;
const pictures = new Map<string, HTMLCanvasElement>();

/** A label's halo and words drawn once into a picture of their own, that
 *  each frame of a zoom copies at the label's angle: writing out every
 *  label's text twice (halo and ink) at every frame of a pinch was most of
 *  the map's own work under the fingers with the airspace in sight. */
function pictureOf(text: string, font: string, ink: string, halo: string, dpr: number): HTMLCanvasElement | null {
  const key = `${text}|${font}|${ink}|${halo}|${dpr}`;
  const made = pictures.get(key);
  if (made) return made;
  if (pictures.size >= MOST_PICTURES) pictures.clear();
  const picture = document.createElement("canvas");
  const own = picture.getContext("2d");
  if (!own) return null;
  own.font = font;
  const width = own.measureText(text).width + 2 * HALO_ROOM;
  const height = TEXT_PX + 2 * HALO_ROOM;
  picture.width = Math.ceil(width * dpr);
  picture.height = Math.ceil(height * dpr);
  // Sizing the canvas resets its state.
  own.scale(dpr, dpr);
  own.font = font;
  own.textAlign = "center";
  own.textBaseline = "middle";
  own.lineJoin = "round";
  own.lineWidth = HALO_PX;
  own.strokeStyle = halo;
  own.strokeText(text, width / 2, height / 2);
  own.fillStyle = ink;
  own.fillText(text, width / 2, height / 2);
  pictures.set(key, picture);
  return picture;
}

/**
 * The airspace's altitudes written along its lines, on a canvas kept on
 * the chart as the airports' marks are (ViewCanvasLayer): each at its
 * place on its line at every zoom and its size through every zoom -- moved
 * with the chart frame by frame through a pinch and a zoom's animation,
 * where the SVG of them was hidden through each and put back with labels
 * worked out afresh somewhere else (the owner, 2026-11-02: "it's very
 * dynamic while zooming in, I think it needs a bit of stability by
 * design"). Clear of the airports' marks. What is drawn is written on the
 * canvas for the browser tests (`data-airspace-edge-labels`: each label's
 * words and angle).
 */
export class AirspaceLabelsLayer extends ViewCanvasLayer {
  private labels: CanvasEdgeLabel[] = [];
  private fields: DrawnField[] = [];
  private font = "";
  /** The labels changed since what is drawn was last written down. */
  private unwritten = true;
  private colours: { style: CSSStyleDeclaration; halo: string; inks: Map<string, string> } | null = null;
  /** Each label's key: whether an airport's mark keeps it off. */
  private hidden = new Map<string, boolean>();
  /** The labels drawn once, which no airport's mark coming in later takes
   *  away again: a zoom that brought in the fields with no report took
   *  every label near one off with it, "80/30" there and gone a step in
   *  (the owner's audit of the overlays, 2026-11-02). The mark is drawn
   *  over the label where they meet. */
  private readonly drawnOnce = new Set<string>();
  /** When each label was first drawn, while it fades in. */
  private readonly born = new Map<string, number>();

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this.canvas!.dataset.airspaceEdgeLabels ||= "[]";
    return this;
  }

  set(labels: CanvasEdgeLabel[], fields: DrawnField[]): void {
    this.labels = labels;
    this.fields = fields;
    this.unwritten = true;
    this.hidden.clear();
    this.schedule();
  }

  protected paint(ctx: CanvasRenderingContext2D, { map, size, pad, origin, from, dpr, warp }: CanvasView): void {
    const canvas = this.canvas!;
    const moving = warp(from) !== from || !!(map as L.Map & { touchZoom?: { _zooming?: boolean } }).touchZoom?._zooming;
    // The theme's colours read at rest and kept through a zoom: reading a
    // computed style at every frame made the browser work the page's
    // styles out again under the fingers.
    if (!moving || !this.colours) {
      const style = getComputedStyle(map.getContainer());
      this.font ||= `700 ${TEXT_PX}px ${style.fontFamily || "system-ui, sans-serif"}`;
      this.colours = { style, halo: style.getPropertyValue("--airspace-halo").trim() || "#fff", inks: new Map() };
    }
    const colours = this.colours;
    const zoom = map.getZoom();
    const pixelOrigin = map.getPixelOrigin();
    // Where a place is on this canvas, unrounded and as the chart has it
    // at this frame of a zoom (AirportCanvas' marks the same way).
    const here = (lat: number, lon: number) => warp(map.project([lat, lon]).subtract(pixelOrigin).subtract(origin).add(from));
    // Which labels an airport's mark keeps off, worked out at rest and kept
    // through a zoom (a label not yet asked about is worked out as it comes).
    if (!moving) this.hidden.clear();
    let clear: Box[] | null = null;
    const hidden = (label: CanvasEdgeLabel, x: number, y: number, width: number) => {
      if (this.drawnOnce.has(label.key)) return false;
      const known = this.hidden.get(label.key);
      if (known !== undefined) return known;
      clear ??= this.fields.map(f => {
        const b = airportBox(here(f.lat, f.lon), f.ident);
        return { x0: b.x0 - AIRPORT_CLEAR_PX, y0: b.y0 - AIRPORT_CLEAR_PX, x1: b.x1 + AIRPORT_CLEAR_PX, y1: b.y1 + AIRPORT_CLEAR_PX };
      });
      const off = clear.some(b => overlaps(b, spotBox({ x, y, angle: label.angle }, width, HEIGHT_PX)));
      this.hidden.set(label.key, off);
      return off;
    };
    const written: { text: string; angle: number }[] = [];
    const now = performance.now();
    let fading = false;
    for (const label of this.labels) {
      if (label.from > zoom + 1e-6) continue;
      const on = here(label.lat, label.lon);
      const x = on.x + label.dx, y = on.y + label.dy;
      const width = label.text.length * LETTER_PX;
      if (x < -pad.x - width || y < -pad.y - width || x > size.x + pad.x + width || y > size.y + pad.y + width) continue;
      if (hidden(label, x, y, width)) continue;
      let ink = colours.inks.get(label.ink);
      if (!ink) {
        ink = colours.style.getPropertyValue(label.ink).trim() || "#086bd8";
        colours.inks.set(label.ink, ink);
      }
      const picture = pictureOf(label.text, this.font, ink, colours.halo, dpr);
      if (!picture) continue;
      const w = picture.width / dpr, h = picture.height / dpr;
      // A label drawn for the first time fades in, as the airports' marks
      // do (AirportCanvas); at once under Reduce Motion.
      if (!this.drawnOnce.has(label.key)) {
        if (this.drawnOnce.size > MOST_KEPT) this.drawnOnce.clear();
        this.drawnOnce.add(label.key);
        if (!prefersReducedMotion()) this.born.set(label.key, now);
      }
      const born = this.born.get(label.key);
      let alpha = 1;
      if (born !== undefined) {
        alpha = (now - born) / FADE_MS;
        if (alpha >= 1) {
          this.born.delete(label.key);
          alpha = 1;
        } else fading = true;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(x, y);
      ctx.rotate((label.angle * Math.PI) / 180);
      ctx.drawImage(picture, -w / 2, -h / 2, w, h);
      ctx.restore();
      written.push({ text: label.text, angle: label.angle });
    }
    if (fading) this.schedule();
    // Written down for the tests as the labels change and as the map
    // rests, not at every frame of a zoom: each write restyled the page.
    if (this.unwritten || !moving) {
      canvas.dataset.airspaceEdgeLabels = JSON.stringify(written);
      this.unwritten = false;
    }
  }
}
