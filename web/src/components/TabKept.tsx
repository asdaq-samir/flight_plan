import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * A tab's body kept under the others once it has been opened, as iOS keeps
 * a tab's screen: back to it, it is as it was left -- a list scrolled where
 * it was, a card open over it -- and not built again. Out of sight it is
 * inert and not laid out (index.css's tab-away), its layout kept for its
 * return, as PanelTabs keeps the Brief's pages; not under React's
 * Activity, whose effects stopped and started again on every return.
 */
export default function TabKept({ away, children }: { away: boolean; children: ReactNode }) {
  return (
    <div inert={away} className={cn("flex min-h-0 flex-col", away ? "tab-away flex-none" : "flex-1")}>
      {children}
    </div>
  );
}
