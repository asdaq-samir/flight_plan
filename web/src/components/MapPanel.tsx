import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "cn";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import { useKeyboardInset, useSafeArea, useWindowHeight } from "../hooks/use-viewport";
import { MATERIAL, PANEL_STATES, type MapInsets, type PanelState } from "./mapChrome";

interface Props {
  /** The panel's name -- "Flight Planning", "Model Training" -- for its
   *  grabber and a screen reader. */
  label: string;
  /** The row over everything, always in sight: the route and the
   *  workspace's actions. */
  top: ReactNode;
  /** The row under it, in sight at rest too: the aeroplane and the
   *  departure time, the rating's progress. */
  controls?: ReactNode;
  /** A notice about the route (not collected yet, an airport to
   *  itself), in sight at rest. */
  notices?: ReactNode;
  /** The body: the nav log and the briefing, the training list. */
  children: ReactNode;
  state: PanelState;
  onStateChange: (state: PanelState) => void;
  onInsetsChange: (insets: MapInsets) => void;
}

/** iOS's sheet curve, the one vaul uses too. */
const SETTLE = "height 0.5s cubic-bezier(0.32, 0.72, 0, 1)";

/** How far a finger moves before a press on the head is a drag rather
 *  than a tap on what it pressed. */
const DRAG_SLOP = 6;

/** The grabber's button: 16 tall, its pill five in from the panel's edge. */
const GRABBER = 16;

/** The margin a card keeps from the screen's edges, and a phone's sheet
 *  from the far one. */
const MARGIN = 8;

/** A card's width from `md` up: 24rem. */
const CARD = 384;

/**
 * The page's one panel over the map, the way Maps on an iPhone has one:
 * the route and the workspace's actions always in sight, the aeroplane
 * and the departure time (or the rating's progress) under them, and the
 * workspace's own content -- the nav log and the briefing, the training
 * list -- under those. It took the place of the header and the drawer at
 * the side.
 *
 * A sheet on the navigation bar's edge (useNavEdge), with iOS's three
 * detents -- resting with its head in sight, half the screen, all of it
 * -- and a grabber on its far edge: drag it, or the head, and it follows
 * the finger and lets go to the detent it was heading for; tap the
 * grabber and it opens or lowers; Escape lowers it. The same from the
 * top of the screen as from the bottom. The screen's width on a phone;
 * from `md` up a card at the left, as Maps' is on an iPad and a Mac. The
 * chart behind it still pans and zooms, and it is never dismissed.
 *
 * Not shadcn's Drawer, which every other sheet here is: vaul builds its
 * drawer on a modal Radix dialog whatever `modal` it is given, so a
 * drawer that never closes held the keyboard's focus inside itself and
 * hid the map, and any dialog opened before it, from a screen reader.
 */
