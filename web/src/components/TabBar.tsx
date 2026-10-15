import { useContext, useEffect, useRef } from "react";
import { ChevronDown, Settings, type LucideIcon } from "lucide-react";
import BackButton from "./BackButton";
import CloseButton from "./CloseButton";
import { cn } from "cn";
import { closeTopCard, useOpenCards } from "../lib/openCards";
import { TEXT } from "../lib/text";
import { PanelSize, TabBarMinimized, useConsoleOpen, useTabsShown } from "./mapChrome";

/** One of a page's places, a tab of its bar: its word and its glyph. */
export interface BarTab<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

/**
 * A page's tabs, at the pilot's ask, as ForeFlight's and every iOS app's
 * tab bar -- a glyph and its word, the one picked in the tint: the
 * planner's Aircraft, Airport and FPL, the developer's Train and
 * Perf, and on both Setup last. The panel's first row, over its pill
 * at rest as over the sheet (MapPanel). Buttons that say which is
 * current, not tab roles: each is a place of its own, with no tabpanel of
 * the promise a tab role makes.
 *
 * Setup is the console, out while it is the tab picked, where it was a
 * gear beside every search field, at the pilot's ask: each card has its
 * search bar the whole width. One name for it in the code too, "setup"
 * (the tab's value, its test id setup-button), where it was "settings",
 * "personal" and "Account" by turns as the tab was renamed. Its button is
 * where the focus goes back to as the console closes
 * (`data-console-button`, MapPage).
 *
 * Out of the pill, the sheet up on a phone, it is minimized, as iOS 26's
 * tab bar minimizes, at the pilot's ask: the tab up's glyph and name
 * alone, centred, in the tint; tapped, every tab again at the height the
 * sheet is, minimized once one is picked.
 */
/** A wheel gesture's state, the page's: the bar is drawn afresh as a step
 *  changes the tab (its minimized line or the tabs), and a gesture's later
 *  events, heard by the new one, took a second step. */
const WHEEL = { sum: { x: 0, y: 0 }, quietUntil: 0, idle: 0 };

