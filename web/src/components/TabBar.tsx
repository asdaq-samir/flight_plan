import { Settings, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { useConsoleOpen } from "./mapChrome";

/** One of a page's places, a tab of its bar: its word and its glyph. */
export interface BarTab<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

/**
 * A page's tabs, at the pilot's ask, as ForeFlight's and every iOS app's
 * tab bar -- a glyph and its word, the one picked in the tint: the
 * planner's FPL, Airport, Aircraft and NRST, the developer's Train and
 * Perf, and on both Settings last. The panel's first row, over its pill
 * at rest as over the sheet (MapPanel). Buttons that say which is
 * current, not tab roles: each is a place of its own, with no tabpanel of
 * the promise a tab role makes.
 *
 * Settings is the console, out while it is the tab picked, where it was a
 * gear beside every search field, at the pilot's ask: each card has its
 * search bar the whole width. Its button keeps the gear's test id, and is
 * where the focus goes back to as the console closes
 * (`data-console-button`, MapPage).
 */
export default function TabBar<T extends string>({ tabs, tab, onPick, onUp, marks, className }: {
  tabs: BarTab<T>[];
  tab: T;
  onPick: (tab: T) => void;
  /** The tab up tapped: on the pill, the panel opened to it, as a tap on
   *  the pill's own search bar did. */
  onUp?: () => void;
  /** A tab with something to fix (red) or to look at (amber), as the
   *  route's own tabs mark theirs: FPL's where the route has no legal
   *  altitude, said at rest as the route's pill said it. */
  marks?: Partial<Record<T, "stop" | "caution">>;
  className?: string;
}) {
  const consoleOpen = useConsoleOpen(s => s.open);
  const setConsoleOpen = useConsoleOpen(s => s.setOpen);
  const all: BarTab<T | "settings">[] = [...tabs, { value: "settings", label: "Settings", icon: Settings }];
  const up: T | "settings" = consoleOpen ? "settings" : tab;
  return (
    <nav aria-label="Tabs" className={cn("flex h-full w-full items-stretch print:hidden", className)} data-testid="tab-bar">
      {all.map(({ value, label, icon: Icon }) => {
        const current = value === up;
        const mark = value === "settings" ? undefined : marks?.[value as T];
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
              onPick(value as T);
            }}
            data-testid={value === "settings" ? "settings-button" : `tab-${value}`} data-current={current || undefined}
            data-console-button={value === "settings" ? "" : undefined}
            // Its mark said to a reader, after its name.
            aria-label={mark ? `${label}, ${mark === "stop" ? "warning" : "caution"}` : undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current ? "text-tint" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="relative">
              <Icon className="size-6" strokeWidth={current ? 2.25 : 1.75} aria-hidden="true" />
              {mark && (
                <span
                  aria-hidden="true" data-testid={`tab-mark-${value}`} data-finding={mark}
                  className={cn("absolute -top-0.5 -right-1 size-2 rounded-full", mark === "stop" ? "bg-destructive" : "bg-amber-500")}
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