export default function MapPanel({ label, top, controls, notices, children, state, onStateChange, onInsetsChange }: Props) {
  const onPhone = useIsMobile();
  const edge = useNavEdge();
  const safe = useSafeArea();
  const windowHeight = useWindowHeight();
  // With the keyboard up, what it covers is not there: a sheet from the
  // bottom of the screen sits on the keyboard, and a field typed into in
  // it stays in sight, where it went under the keyboard with the page
  // pinned (MapPage) and nothing to scroll it up.
  const keyboard = useKeyboardInset();
  const fromBottom = edge === "bottom";

  // The head's own height decides the lowest detent: the top row and the
  // controls in sight, with the grabber. Measured, since a notice or the
  // text set larger changes it.
  const [head, setHead] = useState<HTMLDivElement | null>(null);
  const [headHeight, setHeadHeight] = useState(120);
  useEffect(() => {
    if (!head) return;
    const observer = new ResizeObserver(() => setHeadHeight(head.offsetHeight));
    observer.observe(head);
    return () => observer.disconnect();
  }, [head]);
  // How tall it can be: a phone's sheet stops eight points short of the
  // far edge's inset (the status bar, the home indicator), as Maps' does;
  // a card keeps a margin at both ends.
  const room = (onPhone
    ? windowHeight - Math.round(fromBottom ? safe.top : safe.bottom) - MARGIN
    : windowHeight - Math.max(MARGIN, Math.round(safe.top)) - Math.max(MARGIN, Math.round(safe.bottom))) - keyboard;
  // A phone's sheet from the bottom runs on to the screen's edge, under
  // the home indicator (or eight points where there is none), so its
  // content sits clear of it -- or on to the keyboard, with it up.
  const edgeInset = onPhone && fromBottom && !keyboard ? Math.max(Math.round(safe.bottom), MARGIN) : 0;
  const peek = Math.round(headHeight + (fromBottom ? edgeInset : GRABBER));
  const detents = useMemo<Record<PanelState, number>>(
    () => ({ peek, half: Math.max(peek, Math.round(room / 2)), full: Math.max(peek, room) }),
    [peek, room],
  );

  // A drag on the grabber or the head follows the finger, and lets go to
  // the detent it was heading for -- where it was thrown, not only where
  // it stopped. A press that does not move is the tap it was. Followed on
  // the window, not by capturing the pointer: a mouse leaves the head as
  // soon as it drags it, and a captured pointer would take the click from
  // a button in the head that was only tapped.
  const [dragged, setDragged] = useState<number | null>(null);
  const swallowClick = useRef(false);
  const shown = dragged ?? detents[state];
  const latest = useRef({ detents, shown, onStateChange, fromBottom });
  useEffect(() => { latest.current = { detents, shown, onStateChange, fromBottom }; });
  const startDrag = (start: ReactPointerEvent) => {
    if (start.button !== 0) return;
    const from = latest.current.shown;
    // Up opens a sheet from the bottom; down opens one from the top.
    const sign = latest.current.fromBottom ? -1 : 1;
    let moved = false, last = start.clientY, at = start.timeStamp, speed = 0, to = from;
    const move = (event: PointerEvent) => {
      if (!moved && Math.abs(event.clientY - start.clientY) < DRAG_SLOP) return;
      moved = true;
      speed = sign * (event.clientY - last) / Math.max(event.timeStamp - at, 1);
      last = event.clientY;
      at = event.timeStamp;
      const { peek: lowest, full } = latest.current.detents;
      to = Math.min(full, Math.max(lowest, from + sign * (event.clientY - start.clientY)));
      setDragged(to);
    };
    const end = (event: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!moved) return;
      // A click from this release, if one comes, comes before any timer.
      swallowClick.current = event.type === "pointerup";
      window.setTimeout(() => { swallowClick.current = false; }, 0);
      // Where it would come to rest a fifth of a second on at the speed
      // it was let go, to the nearest detent.
      const { detents: d, onStateChange: change } = latest.current;
      const aim = to + speed * 200;
      const nearest = PANEL_STATES.reduce((best, s) => (Math.abs(d[s] - aim) < Math.abs(d[best] - aim) ? s : best));
      setDragged(null);
      change(nearest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  // The release of a drag is not a tap on whatever it started on.
  const swallow = (event: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  // What it covers of the map at rest, for the map to fit a route clear
  // of it: the strip at its edge on a phone; from `md` up the column at
  // the left while it is out, or the corner it rests in while it is not.
  const expanded = state !== "peek";
  useEffect(() => {
    const strip = peek + (onPhone ? 0 : MARGIN);
    if (!onPhone && expanded) onInsetsChange({ top: 0, bottom: 0, left: 16 + CARD });
    else onInsetsChange(fromBottom ? { top: 0, bottom: strip, left: 0 } : { top: strip, bottom: 0, left: 0 });
  }, [peek, onPhone, expanded, fromBottom, onInsetsChange]);

  // Escape lowers it, pressed anywhere in it -- but not in a menu or a
  // list it opened, which is a portal outside it and closes first.
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!panel || !expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onStateChange("peek");
    };
    panel.addEventListener("keydown", onKey);
    return () => panel.removeEventListener("keydown", onKey);
  }, [panel, expanded, onStateChange]);

  // iOS's grabber: 36 by 5, five points in from the panel's far edge, in a
  // button a little wider than it. Like iOS's, it is less a button than
  // the mark of where to drag, and the whole head drags; tapped, it opens
  // or lowers the panel, and it is what a keyboard and VoiceOver use. Its
  // hit area (index.css) reaches fourteen into a margin of the panel's
  // that keeps it off the route's, the controls' and the body's own. Its
  // old test id, from when it was the sidebar's trigger, is kept for the
  // suite.
  const grabber = (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      data-testid="sidebar-trigger-button"
      onClick={() => onStateChange(expanded ? "peek" : "full")}
      // Inside the head (from the bottom) the head follows the drag already.
      onPointerDown={event => { event.stopPropagation(); startDrag(event); }}
      style={{ height: GRABBER }}
      className={cn(
        "mx-auto flex w-24 shrink-0 touch-none justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset print:hidden",
        fromBottom ? "items-start pt-[5px]" : "items-end pb-[5px]",
      )}
    >
      <span className="h-[5px] w-9 rounded-full bg-muted-foreground/40" aria-hidden="true" />
    </button>
  );

  return (
    <section
      ref={setPanel}
      data-slot="map-panel" data-panel={state} {...(onPhone ? { "data-sheet": "" } : {})}
      aria-label={label}
      onClickCapture={swallow}
      style={{
        height: shown, transition: dragged === null ? SETTLE : "none",
        ...(fromBottom && keyboard ? { bottom: keyboard } : {}),
      }}
      className={cn(
        // Clipped rather than hidden: a hidden overflow can still be
        // scrolled by a script, and a row brought into view in the body
        // scrolled the whole panel, its head up out of sight.
        "fixed z-40 flex flex-col overflow-clip text-foreground",
        MATERIAL,
        onPhone
          ? cn("inset-x-0", fromBottom
            ? "bottom-0 rounded-t-[10px] shadow-[0_-2px_20px_rgba(0,0,0,0.1)] dark:shadow-[0_-2px_20px_rgba(0,0,0,0.4)]"
            : "top-0 rounded-b-[10px] shadow-[0_2px_20px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_20px_rgba(0,0,0,0.4)]")
          : cn(
            "left-[max(1rem,env(safe-area-inset-left))] w-[24rem] rounded-[10px] shadow-[0_2px_10px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:shadow-[0_2px_10px_rgba(0,0,0,0.45)] dark:ring-white/10",
            fromBottom ? "bottom-[max(0.5rem,env(safe-area-inset-bottom))]" : "top-[max(0.5rem,env(safe-area-inset-top))]",
          ),
      )}
    >
      {/* The head, dragged as the grabber is: the grabber first on a sheet
          from the bottom, the top row, any notice, the controls. */}
      <div ref={setHead} className="flex shrink-0 touch-none flex-col" onPointerDown={startDrag}>
        {fromBottom && grabber}
        {/* From the top of a phone's screen it starts under the status
            bar or the island. */}
        <header className={cn("@container flex items-center gap-2 px-3 pb-1 print:hidden", fromBottom ? "pt-5" : onPhone ? "pt-[max(0.5rem,env(safe-area-inset-top))]" : "pt-2")}>
          {top}
        </header>
        {notices}
        {controls && (
          // Wrapped onto two lines (a 320-point Slide Over), the two
          // twelve apart, and twelve and more under the top row, so their
          // hit areas (index.css) meet rather than overlap.
          <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-3 px-3 pt-3 print:hidden", fromBottom ? "pb-2.5" : "pb-5")}>{controls}</div>
        )}
      </div>
      {/* Over a grabber at the bottom, clear of its hit area. */}
      <div className={cn("flex min-h-0 flex-1 flex-col border-border/60", expanded && "border-t", !fromBottom && expanded && "pb-4")} data-panel-body="">{children}</div>
      {/* The grabber last on a sheet from the top. */}
      {!fromBottom && grabber}
      {/* The rest of the way to the screen's edge, under the home
          indicator, below the body. */}
      {edgeInset > 0 && <div className="shrink-0" style={{ height: edgeInset }} aria-hidden="true" />}
    </section>
  );
}