export default function TabBar<T extends string>({ tabs, tab, over, title, onPick, onUp, marks, onClose, className }: {
  tabs: BarTab<T>[];
  tab: T;
  /** The tab whose card is open over `tab` -- Airport's, an airport's card
   *  opened from FPL's route: the minimized bar's name, Back to `tab`. */
  over?: T;
  /** The card's own name over it -- an airport's ident, an airplane's
   *  callsign -- in place of the tab's, at the owner's ask ("replace tabs
   *  with a back close button and title as the airport id"). */
  title?: string;
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
  const all: BarTab<T | "setup">[] = [...tabs, { value: "setup", label: "Setup", icon: Settings }];
  const up: T | "setup" = consoleOpen ? "setup" : tab;
  const minimized = useContext(TabBarMinimized);
  const size = useContext(PanelSize);
  const shown = useTabsShown(s => s.shown);
  const setShown = (next: boolean) => useTabsShown.setState({ shown: next });
  // In the pill again, minimized again the next time the sheet is up.
  useEffect(() => {
    if (!minimized && shown) useTabsShown.setState({ shown: false });
  }, [minimized, shown]);
  const upTab = all.find(t => t.value === up)!;
  // A tab picked as a tap on it picks it: Setup's the console, the others
  // the workspace's (onPick).
  const pick = (value: T | "setup") => {
    setShown(false);
    if (value === "setup") {
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
  // With a mouse's wheel or a trackpad, as a finger's drag and swipe on a
  // phone, at the owner's ask ("on a desktop, the scrolling should
  // transition the layout and tabs"): scrolled down over the panel it
  // comes up a size (the tabs alone, the pill, all the way), up it goes
  // down one; sideways it goes to the tab beside the one up. Not while what
  // is under the pointer can scroll that way itself -- the nav log, a list,
  // a strip -- which keeps the wheel, nor over a field or the map. One step
  // a gesture: a trackpad's flick sends a run of events, and the next step
  // waits for a pause in them.
  const sizeNow = useRef(size);
  useEffect(() => { sizeNow.current = size; });
  useEffect(() => {
    const panel = bar.current?.closest<HTMLElement>("[data-slot=map-panel]");
    if (!panel) return;
    const g = WHEEL;
    const scrolls = (target: EventTarget | null, dx: number, dy: number) => {
      for (let el = target as HTMLElement | null; el && el !== panel; el = el.parentElement) {
        if (el.matches("input, textarea, select, [contenteditable=true], [role=slider], .leaflet-container")) return true;
        const style = getComputedStyle(el);
        if (dy !== 0 && (style.overflowY === "auto" || style.overflowY === "scroll")
          && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)) return true;
        if (dx !== 0 && (style.overflowX === "auto" || style.overflowX === "scroll")
          && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0)) return true;
      }
      return false;
    };
    const wheel = (event: WheelEvent) => {
      const now = performance.now();
      window.clearTimeout(g.idle);
      g.idle = window.setTimeout(() => { g.sum = { x: 0, y: 0 }; g.quietUntil = 0; }, 180);
      if (now < g.quietUntil) return;
      const across = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (scrolls(event.target, across ? event.deltaX : 0, across ? 0 : event.deltaY)) {
        g.sum = { x: 0, y: 0 };
        return;
      }
      event.preventDefault();
      g.sum = { x: g.sum.x + event.deltaX, y: g.sum.y + event.deltaY };
      const sum = g.sum;
      // Sixty pixels of a gesture, about a notch of a wheel or a short
      // flick of two fingers.
      if (Math.abs(sum.x) >= 60 && Math.abs(sum.x) > 2 * Math.abs(sum.y)) {
        step.current(sum.x > 0 ? 1 : -1);
      } else if (Math.abs(sum.y) >= 60 && Math.abs(sum.y) > Math.abs(sum.x)) {
        const sheet = sizeNow.current;
        if (!sheet) return;
        if (sum.y > 0 && sheet.size !== "full") sheet.to(sheet.size === "peek" ? "half" : "full");
        else if (sum.y < 0 && sheet.size !== "peek") sheet.to(sheet.size === "full" ? "half" : "peek");
        else return;
      } else return;
      g.sum = { x: 0, y: 0 };
      // Until the gesture's run of events has stopped.
      g.quietUntil = Number.POSITIVE_INFINITY;
    };
    panel.addEventListener("wheel", wheel, { passive: false });
    return () => {
      panel.removeEventListener("wheel", wheel);
    };
  }, []);
  // A card open over the tab -- an airport's, an airplane's, a past
  // flight's -- has its way back here, at the top left on the tab's
  // line, in place of its own close, at the owner's ask: only while the
  // tabs are not shown (minimized), as iOS's navigation bar's Back.
  const cards = useOpenCards(s => s.count);
  const back = minimized && !consoleOpen && cards > 0;
  if (minimized && !shown) {
    // The card's kind, where it is another tab's over this one.
    const named = (over && all.find(t => t.value === over)) || upTab;
    const Icon = named.icon;
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
          type="button" onClick={() => setShown(true)} aria-expanded={false} aria-label={`${title ?? named.label}, show the tabs`}
          data-testid="tab-title"
          className={cn(
            "relative flex h-8 min-w-0 max-w-[calc(100%-7rem)] items-center gap-1.5 rounded-full px-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "after:absolute after:-inset-x-2 after:-inset-y-1.5 after:content-['']", title ? "text-foreground" : "text-tint", TEXT.row,
          )}
        >
          {title ? <span className="truncate">{title}</span> : (
            <>
              <Icon className="size-5" strokeWidth={2.25} aria-hidden="true" />
              {named.label}
              <ChevronDown className="size-4 text-muted-foreground" strokeWidth={2.25} aria-hidden="true" />
            </>
          )}
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
        const mark = value === "setup" ? undefined : marks?.[value as T];
        return (
          <button
            key={value} type="button" aria-current={current ? "page" : undefined}
            onClick={() => {
              setShown(false);
              // Another tab opens at the size the sheet is, half from
              // Setup's pill; the tab up tapped again puts its card away, as
              // an iOS tab tapped goes back to its first screen (onClose),
              // or else lowers the sheet a size. Outside a panel (none), the
              // tab's own.
              if (!size) {
                if (current) onUp?.();
                else pick(value);
                return;
              }
              // Another tab picked all the way up stays all the way up, on
              // that tab, at the owner's ask ("tapping on other tabs when
              // card is fully open should switch to that tab").
              if (!current) {
                pick(value);
                if (size.size === "peek") size.to("half");
              } else if (size.card) onClose?.();
              else size.to(size.size === "full" ? "half" : size.size === "half" ? "peek" : "half");
            }}
            data-testid={value === "setup" ? "setup-button" : `tab-${value}`} data-current={current || undefined}
            data-console-button={value === "setup" ? "" : undefined}
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
