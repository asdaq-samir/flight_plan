import { memo } from "react";
import { useQueries } from "@tanstack/react-query";
import { ImageOverlay, Pane } from "react-leaflet";
import { api } from "../api/client";
import type { ProcedureDrawing } from "../api/types";

/** A plate placed stays good for its cycle's 28 days. */
const PLATE_STALE_MS = 6 * 60 * 60_000;
/** Seen through: the chart under it and the procedure's own lines over it,
 *  so a plate placed a little off shows against the coded path. */
const PLATE_OPACITY = 0.8;

/**
 * The approaches picked or being looked at, each its FAA plate's plan
 * view on the chart under its coded lines (ProcedureLayer), at the owner's
 * ask ("Also show the approach plate on the map when selected"): the
 * planner places the plate by its own waypoints (vfr.plates) and draws it
 * black on clear. Where it cannot -- most ILS, LOC and VOR plates, whose
 * fixes are not drawn as waypoint stars, or a plate drawn other than
 * north up -- nothing is drawn, the coded lines alone. A sketch to fly the
 * dry run against, not the chart to navigate by.
 */
export const PlateLayer = memo(function PlateLayer({ drawings }: { drawings: ProcedureDrawing[] }) {
  const approaches = drawings.filter(d => d.kind === "approach");
  const plates = useQueries({
    queries: approaches.map(d => ({
      queryKey: ["plate", d.airport, d.id],
      queryFn: () => api.plate(d.airport, d.id),
      staleTime: PLATE_STALE_MS,
      retry: false,
      meta: { silent: true },
    })),
  });
  // Placed where its corners are figures: an answer of another shape (a
  // stand-in's) draws nothing.
  const placed = plates.flatMap((q, i) => (q.data && [q.data.south, q.data.west, q.data.north, q.data.east].every(Number.isFinite)
    ? [{ plate: q.data, drawing: approaches[i]! }] : []));
  if (placed.length === 0) return null;
  return (
    // Over the chart and its airspace, under the procedures' lines (432).
    <Pane name="plates" style={{ zIndex: 431 }}>
      {placed.map(({ plate, drawing }) => (
        <ImageOverlay
          key={`${drawing.airport}-${drawing.id}`}
          url={`/api/planner/approach-plate/${encodeURIComponent(plate.cycle)}/${encodeURIComponent(drawing.airport)}/${encodeURIComponent(drawing.id)}.png`}
          bounds={[[plate.south, plate.west], [plate.north, plate.east]]}
          opacity={PLATE_OPACITY} interactive={false}
        />
      ))}
    </Pane>
  );
});
