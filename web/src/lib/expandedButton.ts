/**
 * How a button that has something open is drawn, for as long as it
 * stays open: a soft fill and a ring around the ghost button, not the
 * solid primary fill it used to take. Solid black belongs to the one
 * primary action on the page -- the route form's own Load -- and two
 * solid squares in one header row competed with each other, with the
 * heavier of the two being the drawer's state indicator rather than
 * the action. A ring says "this one is active" without claiming that
 * weight, and it reads on the white header and the dev page's own
 * alike, which plain `bg-muted` did not.
 *
 * Shared, because two different buttons carry it: every `IconButton`
 * with `aria-expanded` (the consoles), and the stock `SidebarTrigger`
 * the drawer is opened from (see MapPage).
 */
export const EXPANDED_BUTTON =
  "aria-expanded:bg-accent aria-expanded:text-accent-foreground aria-expanded:ring-2 aria-expanded:ring-foreground/25 aria-expanded:hover:bg-accent";
