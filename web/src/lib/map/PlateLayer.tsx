import { memo, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import L from "leaflet";
import { Pane, useMap } from "react-leaflet";
import { plateQuery } from "../queryClient";
import { usePreferences } from "../preferences";
import type { ProcedureDrawing } from "../api/types";
import { ViewCanvasLayer, type CanvasView } from "./ViewCanvas";

/** On a white sheet of its own, the chart faint under it, as an EFB lays
 *  a plate over its map: black on clear at 80%, the plate's ink sank into
 *  the sectional's own and the owner did not see it there ("I don't see
 *  the plate on the map", 2026-10-19). Drawn whole, at full opacity. The
 *  procedure's own lines stay over it, so a plate placed a little off
 *  shows against the coded path. */
const SHEET = "rgba(255, 255, 255, 0.8)";
const NO_DRAWINGS: ProcedureDrawing[] = [];
/** Over the chart and its airspace, under the procedures' lines (432). */
const PANE = "plates";

/**
 * One plate's plan view drawn on a canvas the size of the screen
 * (ViewCanvasLayer), only the part of it in sight. It was an
 * ImageOverlay, an <img> scaled with the map: at zoom 13 the ILS 09's at
 * KDLH was 4,800 by 3,800 points, at 15 19,000 by 15,000, one layer that
 * Safari composited whole through every pan and pinch, and the owner's
 * iPhone stopped answering the finger with a plate on the map
 * (2026-10-29). Placed exactly where the overlay was, its corners at the
 * plate's own georeferenced bounds.
 */
class PlateCanvasLayer extends ViewCanvasLayer {
  private readonly picture = new Image();

  constructor(pane: string, url: string, private readonly bounds: L.LatLngBounds) {
    super(pane, "approach-plate");
    // Decoded off the main thread before its first draw.
    this.picture.src = url;
    this.picture.decode().then(() => this.schedule(), () => {});
  }

  protected paint(ctx: CanvasRenderingContext2D, { map, size, pad, origin, from }: CanvasView): void {
    // The plate's corners in the container's points, unrounded, as the
    // airports' marks are (AirportCanvas).
    const pixelOrigin = map.getPixelOrigin();
    const at = (ll: L.LatLng) => map.project(ll).subtract(pixelOrigin).subtract(origin).add(from);
    const nw = at(this.bounds.getNorthWest()), se = at(this.bounds.getSouthEast());
    // Only the part on the canvas: drawn whole, a plate far bigger than
    // the screen cost a source and a destination that size.
    const x0 = Math.max(nw.x, -pad.x), y0 = Math.max(nw.y, -pad.y);
    const x1 = Math.min(se.x, size.x + pad.x), y1 = Math.min(se.y, size.y + pad.y);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.fillStyle = SHEET;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const picture = this.picture;
    if (!picture.complete || !picture.naturalWidth) return;
    const kx = picture.naturalWidth / (se.x - nw.x), ky = picture.naturalHeight / (se.y - nw.y);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(picture, (x0 - nw.x) * kx, (y0 - nw.y) * ky, (x1 - x0) * kx, (y1 - y0) * ky, x0, y0, x1 - x0, y1 - y0);
  }
}

/** One plate on the map, made again only when its picture or its corners
 *  change: not at every render of the map. */
function Plate({ url, south, west, north, east }: { url: string; south: number; west: number; north: number; east: number }) {
  const map = useMap();
  useEffect(() => {
    const layer = new PlateCanvasLayer(PANE, url, L.latLngBounds([south, west], [north, east])).addTo(map);
    return () => { layer.remove(); };
  }, [map, url, south, west, north, east]);
  return null;
}

/**
 * The approaches picked or being looked at, each its FAA plate's plan
 * view on the chart under its coded lines (ProcedureLayer), at the owner's
 * ask ("Also show the approach plate on the map when selected"): the
 * planner places the plate by the FAA's own georeference in it
 * (vfr.plates) and draws it black on clear. Where it cannot -- a plate
 * without one -- nothing is drawn, the coded lines alone. A sketch to fly
 * the dry run against, not the chart to navigate by.
 */
export const PlateLayer = memo(function PlateLayer({ drawings }: { drawings: ProcedureDrawing[] }) {
  // Off from the approach's pull-down (ProcedureMenu): the coded lines alone.
  const shown = usePreferences(s => s.plates);
  const approaches = shown ? drawings.filter(d => d.kind === "approach") : NO_DRAWINGS;
  const plates = useQueries({ queries: approaches.map(d => plateQuery(d.airport, d.id)) });
  // Placed where its corners are figures: an answer of another shape (a
  // stand-in's) draws nothing.
  const placed = plates.flatMap((q, i) => (q.data && [q.data.south, q.data.west, q.data.north, q.data.east].every(Number.isFinite)
    ? [{ plate: q.data, drawing: approaches[i]! }] : []));
  if (placed.length === 0) return null;
  return (
    <Pane name={PANE} style={{ zIndex: 431 }}>
      {placed.map(({ plate, drawing }) => (
        <Plate
          key={`${drawing.airport}-${drawing.id}`}
          url={`/api/planner/approach-plate/${encodeURIComponent(plate.cycle)}/${encodeURIComponent(drawing.airport)}/${encodeURIComponent(drawing.id)}.png`}
          south={plate.south} west={plate.west} north={plate.north} east={plate.east}
        />
      ))}
    </Pane>
  );
});
