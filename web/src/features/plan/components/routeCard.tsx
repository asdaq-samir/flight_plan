import type { ReactNode } from "react";
import { cn } from "cn";
import { colourOf } from "../../../lib/map/flightCategory";
import { AirportMark } from "./navlog/PointMark";

/** The course's magenta, the route's line. */
const ROUTE_LINE = { backgroundColor: "var(--course)" } as const;

/** A point's card, where the list is cards (RouteListEdit's `cards`):
 *  dimmed while it is dragged, ringed in the tint while one is held over
 *  it (PointGrip's data-dragging and data-over). */
export const POINT_CARD = cn(
  "rounded-2xl bg-card py-3 pr-1.5 pl-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10",
  "has-[[data-dragging]]:opacity-40 has-[[data-over]]:ring-2 has-[[data-over]]:ring-tint",
);
/** The room between a card and the next, the course's line across it. */
export const CARD_GAP = "mb-[1.375rem]";

/**
 * The course's line through the cards, from each card's mark to the
 * next's, at the owner's asks (2026-11-05: "magenta connecting line can go
 * through the card to airport icons"; then, the line tried outside the
 * cards with a stub into each mark, "I don't like the connections from the
 * left, can we squeeze the capsule space and maybe slide them to the right
 * so we have non overlapping space for connections on the left of
 * runways"): down the marks' column (the card's 12 and half its 28), the
 * card's runways and procedures starting right of it (CARD_BODY), behind
 * all the card holds (the card isolated, the line under its content), and
 * across the gap to the next card. The first card's starts, and the
 * last's ends, 32 down, under its mark, on a disc of the card's fill
 * (CardMark), as the mark's grey is see-through.
 */
export function CardThread({ first, last }: { first: boolean; last: boolean }) {
  if (first && last) return null;
  return (
    <span
      aria-hidden="true" style={ROUTE_LINE}
      className={cn("absolute left-[calc(1.625rem-1px)] -z-10 w-0.5", first ? "top-8" : "top-0", last ? "h-8" : "-bottom-[1.375rem]")}
    />
  );
}

/** A card's runways and procedures, started 20 in, 5 clear of the line
 *  down the marks' column (CardThread), not under the ident's 38 as the
 *  list's are: the room the capsules and pull-downs gain. */
export const CARD_BODY = "pl-5";

/** A card's mark on a disc of the card's fill, hiding the line under it. */
export const CardMark = ({ children }: { children: ReactNode }) => <span className="grid place-items-center rounded-full bg-card">{children}</span>;

/** An empty card's mark: the airport symbol, no airspace or weather yet,
 *  faded, on the grey disc an airport's mark has (PointMenu's face). */
export function EmptyMark() {
  return (
    <span className="-mx-1 grid size-9 place-items-center rounded-full bg-foreground/8 opacity-50">
      <AirportMark airspaceClass={null} colour={colourOf(null)} size={22} />
    </span>
  );
}
