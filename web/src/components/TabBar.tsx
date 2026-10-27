import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Settings, Share, type LucideIcon } from "lucide-react";
import CloseButton from "./CloseButton";
import RoundButton from "./RoundButton";
import { cn } from "cn";
import { closeTopCard, useOpenCards, type RouteCard } from "../lib/openCards";
import { prefersReducedMotion } from "../lib/motion";
import { TEXT } from "../lib/text";
import TabGlass from "./TabGlass";
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
 *
 * The tab up's capsule is iOS 26's lens, at the owner's ask (their
 * recording of Netflix's tab bar, 2026-10-16): a finger held on the tabs
 * lifts it into a drop of glass under the finger and the pill grows a
 * little; slid along the tabs it follows the finger, the tab under it
 * lit, and let go it picks that tab, as a tap on it does. Up or down, the
 * finger drags the sheet instead, the tabs being its handle too.
 */
/** A wheel gesture's state, the page's: the bar is drawn afresh as a step
 *  changes the tab (its minimized line or the tabs), and a gesture's later
 *  events, heard by the new one, took a second step. */
const WHEEL = { sum: { x: 0, y: 0 }, quietUntil: 0, idle: 0 };

/** How long a finger rests on the tabs before the lens lifts under it, in
 *  milliseconds. The tabs are the sheet's handle as well, and a drag of
 *  the sheet that starts on them has gone its ten points by then, so the
 *  lens does not flash up under every drag -- as an iOS scroll view holds
 *  a touch back from what is under it (UIScrollView's
 *  delaysContentTouches). A finger that slides along them lifts it at
 *  once. */
const LIFT_MS = 100;

/** How far a finger goes along the tabs before it is sliding the lens
 *  rather than tapping: the ten points the sheet's own drag waits for
 *  (useDetentDrag's DRAG_SLOP), so the two decide alike. */
const SLIDE_SLOP = 10;

/** The lens's two edges, in seconds: the one it moves toward is quicker
 *  than the one it leaves, so it stretches as it goes and gathers up as
 *  it lands, as iOS 26's drop of glass does. Under a sliding finger,
 *  none: it is where the finger is. */
const EDGE = { lead: 0.2, trail: 0.36 };
const EASE = "cubic-bezier(0.2, 0.9, 0.3, 1)";

/** The pill under a finger on its tabs, grown as iOS 26's tab bar grows:
 *  327 points across to 343 in the owner's recording, 5% -- or as much of
 *  that as leaves it PILL_CLEAR points in from the screen's sides, a
 *  phone's pill being in only eight from them, where 5% of it reached
 *  past them. */
const PILL_GROWN = 1.05;
const PILL_CLEAR = 3;

/** How long the click a tap or a slide of the lens ends in is waited for,
 *  in milliseconds, to be passed over (passOverClick). */
const CLICK_AFTER_MS = 600;
/** How long after a press that put a menu away its tap is taken as that
 *  alone, ms: a tap's click follows its press within a few hundred. */
const DISMISS_MS = 600;

/** The click a finger's tap or slide on the tabs ends in, passed over
 *  wherever it lands: the tab was picked as the finger lifted, and the
 *  click a phone makes of the same touch comes after -- by then on the
 *  minimized line, maybe, where it showed the tabs again. Not a click
 *  after the next finger down, nor one CLICK_AFTER_MS on: one that never
 *  came. */
function passOverClick() {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    done();
  };
  const done = () => {
    window.clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", done, true);
  };
  const timer = window.setTimeout(done, CLICK_AFTER_MS);
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", done, true);
}

/** The lens lifted: its middle along the bar and the bar's width, in the
 *  bar's own pixels, a tab's width, the tab under it, which way it last
 *  moved, and whether the finger is sliding it. */
interface Lifted { x: number; width: number; tab: number; over: number; dir: number; sliding: boolean }

/** Where `clientX` is along `bar`, in the bar's own pixels -- not the
 *  screen's, the pill being grown -- held to the first and last tabs'
 *  middles, and the tab under it. */
function along(bar: HTMLElement, count: number, clientX: number) {
  const box = bar.getBoundingClientRect();
  const width = bar.offsetWidth;
  const tab = width / count;
  const x = Math.min(width - tab / 2, Math.max(tab / 2, (clientX - box.left) * (width / (box.width || width))));
  return { x, width, tab, over: Math.min(count - 1, Math.floor(x / tab)) };
}

