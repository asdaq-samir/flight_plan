import { Plane, Radar, Route, Settings, TowerControl } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { useConsoleOpen } from "./mapChrome";

/** The planner's four places, the tab bar's (TabBar): the flight being
 *  planned, airports, traffic and the nearest fields. */
export type PanelTab = "fpl" | "airport" | "aircraft" | "nrst";

const TABS: { value: PanelTab | "settings"; label: string; icon: typeof Plane }[] = [
  { value: "fpl", label: "FPL", icon: Route },
  { value: "airport", label: "Airport", icon: TowerControl },
  { value: "aircraft", label: "Aircraft", icon: Plane },
  { value: "nrst", label: "NRST", icon: Radar },
  { value: "settings", label: "Settings", icon: Settings },
];

/**
 * The planner's tabs, at the pilot's ask, in place of the two buttons on
 * the map's left: FPL (the route), Airport (the search), Aircraft (the
 * traffic and a search for one), NRST (the nearest fields) and Settings
 * (the console), as ForeFlight's and every iOS app's tab bar -- a glyph
 * and its word, the one picked in the tint. The panel's first row, over
 * its pill at rest as over the sheet (MapPanel). Buttons that say which
 * is current, not tab roles: each is a place of its own, with no
 * tabpanel of the promise a tab role makes.
 *
 * Settings is the console, out while it is the tab picked, where it was a
 * gear beside every search field, at the pilot's ask: each card has its
 * search bar the whole width. Its button keeps the gear's test id, being
 * the one way to the settings on this page, as the gear still is on the
 * training page.
 */
export default function TabBar({ tab, onPick, onUp, marks, className }: {
  tab: PanelTab;
  onPick: (tab: PanelTab) => void;
  /** A tab with something to fix (red) or to look at (amber), as the
   *  route's own tabs mark theirs: FPL's where the route has no legal
   *  altitude, said at rest as the route's pill said it. */
  marks?: Partial<Record<PanelTab, "stop" | "caution">>;
  /** The tab up tapped: on the pill, the panel opened to it, as a tap on
   *  the pill's own search bar did. */
  onUp?: () => void;
  className?: string;
}) {
  const consoleOpen = useConsoleOpen(s => s.open);
  const setConsoleOpen = useConsoleOpen(s => s.setOpen);
  const up = consoleOpen ? "settings" : tab;
  return (
    <nav aria-label="Planner" className={cn("flex h-full w-full items-stretch print:hidden", className)} data-testid="tab-bar">
      {TABS.map(({ value, label, icon: Icon }) => {
        const current = value === up;
        return (
          <button
            key={value} type="button" aria-current={current ? "page" : undefined}
            onClick={() => {
              if (current) {
                onUp?.();
                return;
              }
              if (value === "settings") {
                setConsoleOpen(true);
                return;
              }
              if (consoleOpen) setConsoleOpen(false);
              onPick(value);
            }}
            data-testid={value === "settings" ? "settings-button" : `tab-${value}`} data-current={current || undefined}
            // Its mark said to a reader, after its name.
            aria-label={value !== "settings" && marks?.[value] ? `${label}, ${marks[value] === "stop" ? "warning" : "caution"}` : undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current ? "text-tint" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="relative">
              <Icon className="size-6" strokeWidth={current ? 2.25 : 1.75} aria-hidden="true" />
              {value !== "settings" && marks?.[value] && (
                <span
                  aria-hidden="true" data-testid={`tab-mark-${value}`} data-finding={marks[value]}
                  className={cn("absolute -top-0.5 -right-1 size-2 rounded-full", marks[value] === "stop" ? "bg-destructive" : "bg-amber-500")}
                />
              )}
            </span>
            <span className={cn("font-medium", TEXT.caption)}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
