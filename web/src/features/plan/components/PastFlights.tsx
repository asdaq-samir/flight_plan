import { lazy, memo, Suspense, useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowRight, RotateCw } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { ResponsivePopover, ResponsivePopoverAnchor, ResponsivePopoverContent } from "../../../components/ResponsivePopover";
import { Button } from "../../../components/ui/button";
import type { PastFlightSummary } from "../../../lib/api/types";
import { TEXT } from "../../../lib/text";
import { dayOf, lasted, placeOf, when, whenSaid } from "./pastFlightFormat";
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
export default function PastFlights({ hex, onOpen, nowShown = false, type = null }: {
  hex: string;
  /** Opens a flight's own card (PastFlightCard), over this one. */
  onOpen: (id: number) => void;
  /** The flight it is on is the Now entry over the list (NowFlight): the
   *  list is the ones before it, and leaves that one out. */
  nowShown?: boolean;
  /** Its type, on each row as FlightAware's list has it. */
  type?: string | null;
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
  const flights = pages.flatMap(page => page.flights ?? []).filter(f => !(nowShown && f.in_air));
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
        // No footnote under it, at the owner's ask ("Avoid putting so many
        // footnotes for pilots experience"): the rows say it.
        title={from ? `On and before ${dayOf(new Date(`${from}T12:00:00Z`))}` : nowShown ? "Earlier" : "Last flights"}
      >
        {(!data || looking) && !isError && <ListRow title={<span role="status" className="text-muted-foreground">{data ? "Looking further back…" : "Looking…"}</span>} />}
        {isError && !data && <ListRow title={<span className={cn("text-destructive", TEXT.detail)}>Its past flights could not be had. Try again in a moment.</span>} />}
        {data && !flights.length && !hasNextPage && !unread && (
          // The owner's words, where it read "None heard in adsb.lol's archive".
          <ListRow title={<span className="text-muted-foreground" data-testid="past-flights-none">
            {from ? "None heard on or before that day" : "No flights heard in the last six weeks"}
          </span>} />
        )}
        {flights.map(flight => (
          <PastFlightRow key={flight.id} flight={flight} type={type} onPick={() => onOpen(flight.id)} />
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
        {/* Its Done at the foot its way out (no close). */}
        <ResponsivePopoverContent title="Flights before a date" className="w-auto p-0" align="start" closeButton={false}>
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

/** One end of a flight, as FlightAware's list sets it: the field's ident
 *  large, its town under it, and when. */
export interface FlightEnd {
  ident: string;
  place?: string | null;
  when?: string | null;
}

/**
 * A flight's two ends side by side, the way between them an arrow, or a
 * loop for one that came back to where it left (a local flight), at the
 * owner's ask, with FlightAware's list as the example: the airplane's
 * flight now on its card (NowFlight) and each one before it.
 */
export function FlightEnds({ from, to, local = false, testIds }: {
  from: FlightEnd;
  to: FlightEnd;
  local?: boolean;
  testIds?: { from?: string; to?: string };
}) {
  const Way = local ? RotateCw : ArrowRight;
  const end = (side: FlightEnd, right: boolean) => (
    <span className={cn("flex min-w-0 flex-col", right && "items-end text-right")} data-testid={right ? testIds?.to : testIds?.from}>
      <span className={cn("max-w-full truncate font-bold text-foreground", TEXT.heading)}>{side.ident}</span>
      {side.place && <span className={cn("max-w-full truncate text-muted-foreground", TEXT.detail)}>{side.place}</span>}
      {side.when && <span className={cn("max-w-full truncate text-foreground", TEXT.detail)}>{side.when}</span>}
    </span>
  );
  return (
    <span className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
      {end(from, false)}
      <Way className="mt-1 size-5 text-foreground" aria-hidden />
      {end(to, true)}
    </span>
  );
}

/** "Landed · 52 min", "Local flight · 1 h 5 min", "Last heard · 40 min":
 *  how it ended and how long it flew. */
function endedOf(flight: PastFlightSummary): string {
  const local = !flight.in_air && !!flight.origin && flight.origin.ident === flight.destination?.ident;
  return `${flight.in_air ? "In the air" : local ? "Local flight" : flight.landed ? "Landed" : "Last heard"} · ${lasted(flight.on - flight.off)}`;
}

const PastFlightRow = memo(function PastFlightRow({ flight, type, onPick }: { flight: PastFlightSummary; type: string | null; onPick: () => void }) {
  const off = when(flight.off), on = when(flight.on);
  const local = !flight.in_air && !!flight.origin && flight.origin.ident === flight.destination?.ident;
  return (
    <ListRow
      // FlightAware's row, at the owner's ask: how it ended and its type,
      // then where from and to, each field's town and when.
      title={
        <span className="flex w-full flex-col gap-1.5 py-1">
          <span className={cn("flex items-center gap-2 font-semibold", TEXT.detail)}>
            <span className={flight.landed || flight.in_air ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
              {endedOf(flight)}
            </span>
            {type && <span className="ml-auto text-muted-foreground">{type}</span>}
          </span>
          <FlightEnds
            local={local}
            from={{ ident: flight.origin?.ident ?? "?", place: placeOf(flight.origin), when: whenSaid(off) }}
            to={{
              ident: flight.in_air ? "Now" : flight.destination?.ident ?? "?",
              place: flight.in_air ? null : placeOf(flight.destination),
              when: flight.in_air ? null : whenSaid(on),
            }}
          />
        </span>
      }
      wide chevron onClick={onPick} data-testid="past-flight"
    />
  );
});
