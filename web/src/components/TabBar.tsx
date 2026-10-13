import { useContext, useEffect, useRef } from "react";
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
  const all: BarTab<T | "settings">[] = [...tabs, { value: "settings", label: "Setup", icon: Settings }];
  const up: T | "settings" = consoleOpen ? "settings" : tab;
  const minimized = useContext(TabBarMinimized);
  const shown = useTabsShown(s => s.shown);
  const setShown = (next: boolean) => useTabsShown.setState({ shown: next });
  // In the pill again, minimized again the next time the sheet is up.
  useEffect(() => {
    if (!minimized && shown) useTabsShown.setState({ shown: false });
  }, [minimized, shown]);
  const upTab = all.find(t => t.value === up)!;
  // A tab picked as a tap on it picks it: Setup's the console, the others
  // the workspace's (onPick).
  const pick = (value: T | "settings") => {
    setShown(false);
    if (value === "settings") {
      setConsoleOpen(true);
      return;
    }
    if (consoleOpen) setConsoleOpen(false);
    onPick(value as T);
  };
  // A swipe across the panel goes to the tab beside the one up, at the
  // owner's ask ("Can swiping left/right switch tabs?"): to the left the
  // next, as a page of iOS's swipes on; not past either end. Listened for
  // on the whole panel, the bar a row of it, so the card's own rows swipe
  // too -- but not a field, a slider or anything that scrolls sideways
  // (the Favorites' strip, the nav log's table), which keep the finger.
  const bar = useRef<HTMLElement | null>(null);
  const step = useRef<(by: 1 | -1) => void>(() => {});
  useEffect(() => {
    step.current = by => {
      const order = all.map(t => t.value);
      const next = order[order.indexOf(up) + by];
      if (next !== undefined) pick(next);
    };
  });
  useEffect(() => {
    const panel = bar.current?.closest<HTMLElement>("[data-slot=map-panel]");
    if (!panel) return;
    let start: { x: number; y: number; id: number } | null = null;
    let swiped = false;
    const keeps = (target: EventTarget | null) => {
      for (let el = target as HTMLElement | null; el && el !== panel; el = el.parentElement) {
        // A route's point is dragged as a finger slides it (RouteBox's
        // dnd-kit sortables say so with aria-roledescription).
        if (el.matches("input, textarea, select, [contenteditable=true], [role=slider], [aria-roledescription], [data-point], .leaflet-container")) return true;
        const overflow = getComputedStyle(el).overflowX;
        if ((overflow === "auto" || overflow === "scroll") && el.scrollWidth > el.clientWidth + 1) return true;
      }
      return false;
    };
    const down = (event: PointerEvent) => {
      // A finger's or a pen's: a mouse dragged across is selecting words.
      start = event.isPrimary && event.pointerType !== "mouse" && !keeps(event.target)
        ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
    };
    const up = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      // Clearly sideways: 50 points, and twice as far across as up or down,
      // so a drag of the sheet that wanders is still a drag.
      if (Math.abs(dx) < 50 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      swiped = true;
      step.current(dx < 0 ? 1 : -1);
    };
    // The tap a swipe ends in is not a tap on what it ended over.
    const click = (event: MouseEvent) => {
      if (!swiped) return;
      swiped = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const cancel = () => { start = null; };
    panel.addEventListener("pointerdown", down, true);
    panel.addEventListener("pointerup", up, true);
    panel.addEventListener("pointercancel", cancel, true);
    panel.addEventListener("click", click, true);
    return () => {
      panel.removeEventListener("pointerdown", down, true);
      panel.removeEventListener("pointerup", up, true);
      panel.removeEventListener("pointercancel", cancel, true);
      panel.removeEventListener("click", click, true);
    };
  }, []);
  // A card open over the tab -- an airport's, an airplane's, a past
  // flight's -- has its way back here, at the top left on the tab's
  // line, in place of its own close, at the owner's ask: only while the
  // tabs are not shown (minimized), as iOS's navigation bar's Back.
  const cards = useOpenCards(s => s.count);
  const back = minimized && !consoleOpen && cards > 0;
  if (minimized && !shown) {
    const Icon = upTab.icon;
    return (
      // A tap anywhere on the line shows the tabs, at the owner's ask
      // ("Clicking anywhere on the tabs bar should show tabs except the
      // back/close button should do their action"): the tab's name is the
      // control a keyboard and a screen reader use, the rest of the line a
      // finger's bigger target for it; Back and the close keep their own.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <nav
        ref={bar}
        aria-label="Tabs" className={cn("relative flex h-full w-full cursor-pointer items-center justify-center print:hidden", className)}
        data-testid="tab-bar"
        onClick={event => {
          const pressed = (event.target as HTMLElement).closest("button");
          if (!pressed) setShown(true);
        }}
      >
        {/* Round, as the close at the other end is, at the owner's ask. */}
        {/* Each in a box of the line's height, centred by flex, not by a
            translate: the stock button's press nudges it with a translate
            of its own, which replaced the centring one, and the button
            dropped half its height as it was tapped (seen on the owner's
            phone, 2026-10-13). */}
        {back && (
          // In from the panel's side as far as the card's own words are
          // (the line's px-2 and this left-2, the card's 16), so the two
          // read as the card's, not the tabs', at the owner's ask.
          <span className="absolute inset-y-0 left-2 flex items-center">
            <BackButton onClick={() => closeTopCard()} data-testid="tab-back" />
          </span>
        )}
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
        {/* Setup's too, at the owner's ask ("Why don't I see back and close
            buttons on settings tabs?"): there it puts the console away and
            the sheet down, its own pages having their own way back. */}
        {onClose && (
          // On the card's own close column: the airport card's star and
          // chip stand 4 points out of the card's 16 (its -mr-1), so the
          // close does too, one column with them, at the owner's ask.
          <span className="absolute inset-y-0 right-1 flex items-center">
            <CloseButton onClick={() => { if (consoleOpen) setConsoleOpen(false); onClose(); }} data-testid="tab-close" />
          </span>
        )}
      </nav>
    );
  }
  return (
    <nav ref={bar} aria-label="Tabs" className={cn("flex h-full w-full items-stretch print:hidden", className)} data-testid="tab-bar">
      {all.map(({ value, label, icon: Icon }) => {
        const current = value === up;
        const mark = value === "settings" ? undefined : marks?.[value as T];
        return (
          <button
            key={value} type="button" aria-current={current ? "page" : undefined}
            onClick={() => {
              if (current) {
                setShown(false);
                onUp?.();
                return;
              }
              pick(value);
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
