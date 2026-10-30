import L from "leaflet";
import type { AirspaceClass } from "../preferences";
import { AIRPORT_MARK, airportMarkSvg } from "./airportMark";
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

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this.canvas!.dataset.airportMarks ||= "[]";
    return this;
  }

  setMarks(marks: CanvasMark[]): void {
    this.marks = marks;
    this.schedule();
  }

  protected paint(ctx: CanvasRenderingContext2D, { map, size, pad, origin, from, dpr }: CanvasView): void {
    const canvas = this.canvas!;
    this.font ||= `700 ${LABEL_PX}px ${getComputedStyle(map.getContainer()).fontFamily || "system-ui, sans-serif"}`;
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
