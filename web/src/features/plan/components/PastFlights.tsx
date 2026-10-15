import { lazy, memo, Suspense, useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import { Button } from "../../../components/ui/button";
import type { PastFlightSummary } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { TEXT } from "../../../lib/text";
import { dayOf, lasted, legOf, statusOf, when } from "./pastFlightFormat";
import { pastFlightsQuery } from "./pastFlightsQuery";

// The stock calendar, as the departure's picker has it (DepartPicker):
// its own chunk, asked for once a day is to be picked.
const Calendar = lazy(() => import("../../../components/ui/calendar").then(m => ({ default: m.Calendar })));

/** How far back a day may be picked: adsb.lol's archive (vfr.traffic
 *  ARCHIVE_DAYS), today among them. */
const ARCHIVE_DAYS = 42;

/** A day, ISO (the planner's `until`): the calendar's day as it shows it,
 *  where an ISO string of its local midnight was the day before east of
 *  Greenwich. */
const isoDay = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * An airplane's past flights on its card, at the pilot's ask ("can we
 * show past flights of an aircraft", with FlightAware's list as the
 * example): its last ten found, newest first, each from and to the fields
 * its track starts and ends at -- at the owner's ask ("make it last 10
 * flights you were able to find"), where it was the last seven days'. Ten
 * more before them on asking, and from a day picked ("give an option to
 * fetch more by date"), as far back as adsb.lol's archive goes, about six
 * weeks. A tap opens the flight's own card over this one (PastFlightCard).
 */
export default function PastFlights({ hex, onOpen }: {
  hex: string;
  /** Opens a flight's own card (PastFlightCard), over this one. */
  onOpen: (id: number) => void;
}) {
  // A day picked, else the last flights found.
  const [from, setFrom] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const { data, isError, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching } = useInfiniteQuery({
    ...pastFlightsQuery(hex, from),
    // Days adsb.lol did not give just now are asked for again, a minute
    // apart, five times at most, while only the first page is out.
    refetchInterval: query => {
      const pages = query.state.data?.pages ?? [];
      return pages.length === 1 && (pages[0]?.unread_days ?? 0) > 0 && query.state.dataUpdateCount <= 5 ? 60_000 : false;
    },
  });
  const pages = data?.pages ?? [];
  // A page without its list (an older planner's answer, a stand-in) is no
  // flights, not a fault that takes the card down.
  const flights = pages.flatMap(page => page.flights ?? []);
  const unread = pages.reduce((n, page) => n + (page.unread_days ?? 0), 0);
  const today = new Date();
  const earliest = new Date(today.getTime() - (ARCHIVE_DAYS - 1) * 86_400_000);
  // None found yet, and older days left: on back by itself, a fortnight
  // at a time, until one is found or the archive ends -- "the last 10
  // flights you were able to find", where an airplane quiet for a
  // fortnight showed nothing but "Look further back" (the owner's phone,
  // N3429J).
  const looking = !!data && !flights.length && !!hasNextPage;
  useEffect(() => {
    if (looking && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [looking, isFetchingNextPage, isError, fetchNextPage]);
  const picked = from ? new Date(`${from}T12:00:00Z`) : undefined;
  return (
    <>
      <ListGroup
        title={from ? `On and before ${dayOf(new Date(`${from}T12:00:00Z`))}` : "Last flights"}
        footer="From adsb.lol's ADS-B receivers, which keep about six weeks. A flight is taken to start or end at a field where it was heard low near it, or headed for it; where none was, it says where it was last heard."
      >
        {(!data || looking) && !isError && <ListRow title={<span role="status" className="text-muted-foreground">{data ? "Looking further back…" : "Looking…"}</span>} />}
        {isError && !data && <ListRow title={<span className={cn("text-destructive", TEXT.detail)}>Its past flights could not be had. Try again in a moment.</span>} />}
        {data && !flights.length && !hasNextPage && !unread && (
          <ListRow title={<span className="text-muted-foreground">{from ? "None heard on or before that day" : "None heard in adsb.lol's archive, about six weeks"}</span>} />
        )}
        {flights.map(flight => (
          <PastFlightRow key={flight.id} flight={flight} onPick={() => onOpen(flight.id)} />
        ))}
        {/* A gap that is adsb.lol's, not the airplane's, said as one. */}
        {!!unread && (
          <ListRow title={
            <span className={cn("text-muted-foreground", TEXT.detail)} data-testid="past-flights-unread">
              {unread === 1 ? "One day" : `${unread} days`} could not be read from adsb.lol just now, so their flights are missing; asking again.
            </span>
          } />
        )}
        {/* Ten more, before the last listed, as far back as the archive goes. */}
        {hasNextPage && !looking && (
          <ListRow
            title={isFetchingNextPage ? "Looking further back…" : "Show earlier flights"}
            onClick={() => void fetchNextPage()} disabled={isFetchingNextPage} data-testid="past-flights-more"
          />
        )}
      </ListGroup>
      {/* From a day picked, on the stock calendar in a sheet, as the
          departure's day is: the phone's own date field showed an empty
          box until one was picked (the owner's phone). The archive's days
          alone can be picked. */}
      <ResponsivePopover open={picking} onOpenChange={setPicking}>
        <ResponsivePopoverAnchor asChild>
          <div>
            <ListGroup>
              <ListRow
                title="Flights before a date" value={picked ? dayOf(picked) : "Pick a day"} chevron
                onClick={() => setPicking(true)} data-testid="past-flights-date"
              />
            </ListGroup>
          </div>
        </ResponsivePopoverAnchor>
        <ResponsivePopoverContent title="Flights before a date" className="w-auto p-0" align="start">
          <div className="flex flex-col items-center gap-3 pb-3" data-testid="past-flights-picker">
            <Suspense fallback={<div className="h-[21rem] w-[17rem]" />}>
              <Calendar
                mode="single" required selected={picked} defaultMonth={picked ?? today}
                startMonth={earliest} endMonth={today} disabled={{ before: earliest, after: today }}
                onSelect={day => { setFrom(isoDay(day)); setPicking(false); }}
              />
            </Suspense>
            <div className="flex items-center gap-2 px-3">
              <Button
                type="button" variant="ghost" size="sm" className="text-tint" disabled={!from}
                onClick={() => { setFrom(null); setPicking(false); }} data-testid="past-flights-latest"
              >
                Latest
              </Button>
              <Button type="button" size="sm" onClick={() => setPicking(false)}>Done</Button>
            </div>
          </div>
        </ResponsivePopoverContent>
      </ResponsivePopover>
      {isFetching && data && !isFetchingNextPage && <span className="sr-only" role="status">Updating</span>}
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
