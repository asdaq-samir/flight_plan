import { useContext, useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, Share } from "lucide-react";
import { GearGlyph, type TabGlyph } from "./tabGlyphs";
import CloseButton from "./CloseButton";
import RoundButton from "./RoundButton";
import { cn } from "cn";
import { closeTopCard, useOpenCards, type RouteCard } from "../lib/openCards";
import { TEXT } from "../lib/text";
import { BarOverPicture, PanelSize, TabBarMinimized, useConsoleOpen, useTabsShown } from "./mapChrome";
import { ON_PILL_PICTURE } from "./PillPicture";
import { barHeadRef, closeSheetCards, useSheetCards } from "../lib/sheetCards";

/** One of a page's places, a tab of its bar: its word and its glyph. */
export interface BarTab<T extends string> {
  value: T;
  label: string;
  icon: TabGlyph;
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
 *
 * The tabs are plain buttons, the tab up in a tinted capsule of its own,
 * and the sheet's handle as well: up or down, a finger on them drags the
 * sheet (MapPanel), and a tap that does not move picks the tab. The lens
 * of iOS 26 -- a finger held lifting a drop of glass, slid along the tabs
 * -- went with the sheet's rewrite (2026-11-04): the owner found the tabs
 * glitchy, and the lens's capture and its grown pill were a good part of
 * why.
 */
/** How long after a press that put a menu away its tap is taken as that
 *  alone, ms: a tap's click follows its press within a few hundred. */
const DISMISS_MS = 600;

/** A wheel gesture's state, the page's: the bar is drawn afresh as a step
 *  changes the tab (its minimized line or the tabs), and a gesture's later
 *  events, heard by the new one, took a second step. */
const WHEEL = { sum: { x: 0, y: 0 }, quietUntil: 0, idle: 0 };


export default function TabBar<T extends string>({ tabs, tab, over, title: given, onPick, onUp, marks, onClose, routeShare, listOver = false, className }: {
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
   *  tab put away and the sheet down to its pill, at the owner's ask; over
   *  a card with a share, one card back, as Back went. */
  onClose?: () => void;
  /** The route's Share menu for one of its cards, in Back's place over
   *  the Brief, the nav log and the profile: each card's own items. */
  routeShare?: (card: RouteCard) => ReactNode;
  /** A list in full open over the tab -- its Favorites, Saved, Nearest --
   *  which the tab up tapped again puts away (`onUp`), the sheet where it
   *  is, as it puts a card away: lists keep their place as cards do, at
   *  the owner's pick ("Yes to both"). */
  listOver?: boolean;
  className?: string;
}) {
  const consoleOpen = useConsoleOpen(s => s.open);
  const setConsoleOpen = useConsoleOpen(s => s.setOpen);
  // A card opened over the tab from a control or the chart (SheetCard):
  // its name on the minimized bar, whose close puts it away first.
  const cardName = useSheetCards(s => s.stack.at(-1)?.title);
  // Or a map card's, which draws its name in its own head, given for the
  // pill (MapCard's `pill`).
  const pillName = useOpenCards(s => s.pill?.name);
  const title = cardName ?? pillName ?? given;
  // A card on top that draws its own name (a map card's, MapCard into its
  // head): the bar names nothing over it, where it showed the tab's name
  // and menu over an airspace's card (the owner, 2026-10-29: "the tab
  // title shouldn't be shown either"); down at the pill, where the card
  // is out of sight, the tab's name is all that says what is open.
  const cardNamesItself = useSheetCards(s => s.stack.length > 0 && s.stack.at(-1)?.title === undefined);
  const all: BarTab<T | "setup">[] = [...tabs, { value: "setup", label: "Setup", icon: GearGlyph }];
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
    // Another tab's page is not what a card was opened over: put away.
    closeSheetCards();
    if (value === "setup") {
      setConsoleOpen(true);
      return;
    }
    if (consoleOpen) {
      setConsoleOpen(false);
      // Back from Setup to the tab under it: that tab as it was left, a
      // card open over it still open, as each of an iOS app's tabs keeps
      // its own screen -- not the tab up tapped again, which puts its card
      // away, at the owner's notice ("When I open an aircraft card and go
      // to setup and come back, to aircraft tab, the card is not there
      // anymore").
      if (value === tab) return;
    }
    onPick(value as T);
  };
  // A tab tapped. Another tab opens at
  // the size the sheet is, half from Setup's pill; the tab up tapped again
  // puts its card away, as an iOS tab tapped goes back to its first screen
  // (onClose), or else lowers the sheet a size. Outside a panel (none), the
  // tab's own.
  const tapped = (value: T | "setup") => {
    const current = value === up;
    setShown(false);
    if (!size) {
      if (current) onUp?.();
      else pick(value);
      return;
    }
    // Another tab picked all the way up stays all the way up, on that tab,
    // at the owner's ask ("tapping on other tabs when card is fully open
    // should switch to that tab").
    if (!current) {
      pick(value);
      if (size.size === "peek") size.to("half");
    } else if (size.card) onClose?.();
    else if (listOver && size.size !== "peek") onUp?.();
    else size.to(size.size === "full" ? "half" : size.size === "half" ? "peek" : "half");
  };
  // A card open over the tab -- an airport's, an airplane's, a past
  // flight's, the Brief -- has its Share at the top left on the tab's line,
  // where it has one, and its way back is the bar's close: no Back, at the
  // owner's ask ("remove the back buttons, because close button should
  // behave as the back button", 2026-10-22). Only while the tabs are not
  // shown (minimized).
  const cards = useOpenCards(s => s.count);
  const anyOpen = useOpenCards(s => s.total) > 0;
  const back = minimized && !consoleOpen && cards > 0;
  // An airport's card and an airplane's have their Share there instead,
  // and their close goes back one card as Back did, at the owner's ask
  // ("replace the back button on airport/aircraft with the share button.
  // The close button should behave like the back button", 2026-10-20).
  const share = useOpenCards(s => s.share);
  const shareInstead = back && (typeof share === "function" || (typeof share === "string" && !!routeShare));
  // In the pill over an airport's or an airplane's picture (MapPanel's
  // PillPicture): white on its shade, the card's line under its name.
  const overPicture = useContext(BarOverPicture) && back;
  const pillLine = useOpenCards(s => s.pill?.line);
  // A swipe across the panel goes back only, at the owner's ask ("let's
  // not support swipe to switch tabs... Swipe should only support going
  // back"): to the right, as iOS's swipe back goes, what the bar's close
  // takes away -- the card over the tab, a list in full, a Setup page
  // (lib/openCards) -- one at a time; to the left, nothing, as there
  // is nothing forward. The tabs change by a tap. Listened for on the
  // whole panel -- but not a field, a slider or anything that scrolls
  // sideways (the Favorites' strip, the nav log's table), which keep the
  // finger.
  const bar = useRef<HTMLElement | null>(null);
  // A tap that puts a menu away -- Share's, over the Brief or the nav log
  // -- only puts it away: on the owner's iPhone the tap on the card's name
  // that closed Share's menu went on to the name, and the tabs came up in
  // the card's bar. When a menu was last open under a finger, on the
  // document's own capture, before the menu's portal takes the press.
  const dismissedAt = useRef(-Infinity);
  useEffect(() => {
    const down = () => { if (document.querySelector('[role="menu"]')) dismissedAt.current = performance.now(); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  const showTabs = () => { if (performance.now() - dismissedAt.current > DISMISS_MS) setShown(true); };
  const step = useRef<(by: 1 | -1) => boolean>(() => false);
  useEffect(() => {
    // Whether it went back: a swipe that did nothing leaves the next tap be.
    step.current = by => {
      // The top card, list in full or Setup page closed, as the close does.
      return by < 0 && closeTopCard();
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
        // A card's pictures (PhotoHead) swipe to their next page.
        if (el.matches("input, textarea, select, [contenteditable=true], [role=slider], [data-slot=slider], [aria-roledescription], [data-point], [data-slot=carousel], .maplibregl-map")) return true;
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
      swiped = step.current(dx < 0 ? 1 : -1);
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
        if (el.matches("input, textarea, select, [contenteditable=true], [role=slider], [data-slot=slider], .maplibregl-map")) return true;
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
          // Not a tap in what the bar opened (the route's Share menu, in a
          // portal of its own), whose clicks come up through it here.
          if (!event.currentTarget.contains(event.target as Node)) return;
          const pressed = (event.target as HTMLElement).closest("button");
          if (!pressed) showTabs();
        }}
      >
        {/* Round, as the close at the other end is, at the owner's ask. */}
        {/* Each in a box of the line's height, centred by flex, not by a
            translate: the stock button's press nudges it with a translate
            of its own, which replaced the centring one, and the button
            dropped half its height as it was tapped (seen on the owner's
            phone, 2026-10-13). */}
        {back && shareInstead && (
          // In from the panel's side as far as the card's own words are
          // (the line's px-2 and this left-2, the card's 16), so the two
          // read as the card's, not the tabs', at the owner's ask.
          <span className="absolute inset-y-0 left-2 flex items-center">
            {typeof share === "string" ? routeShare?.(share) : (
              // Drawn as the close is: the glyph in the text's colour on
              // the round glass button, a thin line.
              <RoundButton label={title ? `Share ${title}` : "Share"} onClick={() => { if (typeof share === "function") share(); }} className={cn(overPicture && ON_PILL_PICTURE)} data-testid="tab-share">
                <Share className="size-5!" strokeWidth={2} />
              </RoundButton>
            )}
          </span>
        )}
        {/* Out of the pill, the row a map card's mark and name are drawn
            in (SheetCard), the close beside them. */}
        {cardNamesItself && size?.size !== "peek" && (
          <div ref={barHeadRef} className="absolute inset-y-0 right-14 left-4 flex min-w-0 items-center gap-2.5 text-left" data-testid="tab-card-head" />
        )}
        <button
          type="button" onClick={showTabs} aria-expanded={false} aria-label={`${title ?? named.label}, show the tabs`}
          data-testid="tab-title" hidden={cardNamesItself && size?.size !== "peek"}
          className={cn(
            "relative flex h-8 min-w-0 max-w-[calc(100%-7rem)] items-center gap-1.5 rounded-full px-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Its 44 points, 6 over and under its 32 (the audit centres the
            // square on it); the minimized row's room over it keeps them clear
            // of the grabber's (MapPanel).
            "after:absolute after:-inset-x-2 after:-inset-y-1.5 after:content-['']", overPicture ? "text-white" : title ? "text-foreground" : "text-tint", TEXT.row,
            overPicture && pillLine && "h-auto flex-col justify-center gap-0 leading-tight",
          )}
        >
          {/* Two lines over a card's picture, as P5 has them: the name
              large and bold, what the card says of it first under it. */}
          {title && overPicture && pillLine ? (
            <>
              <span className={cn("max-w-full truncate font-bold", TEXT.row)} data-testid="tab-title-name">{title}</span>
              <span className={cn("max-w-full truncate font-normal", TEXT.note)} data-testid="tab-title-line">{pillLine}</span>
            </>
          ) : title ? <span className="truncate" data-testid="tab-title-name">{title}</span> : (
            <>
              <Icon className="size-5" />
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
            <CloseButton
              // Back one: the card on top, a list in full, a Setup page;
              // with none, the tab put away.
              label={anyOpen ? "Back" : "Close"} className={cn(overPicture && ON_PILL_PICTURE)}
              onClick={() => {
                if (closeTopCard()) return;
                if (consoleOpen) setConsoleOpen(false);
                onClose();
              }}
              data-testid="tab-close"
            />
          </span>
        )}
      </nav>
    );
  }
  // The tab up in a capsule of its own, as iOS 26's tab bar draws it, at
  // the owner's ask ("Can we have a selection bubble like target tabs does
  // at the bottom"): a flat pane of the tint (the style audit, 2026-10-26)
  // behind the tab's glyph and word. The bar does nothing with a finger
  // itself: the sheet's drag hears it (MapPanel's head), and a press that
  // does not move is the button's own click.
  return (
    <nav
      ref={bar} aria-label="Tabs" data-testid="tab-bar"
      className={cn("relative flex h-full w-full touch-none items-stretch select-none [-webkit-touch-callout:none] print:hidden", className)}
    >
      {all.map(({ value, label, icon: Icon }) => {
        const current = value === up;
        const mark = value === "setup" ? undefined : marks?.[value as T];
        return (
          <button
            key={value} type="button" aria-current={current ? "page" : undefined}
            onClick={() => tapped(value)}
            data-testid={value === "setup" ? "setup-button" : `tab-${value}`} data-current={current || undefined}
            data-console-button={value === "setup" ? "" : undefined}
            // Its mark said to a reader, after its name.
            aria-label={mark ? `${label}, ${mark === "stop" ? "warning" : "caution"}` : undefined}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // The others a darker grey, at the owner's pick of the tabs'
              // sizes ("A, plus D's bolder weight", 2026-10-22): they read
              // from farther, in sun, on the glass over any chart. The tab
              // up's word on its pane of the tint over the sheet's grey,
              // which the plain tint clears by 4.6:1 at best where WCAG
              // 1.4.3 asks 4.5:1 of 13-point text: the tint's deeper step
              // (--tint-shade) is 5.5:1 and 5.0:1.
              current ? "text-tint [--tint:var(--tint-shade)]" : "text-foreground/80 hover:text-foreground",
            )}
          >
            {/* A capsule round the glyph and its word with room on every
                side, as iOS 26's tab bar draws the tab up, not a rounded
                box the glyph and word touched (the owner: "is that Apple
                standard? Looks a bit short", 2026-11-04): the tab's
                whole height, 50, its ends round. */}
            {current && <span aria-hidden="true" data-testid="tab-bubble" className="pointer-events-none absolute inset-x-1 inset-y-0 rounded-full bg-tint/12" />}
            <span className="relative">
              {/* 26 and 12 (2026-11-04), once 28 and 13 (A with D's weight,
                  2026-10-22); the glyphs the planner's own (tabGlyphs), in
                  outline, and filled for the tab up, as iOS's tab bars
                  draw their symbols (the owner's ask for crisp, modern
                  graphics, 2026-11-04). */}
              <Icon className="size-[26px]" filled={current} />
              {mark && (
                <span
                  aria-hidden="true" data-testid={`tab-mark-${value}`} data-finding={mark}
                  className={cn("absolute -top-0.5 -right-1 size-2 rounded-full", mark === "stop" ? "bg-destructive" : "bg-caution")}
                />
              )}
            </span>
            <span className={cn("relative", current ? "font-bold" : "font-semibold", TEXT.tabBar)}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
