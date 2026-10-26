import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "../../../components/ui/button";
import { GLASS_BUTTON } from "../../../components/mapChrome";
import { TEXT } from "../../../lib/text";

/**
 * One of a card's actions under its head -- the airport card's Fly Here,
 * Add Stop, Call and Address, the airplane card's Follow, Flights,
 * Registry and Share -- one look on every card.
 *
 * A tile of the card's action row: its glyph over its word, as Maps
 *  draws its own -- Fly Here filled in the tint, the rest panes of glass
 *  in the text's colour, as the gear and the route's close are, at the
 *  pilot's ask (they were the tint on grey). A 20-point glyph in a tile
 *  about 50 tall, at the pilot's ask: 70 tall, with Maps' 24-point glyph,
 *  they put the card's tabs under the half sheet's foot. The box in
 *  points, its word in the reader's size: the glyph, padding and gap are
 *  fixed, but the word's line still grows with the text size (checked at
 *  a 19 px root, not at the largest sizes). */
export function CardAction({ icon, label, spoken, filled, busy, disabled, onClick, href, testId, pressed, ...trigger }: {
  icon: ReactNode; label: string; filled?: boolean; onClick?: () => void; testId: string;
  /** A switch's state, said: Follow on or off. */
  pressed?: boolean;
  /** Where it goes instead, outside the app: a phone number to call, the
   *  field in Maps. */
  href?: string;
  /** The whole word, where the tile shows it cut short. */
  spoken?: string;
  /** Until the card's answer is in: the tile in its place, not yet live. */
  disabled?: boolean;
  /** Tapped, and its work under way: a spinner in place of its symbol,
   *  which turns on the compositor while the page is busy drawing what
   *  the tap asked for. */
  busy?: boolean;
} & Omit<ComponentProps<"button">, "children" | "onClick" | "disabled">) {
  // Its sides four points in, not the stock button's ten: the room a
  // word needs to stay on its one line (below) at the text sizes a reader
  // sets larger.
  // The others iOS's grey tiles with their glyph and word in the tint, as
  // Apple's Maps on the web draws a place's Call and Website (the owner's
  // screenshot, 2026-10-26).
  const look = cn("h-auto min-w-0 flex-col gap-[2px] rounded-xl px-1 py-[6px] [&_svg:not([class*='size-'])]:size-[20px]", !filled && cn(GLASS_BUTTON, "text-tint hover:text-tint"));
  const face = (
    <>
      {busy ? <Loader2 className="size-[20px] animate-spin" aria-hidden="true" /> : icon}
      {/* On one line, at the pilot's ask: "Fly Here" and "Add Stop" on
          two at a larger text size made every tile a line taller, and
          the card's tiles ran off the half sheet. Wrapped, not cut
          short, only where even that is too narrow, a 320-point Slide Over:
          HIG says not to truncate a button's title. */}
      <span className={cn("max-w-full text-center leading-tight font-semibold", TEXT.note)}>{label}</span>
    </>
  );
  // A link where it leaves the app, the stock button's look on it.
  if (href && !disabled) {
    return (
      <Button asChild variant={filled ? "default" : "secondary"} className={look}>
        <a href={href} target={href.startsWith("tel:") ? undefined : "_blank"} rel="noreferrer" data-testid={testId} aria-label={spoken}>{face}</a>
      </Button>
    );
  }
  return (
    // What a menu's trigger hands its button (DropdownMenuTrigger asChild:
    // its ref, its pointer and key handlers, aria-expanded) goes on it, so
    // a tile can open a menu, as the airplane card's Alert does.
    <Button
      type="button" variant={filled ? "default" : "secondary"} {...trigger} onClick={onClick} disabled={disabled}
      data-testid={testId} aria-label={spoken} aria-busy={busy || undefined} aria-pressed={pressed} className={look}
    >
      {face}
    </Button>
  );
}
