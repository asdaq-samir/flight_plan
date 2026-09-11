import type { ReactNode } from "react";

/**
 * The right-hand stack of cards both pages use. A flex column, not a
 * block with `overflow-y-auto` on itself: that let every card scroll
 * as one unit, so a card that should fill the remaining height (like
 * the labeler's waypoint list) had no room to claim -- flex lets a
 * child opt into `flex-1 min-h-0` and actually get it.
 */
export default function Sidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="flex w-80 flex-shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3">
      {children}
    </aside>
  );
}
