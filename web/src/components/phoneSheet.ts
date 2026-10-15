import type { NavEdge } from "../lib/preferences";
/**
 * A phone's sheet from an edge, as iOS presents one: the screen's width,
 * its far corners round, at most 85% of the screen's height, clear of the
 * status bar from the top. shadcn's Sheet, where it was vaul's Drawer,
 * at the owner's ask ("Let's remove vaul").
 */
export function phoneSheet(edge: NavEdge) {
  return edge === "top"
    ? "max-h-[85dvh] gap-0 rounded-b-lg bg-popover pt-[env(safe-area-inset-top)] text-popover-foreground"
    : "max-h-[85dvh] gap-0 rounded-t-lg bg-popover text-popover-foreground";
}
