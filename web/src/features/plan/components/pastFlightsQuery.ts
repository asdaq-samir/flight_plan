import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";

/** Where a page of an airplane's past flights starts: a UTC day and,
 *  for the flights before those listed, the last one's takeoff. */
export interface PastFlightsFrom {
  until?: string;
  before?: number;
}

/**
 * An airplane's past flights, ten at a time (vfr.traffic.history), at the
 * owner's ask: the last ten found, then the ten before them on asking, or
 * from a day picked (`from`). Each page says where the next starts
 * (`next_until`); none where adsb.lol's archive has no older day.
 */
export const pastFlightsQuery = (hex: string, from: string | null) => infiniteQueryOptions({
  queryKey: ["pastFlights", hex, from],
  queryFn: ({ pageParam }) => api.trafficHistory(hex, pageParam),
  initialPageParam: (from ? { until: from } : {}) as PastFlightsFrom,
  getNextPageParam: (last): PastFlightsFrom | undefined => (last.next_until
    ? { until: last.next_until, before: last.flights?.at(-1)?.id }
    : undefined),
  staleTime: 5 * 60_000,
  meta: { silent: true },
});

/** One of those flights' reports (vfr.traffic.past_flight): its path on
 *  the map (PastFlightPath) and, where it is the airplane's last and it is
 *  not heard now, the card's sketch (FlightCard). A past flight does not
 *  change: asked once. */
export const pastFlightQuery = (hex: string, id: number) => queryOptions({
  queryKey: ["pastFlight", hex, id], queryFn: () => api.trafficPastFlight(hex, id), staleTime: Infinity, meta: { silent: true },
});
