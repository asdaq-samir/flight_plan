import { useContext, useEffect } from "react";
import { ChevronDown, Settings, type LucideIcon } from "lucide-react";
import BackButton from "./BackButton";
import CloseButton from "./CloseButton";
import { cn } from "cn";
import { closeTopCard, useOpenCards } from "../lib/openCards";
import { TEXT } from "../lib/text";
import { TabBarMinimized, useConsoleOpen, useTabsShown } from "./mapChrome";

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
 *
 * Out of the pill, the sheet up on a phone, it is minimized, as iOS 26's
 * tab bar minimizes, at the pilot's ask: the tab up's glyph and name
 * alone, centred, in the tint; tapped, every tab again at the height the
 * sheet is, minimized once one is picked.
 */
export default function TabBar<T extends string>({ tabs, tab, onPick, onUp, marks, onClose, className }: {
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
  /** The minimized bar's close, at its right: whatever is open over the
   *  tab put away and the sheet down to its pill, at the owner's ask. */
  onClose?: () => void;
  className?: string;
}) {
  const consoleOpen = useConsoleOpen(s => s.open);
  const setConsoleOpen = useConsoleOpen(s => s.setOpen);
  const all: BarTab<T | "settings">[] = [...tabs, { value: "settings", label: "Settings", icon: Settings }];
  const up: T | "settings" = consoleOpen ? "settings" : tab;
  const minimized = useContext(TabBarMinimized);
  const shown = useTabsShown(s => s.shown);
  const setShown = (next: boolean) => useTabsShown.setState({ shown: next });
  // In the pill again, minimized again the next time the sheet is up.
  useEffect(() => {
    if (!minimized && shown) useTabsShown.setState({ shown: false });
  }, [minimized, shown]);
  const upTab = all.find(t => t.value === up)!;
  // A card open over the tab -- an airport's, an airplane's, a past
  // flight's -- has its way back here, at the top left on the tab's
  // line, in place of its own close, at the owner's ask: only while the
  // tabs are not shown (minimized), as iOS's navigation bar's Back.
  const cards = useOpenCards(s => s.count);
  const back = minimized && !consoleOpen && cards > 0;
  if (minimized && !shown) {
    const Icon = upTab.icon;
    return (
      <nav aria-label="Tabs" className={cn("relative flex h-full w-full items-center justify-center print:hidden", className)} data-testid="tab-bar">
        {/* Round, as the close at the other end is, at the owner's ask. */}
        {back && <BackButton onClick={() => closeTopCard()} className="absolute top-1/2 left-0 -translate-y-1/2" data-testid="tab-back" />}
        <button
          type="button" onClick={() => setShown(true)} aria-expanded={false} aria-label={`${upTab.label}, show the tabs`}
          data-testid="tab-title"
          className={cn(
            "relative flex h-8 items-center gap-1.5 rounded-full px-3 font-semibold text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "after:absolute after:-inset-x-2 after:-inset-y-1.5 after:content-['']", TEXT.row,
          )}
        >
          <Icon className="size-5" strokeWidth={2.25} aria-hidden="true" />
          {upTab.label}
          <ChevronDown className="size-4 text-muted-foreground" strokeWidth={2.25} aria-hidden="true" />
        </button>
        {/* And a close at its right, at the owner's ask: Back goes one card
            back, the close all the way down to the pill. */}
        {onClose && !consoleOpen && (
          <CloseButton onClick={onClose} className="absolute top-1/2 right-0 -translate-y-1/2" data-testid="tab-close" />
        )}
      </nav>
    );
  }
  return (
    <nav aria-label="Tabs" className={cn("flex h-full w-full items-stretch print:hidden", className)} data-testid="tab-bar">
      {all.map(({ value, label, icon: Icon }) => {
        const current = value === up;
        const mark = value === "settings" ? undefined : marks?.[value as T];
        return (
          <button
            key={value} type="button" aria-current={current ? "page" : undefined}
            onClick={() => {
              setShown(false);
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
              // The others a grey that reads on the glass over any chart
              // (WCAG's 4.5:1 at the words' 11 points), where the muted
              // one fell to 4.35 there.
              current ? "text-tint" : "text-foreground/65 hover:text-foreground",
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
