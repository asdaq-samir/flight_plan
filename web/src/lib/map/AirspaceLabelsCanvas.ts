import L from "leaflet";
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

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this.canvas!.dataset.airspaceEdgeLabels ||= "[]";
    return this;
  }

  set(labels: CanvasEdgeLabel[], fields: DrawnField[]): void {
    this.labels = labels;
    this.fields = fields;
    this.schedule();
  }

  protected paint(ctx: CanvasRenderingContext2D, { map, size, pad, origin, from, warp }: CanvasView): void {
    const canvas = this.canvas!;
    const style = getComputedStyle(map.getContainer());
    this.font ||= `700 ${TEXT_PX}px ${style.fontFamily || "system-ui, sans-serif"}`;
    ctx.font = this.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = HALO_PX;
    ctx.strokeStyle = style.getPropertyValue("--airspace-halo").trim() || "#fff";
    const inks = new Map<string, string>();
    const zoom = map.getZoom();
    const pixelOrigin = map.getPixelOrigin();
    // Where a place is on this canvas, unrounded and as the chart has it
    // at this frame of a zoom (AirportCanvas' marks the same way).
    const here = (lat: number, lon: number) => warp(map.project([lat, lon]).subtract(pixelOrigin).subtract(origin).add(from));
    const clear: Box[] = this.fields.map(f => {
      const b = airportBox(here(f.lat, f.lon), f.ident);
      return { x0: b.x0 - AIRPORT_CLEAR_PX, y0: b.y0 - AIRPORT_CLEAR_PX, x1: b.x1 + AIRPORT_CLEAR_PX, y1: b.y1 + AIRPORT_CLEAR_PX };
    });
    const written: { text: string; angle: number }[] = [];
    for (const label of this.labels) {
      if (label.from > zoom + 1e-6) continue;
      const on = here(label.lat, label.lon);
      const x = on.x + label.dx, y = on.y + label.dy;
      const width = label.text.length * LETTER_PX;
      if (x < -pad.x - width || y < -pad.y - width || x > size.x + pad.x + width || y > size.y + pad.y + width) continue;
      if (clear.some(b => overlaps(b, spotBox({ x, y, angle: label.angle }, width, HEIGHT_PX)))) continue;
      let ink = inks.get(label.ink);
      if (!ink) {
        ink = style.getPropertyValue(label.ink).trim() || "#086bd8";
        inks.set(label.ink, ink);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((label.angle * Math.PI) / 180);
      ctx.strokeText(label.text, 0, 0);
      ctx.fillStyle = ink;
      ctx.fillText(label.text, 0, 0);
      ctx.restore();
      written.push({ text: label.text, angle: label.angle });
    }
    canvas.dataset.airspaceEdgeLabels = JSON.stringify(written);
  }
}