export default function TabBar<T extends string>({ tabs, tab, over, title, onPick, onUp, marks, onClose, routeShare, listOver = false, className }: {
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
  const upAt = all.findIndex(t => t.value === up);
  // A tab picked as a tap on it picks it: Setup's the console, the others
  // the workspace's (onPick).
  const pick = (value: T | "setup") => {
    setShown(false);
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
  // A tab tapped, or the lens let go on it (below). Another tab opens at
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
  useEffect(() => {
    const barMinimized = minimized && !consoleOpen;
    useOpenCards.setState({ barMinimized });
    return () => useOpenCards.setState({ barMinimized: false });
  }, [minimized, consoleOpen]);
  // A swipe across the panel goes back only, at the owner's ask ("let's
  // not support swipe to switch tabs... Swipe should only support going
  // back"): to the right, as iOS's swipe back goes, what the bar's close
  // takes away -- the card over the tab, a list in full, a Setup page
  // (lib/openCards) -- one at a time; to the left, nothing, as there
  // is nothing forward. The tabs change by a tap, or the lens slid along
  // them (the glass bubble, as iOS's tab bar's). Listened for on the
  // whole panel -- but not a field, a slider or anything that scrolls
  // sideways (the Favorites' strip, the nav log's table), which keep the
  // finger, nor the tabs themselves, along which a finger slides the lens.
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
        if (el.matches("input, textarea, select, [contenteditable=true], [role=slider], [aria-roledescription], [data-point], [data-lens], .leaflet-container")) return true;
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
  // The lens (above): lifted under a finger, or at rest on the tab up --
  // with the way it last moved there, which edge leads.
  const [lens, setLens] = useState<Lifted | null>(null);
  const [rest, setRest] = useState({ at: upAt, dir: 0 });
  if (rest.at !== upAt) setRest({ at: upAt, dir: Math.sign(upAt - rest.at) });
  // The finger on the tabs: where it went down and is now, and whether it
  // is sliding the lens.
  const gesture = useRef<{ id: number; x: number; y: number; lastX: number; sliding: boolean; timer: number } | null>(null);
  // The lens lifted, or moved along, under the finger at `clientX`.
  const lift = (clientX: number, sliding: boolean) => {
    const el = bar.current;
    if (!el?.hasAttribute("data-lens")) return;
    const at = along(el, all.length, clientX);
    setLens(was => {
      const from = was ? was.x : (upAt + 0.5) * at.tab;
      return { ...at, sliding, dir: at.x === from ? was?.dir ?? 0 : Math.sign(at.x - from) };
    });
  };
  // And put down, on the tab `at` -- the one it was let go on, or the tab
  // up again.
  const putDown = (at: number) => {
    const g = gesture.current;
    if (g) window.clearTimeout(g.timer);
    gesture.current = null;
    if (lens) setRest({ at, dir: Math.sign((at + 0.5) * lens.tab - lens.x) });
    setLens(null);
  };
  // The tabs minimized under the finger (the sheet dragged up): none up.
  if (lens && minimized && !shown) setLens(null);
  // The pill grows while the lens is up, as iOS 26's tab bar does; the
  // sheet, which is not a tab bar, stays as it is, and with Reduce Motion
  // so does the pill.
  const lifted = lens !== null;
  const shrinking = useRef<Animation | null>(null);
  useEffect(() => {
    const panel = bar.current?.closest<HTMLElement>("[data-slot=map-panel]");
    if (!lifted || !panel?.hasAttribute("data-capsule") || prefersReducedMotion()) return;
    // Its own size and place, not as a shrinking still under way has it.
    const box = panel.getBoundingClientRect();
    const width = panel.offsetWidth;
    const left = box.left + (box.width - width) / 2;
    const room = Math.min(left, document.documentElement.clientWidth - left - width) - PILL_CLEAR;
    const grown = Math.min(PILL_GROWN, 1 + (2 * Math.max(0, room)) / width);
    // From where the last one's shrinking had got to, a tap after a tap.
    const scaled = () => getComputedStyle(panel).scale.replace("none", "1");
    const from = scaled();
    shrinking.current?.cancel();
    const grow = panel.animate({ scale: [from, `${grown}`] }, { duration: 160, easing: EASE, fill: "forwards" });
    return () => {
      const now = scaled();
      grow.cancel();
      shrinking.current = panel.animate({ scale: [now, "1"] }, { duration: 220, easing: EASE });
    };
  }, [lifted]);
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
              <RoundButton label={title ? `Share ${title}` : "Share"} onClick={() => { if (typeof share === "function") share(); }} data-testid="tab-share">
                <Share className="size-5!" strokeWidth={2} />
              </RoundButton>
            )}
          </span>
        )}
        <button
          type="button" onClick={showTabs} aria-expanded={false} aria-label={`${title ?? named.label}, show the tabs`}
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
            <CloseButton
              // Back one: the card on top, a list in full, a Setup page;
              // with none, the tab put away.
              label={anyOpen ? "Back" : "Close"}
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
  // at the bottom"): a little in from its quarter's sides, sliding to the
  // tab picked, its leading edge first. Under the tabs, which take the
  // taps. Lifted, the lens: under the finger, bigger past the tab on every
  // side, as iOS 26's grows when a tab is held and dragged (the owner's
  // ask), and clearer, a drop of glass over the bar.
  const count = all.length;
  const dir = lens ? lens.dir : rest.dir;
  const { lead, trail } = EDGE;
  const lensStyle: CSSProperties = {
    // Slid under a finger, its sides keep up with the finger, as the
    // sheet's lens does (TabGlass): eased behind it, the pill's lagged and
    // was laid out again every frame of the easing, at the owner's
    // "sliding the tab selection is slower when in pill" (2026-10-24).
    transition: [
      ...(lens?.sliding ? [] : [`left ${dir > 0 ? trail : lead}s ${EASE}`, `right ${dir < 0 ? trail : lead}s ${EASE}`]),
      `top 0.16s ${EASE}`, `bottom 0.16s ${EASE}`, "background-color 0.16s", "box-shadow 0.16s",
    ].join(", "),
    ...(lens
      // Bigger, above most, at the owner's ask ("make the bubble bigger,
      // specially bigger on the top part"): at rest a point past the bar's
      // top, lifted ten past it and five below.
      ? { top: -10, bottom: -5, left: lens.x - lens.tab / 2 - 7, right: lens.width - lens.x - lens.tab / 2 - 7 }
      : { top: -1, bottom: 1, left: `calc(${upAt} * 100% / ${count} + 2px)`, right: `calc(${count - 1 - upAt} * 100% / ${count} + 2px)` }),
  };
  // The tab in the tint: the one under the lens while it is up.
  const lit = lens ? lens.over : upAt;
  return (
    <nav
      ref={bar} aria-label="Tabs" data-testid="tab-bar" data-lens=""
      className={cn("relative flex h-full w-full touch-none items-stretch select-none [-webkit-touch-callout:none] print:hidden", className)}
      // A finger down: the lens lifts if it stays (LIFT_MS), or as soon as
      // it slides along.
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        if (gesture.current) window.clearTimeout(gesture.current.timer);
        const g = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, sliding: false, timer: 0 };
        g.timer = window.setTimeout(() => { if (gesture.current === g) lift(g.lastX, false); }, LIFT_MS);
        gesture.current = g;
      }}
      onPointerMove={event => {
        const g = gesture.current;
        if (!g || event.pointerId !== g.id) return;
        const dx = event.clientX - g.x, dy = event.clientY - g.y;
        g.lastX = event.clientX;
        if (!g.sliding) {
          // Up or down first: the sheet's drag (useDetentDrag), not the lens.
          if (Math.abs(dy) >= SLIDE_SLOP && Math.abs(dy) >= Math.abs(dx)) {
            putDown(upAt);
            return;
          }
          if (Math.abs(dx) < SLIDE_SLOP) {
            if (lens) lift(event.clientX, false);
            return;
          }
          g.sliding = true;
          window.clearTimeout(g.timer);
          // Followed off the bar too: a mouse leaves it as it slides.
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // A pointer that is not down -- a script's -- has none to take.
          }
        }
        // The lens's own, which the sheet's drag leaves alone.
        event.preventDefault();
        lift(event.clientX, true);
      }}
      // Let go: a tap on the tab under the finger, or the lens set down on
      // the tab under it, which picks it as a tap does -- but not the tab
      // it was lifted from, which stays as it was, as iOS's does.
      onPointerUp={event => {
        const g = gesture.current;
        if (!g || event.pointerId !== g.id) return;
        const { over } = along(event.currentTarget, count, g.sliding ? event.clientX : g.x);
        putDown(over);
        passOverClick();
        if (g.sliding && over === upAt) return;
        tapped(all[over]!.value);
      }}
      onPointerCancel={event => {
        if (gesture.current?.id === event.pointerId) putDown(upAt);
      }}
      // The bar's hold on a sliding finger lost with the finger still down.
      onLostPointerCapture={event => {
        if (event.target === event.currentTarget && gesture.current?.id === event.pointerId) putDown(upAt);
      }}
      // A finger held on the tabs is the lens's, not a long press's menu.
      onContextMenu={event => {
        if (gesture.current) event.preventDefault();
      }}
    >
      {/* In the sheet, the tab up out of a line of glass (TabGlass, the
          owner's 2e), lifted under a finger as the same tab; in the pill,
          a capsule of the same glass. */}
      {upAt >= 0 && size?.size !== "peek" && (
        <TabGlass
          at={upAt} count={count} lifted={lens ? { x: lens.x, tab: lens.tab } : null}
          // Slid under a finger, it keeps up with the finger: no easing
          // behind it, which left it a fifth of a second back (the owner's
          // "Dragging tab bubble is slow"); lifted, set down or moved to
          // another tab, the bar's own pace.
          transition={lens?.sliding ? "none" : `left ${dir > 0 ? trail : lead}s ${EASE}, width ${dir < 0 ? trail : lead}s ${EASE}`}
        />
      )}
      {upAt >= 0 && size?.size === "peek" && (
        <span
          aria-hidden="true" data-testid="tab-bubble" data-lifted={lens ? "" : undefined}
          className={cn(
            // The same flat pane of the tint as the tab up's in the sheet
            // (TabGlass), so the bar reads alike at every height (the
            // owner's "Why does the tab selection look different from small
            // detent to medium detent", 2026-10-26). Lifted, a step deeper.
            "pointer-events-none absolute rounded-2xl", lens ? "bg-tint/16" : "bg-tint/10",
          )}
          style={lensStyle}
        />
      )}
      {all.map(({ value, label, icon: Icon }, at) => {
        const current = value === up;
        const mark = value === "setup" ? undefined : marks?.[value as T];
        return (
          <button
            key={value} type="button" aria-current={current ? "page" : undefined}
            // A keyboard's and a screen reader's tap; a finger's is picked as
            // it lifts (above).
            onClick={() => tapped(value)}
            data-testid={value === "setup" ? "setup-button" : `tab-${value}`} data-current={current || undefined}
            data-lit={at === lit || undefined}
            data-console-button={value === "setup" ? "" : undefined}
            // Its mark said to a reader, after its name.
            aria-label={mark ? `${label}, ${mark === "stop" ? "warning" : "caution"}` : undefined}
            className={cn(
              // Over the bubble (positioned, so drawn after it), in the
              // middle of the bar's 56 points.
              "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-px rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // The others a darker grey, at the owner's pick of the tabs'
              // sizes ("A, plus D's bolder weight", 2026-10-22): they read
              // from farther, in sun, on the glass over any chart.
              // The tab up's word is on its pane of the tint over the sheet's
              // grey, which the plain tint clears by 4.6:1 at best (4.2:1 over
              // a darker ground) where WCAG 1.4.3 asks 4.5:1 of 13-point
              // text: the tint's deeper step (--tint-shade, as SHEET_BELOW
              // takes for what lies under the bar) is 5.5:1 and 5.0:1.
              at === lit ? "text-tint [--tint:var(--tint-shade)]" : "text-foreground/80 hover:text-foreground",
            )}
          >
            <span className="relative">
              {/* 28 and 13, bolder lines, at the owner's pick (A with D's
                  weight, 2026-10-22); the tab up's a touch bigger under its
                  glass, as a lens magnifies, its room kept (a transform). */}
              <Icon className={cn("size-7 transition-transform", at === lit && "scale-[1.08]")} strokeWidth={at === lit ? 2.5 : 2.1} aria-hidden="true" />
              {mark && (
                <span
                  aria-hidden="true" data-testid={`tab-mark-${value}`} data-finding={mark}
                  className={cn("absolute -top-0.5 -right-1 size-2 rounded-full", mark === "stop" ? "bg-destructive" : "bg-caution")}
                />
              )}
            </span>
            <span className={cn(at === lit ? "font-bold" : "font-semibold", TEXT.tab)}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
