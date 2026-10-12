import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { api } from "../../../lib/api/client";
import type { PastFlightSummary } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { TEXT } from "../../../lib/text";
import { dayOf, lasted, legOf, statusOf, when } from "./pastFlightFormat";

/**
 * An airplane's flights of the last seven days on its card, at the
 * pilot's ask ("can we show past flights of an aircraft", with
 * FlightAware's list as the example): each from and to the fields its
 * track starts and ends at, newest first. A tap opens the flight's own
 * card over this one (PastFlightCard), at the pilot's ask: its replay
 * and its data.
 */
export default function PastFlights({ hex, onOpen }: {
  hex: string;
  /** Opens a flight's own card (PastFlightCard), over this one. */
  onOpen: (id: number) => void;
}) {
  const { data, isError } = useQuery({
    queryKey: ["pastFlights", hex], queryFn: () => api.trafficHistory(hex), staleTime: 5 * 60_000, meta: { silent: true },
    // Days adsb.lol did not give just now are asked for again, a minute
    // apart, five times at most.
    refetchInterval: query => ((query.state.data?.unread_days ?? 0) > 0 && query.state.dataUpdateCount <= 5 ? 60_000 : false),
  });
  const flights = data?.flights ?? [];
  return (
    <>
      <ListGroup
        title="Last seven days"
        footer="The last seven days, from adsb.lol's ADS-B receivers. A flight is taken to start or end at a field where it was heard low near it, or headed for it; where none was, it says where it was last heard."
      >
        {!data && !isError && <ListRow title={<span role="status" className="text-muted-foreground">Looking…</span>} />}
        {isError && <ListRow title={<span className={cn("text-destructive", TEXT.detail)}>Its past flights could not be had. Try again in a moment.</span>} />}
        {data && !flights.length && !data.unread_days && (
          <ListRow title={<span className="text-muted-foreground">None heard in the last seven days</span>} />
        )}
        {flights.map(flight => (
          <PastFlightRow key={flight.id} flight={flight} onPick={() => onOpen(flight.id)} />
        ))}
        {/* A gap that is adsb.lol's, not the airplane's, said as one. */}
        {!!data?.unread_days && (
          <ListRow title={
            <span className={cn("text-muted-foreground", TEXT.detail)} data-testid="past-flights-unread">
              {data.unread_days === 1 ? "One day" : `${data.unread_days} days`} could not be read from adsb.lol just now, so their flights are missing; asking again.
            </span>
          } />
        )}
      </ListGroup>
    </>
  );
}

const PastFlightRow = memo(function PastFlightRow({ flight, onPick }: { flight: PastFlightSummary; onPick: () => void }) {
  const off = when(flight.off), on = when(flight.on);
  return (
    <ListRow
      title={<span className="font-semibold">{legOf(flight)}</span>}
      // Each part whole on a line, the day, the times and how long: wrapped
      // anywhere, the range broke in two ("02:29–" over "04:39") beside a
      // status taking half the row (seen on the owner's phone, 2026-10-12).
      description={<>
        <span className="whitespace-nowrap">{dayOf(off)}</span> · <span className="whitespace-nowrap">{clockTime(off)}–{clockTime(on)}</span>
        {" "}· <span className="whitespace-nowrap">{lasted(flight.on - flight.off)}</span>
      </>}
      value={<span className={cn(flight.landed || flight.in_air ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground", "font-medium")}>
        {statusOf(flight)}
      </span>}
      chevron onClick={onPick} data-testid="past-flight"
    />
  );
});
