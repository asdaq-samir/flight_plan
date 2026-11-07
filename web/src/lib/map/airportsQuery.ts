import { api } from "../api/client";
import type { Box } from "./view";

/** From this zoom in a sectional draws its airports big enough to aim a
 *  finger at; further out the targets would be a field of overlapping
 *  circles over half a state. */
const FROM_ZOOM = 8;

/** Further out than REPORTING_FROM_ZOOM, the biggest fields that report
 *  still wear their marks, fewer at each zoom out, as Maps keeps the big
 *  cities' names (the owner's ask, "show bigger airports gradually as we
 *  zoom out"): from this zoom, the whole country on a phone at 4. */
const FARTHEST_ZOOM = 4;

/** The most fields the planner answers with at once. */
const AIRPORTS_LIMIT = 1000;

/** The planner asked for a box's fields at a zoom, from FARTHEST_ZOOM in:
 *  at zoom 7 and further out the ones that report alone. Up to a
 *  thousand, the box being some nine views: the planner's most, 270 in
 *  two degrees by two and a half round Chicago in 0.14 s. Ten minutes, as
 *  a METAR's colour can change by the hour. The layer's useQuery and the
 *  map's own events (useAhead) ask it alike. */
export function airportsQuery(asked: Box, zoom: number) {
  const reportingOnly = zoom < FROM_ZOOM;
  return {
    queryKey: ["airportsInView", asked.key, reportingOnly],
    queryFn: () => api.airportsInView({ ...asked.box, reporting: reportingOnly, limit: AIRPORTS_LIMIT }),
    enabled: zoom >= FARTHEST_ZOOM,
    staleTime: 10 * 60_000,
    meta: { silent: true },
  };
}


