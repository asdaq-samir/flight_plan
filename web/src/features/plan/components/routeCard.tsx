import type { ReactNode } from "react";
import { cn } from "cn";

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
 * through the card to airport icons", then "can the airport icons connect
 * from the left side so it doesn't go over runway capsule", and the
 * screenshot after, the line still on the capsule's rounded end): down
 * outside the cards' left edge, 8 off it, and into each mark from its
 * left, a stub across the card's edge at the mark's middle, 32 down (the
 * card's 12 and half the mark's 36, at the mark's own type size), so
 * nothing inside the card is crossed but the stub, which the mark's disc
 * meets. Behind all the card holds (the card isolated, the line under its
 * content); the first's starts at its stub, the last's ends there.
 */
export function CardThread({ first, last }: { first: boolean; last: boolean }) {
  if (first && last) return null;
  return (
    <>
      <span
        aria-hidden="true" style={ROUTE_LINE}
        className={cn("absolute -left-[calc(0.5rem+1px)] -z-10 w-0.5", first ? "top-[calc(2rem-1px)]" : "top-0", last ? "h-[calc(2rem+1px)]" : "-bottom-[1.375rem]")}
      />
      <span aria-hidden="true" style={ROUTE_LINE} className="absolute top-[calc(2rem-1px)] -left-[calc(0.5rem+1px)] -z-10 h-0.5 w-[calc(1rem+2px)]" />
    </>
  );
}

/** A card's mark on a disc of the card's fill, hiding the line under it. */
export const CardMark = ({ children }: { children: ReactNode }) => <span className="grid place-items-center rounded-full bg-card">{children}</span>;
