import { Plane, Radar, Route, TowerControl } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";

/** The planner's four places, the tab bar's (TabBar): the flight being
 *  planned, airports, traffic and the nearest fields. */
export type PanelTab = "fpl" | "airport" | "aircraft" | "nrst";

const TABS: { value: PanelTab; label: string; icon: typeof Plane }[] = [
  { value: "fpl", label: "FPL", icon: Route },
  { value: "airport", label: "Airport", icon: TowerControl },
  { value: "aircraft", label: "Aircraft", icon: Plane },
  { value: "nrst", label: "NRST", icon: Radar },
];

/** A tab bar's height on a phone, points, over the home indicator's
 *  inset: iOS's own 49. */
export const TAB_BAR = 49;

/**
 * The planner's tabs, at the pilot's ask, in place of the two buttons on
 * the map's left: FPL (the route), Airport (the search), Aircraft (the
 * traffic and a search for one) and NRST (the nearest fields), as
 * ForeFlight's and every iOS app's tab bar -- a glyph and its word, the
 * one picked in the tint. On a phone fixed along the screen's bottom with
 * the panel's sheet above it (MapPanel); elsewhere the panel's first row.
 * Buttons that say which is current, not tab roles: each is a place of
 * its own, with no tabpanel of the promise a tab role makes.
 */
export default function TabBar({ tab, onPick, className }: {
  tab: PanelTab;
  onPick: (tab: PanelTab) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Planner" className={cn("flex h-full w-full items-stretch print:hidden", className)} data-testid="tab-bar">
      {TABS.map(({ value, label, icon: Icon }) => {
        const current = value === tab;
        return (
          <button
            key={value} type="button" aria-current={current ? "page" : undefined} onClick={() => onPick(value)}
            data-testid={`tab-${value}`} data-current={current || undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current ? "text-tint" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-6" strokeWidth={current ? 2.25 : 1.75} aria-hidden="true" />
            <span className={cn("font-medium", TEXT.caption)}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
