import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "cn";
import { useDetentDrag } from "../hooks/use-detent-drag";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import { useKeyboardInset, useSafeArea, useVisualHeight, useWindowHeight } from "../hooks/use-viewport";
import {
  GLASS, GLASS_FILL, GLASS_SHEET, GLASS_SHEET_FULL, MATERIAL, PanelHalfContext, SHEET_INSET, SHEET_INSET_RADIUS, SHEET_MARGIN, SHEET_RESHAPE,
  SHEET_SETTLE, type MapInsets, type PanelState,
} from "./mapChrome";

interface Props {
  /** The panel's name -- "Flight Planning", "Model Training" -- for its
   *  grabber and a screen reader. */
  label: string;
  /** The row over everything, always in sight: the route and the
   *  workspace's actions. */
  top: ReactNode;
  /** The row under it, in sight at rest too: the airplane and the
   *  departure time, the rating's progress. */
  controls?: ReactNode;
  /** What the panel holds at rest, in place of the route's row and the
   *  controls: a capsule floating over the chart, as Maps' is -- the
   *  route with a way to its options, or a search bar while there is no
   *  route. Without it the panel rests with its head in sight. */
  compact?: ReactNode;
  /** The body: the nav log and the briefing, the training list. */
  children: ReactNode;
  state: PanelState;
  onStateChange: (state: PanelState) => void;
  onInsetsChange: (insets: MapInsets) => void;
}

/** The capsule's way in from the screen's sides, as Maps' sits on iOS
 *  26 (measured from its screenshot: 28 in, 28 up from the bottom). It
 *  was 16 in, 76 tall with a row of its own for the grabber, and opaque:
 *  thick beside Maps'. Its corners are half its height, a full pill. */
const CAPSULE_INSET = 28;
/** What the capsule's content keeps from its grabber's edge: nine, the
 *  grabber in it, and twelve from the other, so the pill round the
 *  41-point field is 62 -- the pilot found 69, with fourteen, thick
 *  beside Maps'. */
const CAPSULE_PAD = 9;
/** The grabber's button: 16 tall, its pill five in from the panel's edge. */
const GRABBER = 16;
/** Where the route's half -- its head and the tabs' bar -- is kept on
 *  this device, for every half to be that height. */
const HALF_KEY = "vfr.panel.half";
/** The same before any route has been out on this device, in rem: 248
 *  points at iOS's default text size, as it measures there. */
const ROUTE_HEAD_REM = 15.5;
/** The root's font size, which the text size the reader has set moves. */
const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** A card's width from `md` up: 24rem. */
const CARD = 384;

/** How far a drag from the capsule takes to turn it into the sheet: over
 *  it, the way in from the screen's edges, the corners, the glass and the
 *  head follow the finger from the capsule's to the sheet's. */
const MORPH = 96;

const between = (from: number, to: number, t: number) => from + (to - from) * t;

/** The heights in order, for the way the panel last moved. */
const RANK: Record<PanelState, number> = { peek: 0, half: 1, full: 2 };

/**
 * The page's one panel over the map, the way Maps on an iPhone has one:
 * the route and the workspace's actions always in sight, the airplane
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
export default function MapPanel({ label, top, controls, compact, children, state, onStateChange, onInsetsChange }: Props) {
  const onPhone = useIsMobile();
  const edge = useNavEdge();
  const safe = useSafeArea();
  const windowHeight = useWindowHeight();
  // With the keyboard up, what it covers is not there: a sheet from the
  // bottom of the screen sits on the keyboard, and a field typed into in
  // it stays in sight, where it went under the keyboard with the page
  // pinned (MapPage) and nothing to scroll it up.
  const keyboard = useKeyboardInset();
  const visualHeight = useVisualHeight();
  const fromBottom = edge === "bottom";

  // The head's own height decides the lowest detent: the top row and the
  // controls in sight, with the grabber. Measured, since a notice or the
  // text set larger changes it.
  // Before the first paint, so the panel opens at its own height: it
  // was drawn 120 tall and eased down to the capsule's as the page came
  // up, a thick capsule for half a second. Eased from then on only.
  const [head, setHeadNode] = useState<HTMLDivElement | null>(null);
  const [headHeight, setHeadHeight] = useState(120);
  const [measured, setMeasured] = useState(false);
  // A ref's callback runs as the head is put in the page, before it is
  // painted.
  const setHead = useCallback((node: HTMLDivElement | null) => {
    setHeadNode(node);
    if (node) {
      setHeadHeight(node.offsetHeight);
      setMeasured(true);
    }
  }, []);
  useEffect(() => {
    if (!head) return;
    const observer = new ResizeObserver(() => setHeadHeight(head.offsetHeight));
    observer.observe(head);
    return () => observer.disconnect();
  }, [head]);
  // How tall it can be: a phone's sheet stops eight points short of the
  // far edge's inset (the status bar, the home indicator), as Maps' does;
  // a card keeps a margin at both ends.
  // With the keyboard up, what is in sight above it: Safari scrolls the
  // page to the field it focused, so the keyboard's inset alone (the
  // distance under what is in sight) left the sheet as tall as before,
  // its top -- the search bar typed into -- scrolled up off the screen.
  const room = keyboard || visualHeight < windowHeight - 1
    ? visualHeight - Math.round(safe.top) - SHEET_MARGIN
    : onPhone
      ? windowHeight - Math.round(fromBottom ? safe.top : safe.bottom) - SHEET_MARGIN
      : windowHeight - Math.max(SHEET_MARGIN, Math.round(safe.top)) - Math.max(SHEET_MARGIN, Math.round(safe.bottom));
  // A phone's sheet from the bottom runs on to the screen's edge, under
  // the home indicator (or eight points where there is none), so its
  // content sits clear of it -- or on to the keyboard, with it up.
  const edgeInset = onPhone && fromBottom && !keyboard ? Math.max(Math.round(safe.bottom), SHEET_MARGIN) : 0;
  // A drag (below) that is under way, and the capsule's height when one
  // last started from it: 41 points of field, nine over it and twelve
  // under it, until then.
  const [dragged, setDragged] = useState<number | null>(null);
  const [capsuleHeight, setCapsuleHeight] = useState(41 + CAPSULE_PAD + 12);
  // At rest with a capsule to show, it floats clear of the screen's
  // edges as Maps' does: in from the sides, above the home indicator
  // (into its inset a little, as Maps sits) or under the status bar.
  const capsule = !!compact && state === "peek" && dragged === null;
  const capsuleGap = fromBottom ? Math.max(12, Math.round(safe.bottom) - 6) : Math.round(safe.top) + SHEET_MARGIN;
  // The capsule is its head alone, the grabber over its padding.
  const peek = capsule ? headHeight : Math.round(headHeight + (fromBottom ? edgeInset : GRABBER));
  // The capsule's height, kept while it rests, for the lowest detent once
  // it is the sheet: dragged, the sheet's head is measured where the
  // capsule's was, and the lowest detent came out as tall as the half
  // that ends at the head -- so a drag let go at the separator went back
  // down to the capsule, the two being one height and the lowest first.
  if (capsule && capsuleHeight !== headHeight) setCapsuleHeight(headHeight);
  // One half height for every panel, at the pilot's ask: the route's --
  // its box, the controls, the flight's line and the tabs' bar, the tabs'
  // contents above it -- and the search's (its Favorites, the Recents
  // above it) and an airport's card (its name and actions, the weather
  // above it) at the same, each laying its first part out to that height
  // (--half-body). The route's is measured from the tabs (PanelHalfContext)
  // and kept on this device; before any route has been out, it is the
  // text size in use as it measures at iOS's default. Kept only while
  // the route is whole, its controls under it: a route cleared, or still
  // being typed, has its box alone, and the panel stays the height it was.
  const [tabsAt, setTabsAt] = useState<number | null>(null);
  const [routeHead, setRouteHead] = useState<number | null>(() => {
    try {
      const kept = Number(localStorage.getItem(HALF_KEY));
      return kept > 0 ? kept : null;
    } catch {
      return null;
    }
  });
  const routeNow = tabsAt !== null && !!controls && !capsule && dragged === null && measured ? headHeight + tabsAt : null;
  if (routeNow !== null && routeNow !== routeHead) setRouteHead(routeNow);
  useEffect(() => {
    try {
      if (routeHead) localStorage.setItem(HALF_KEY, String(routeHead));
    } catch {
      // Not kept: the estimate serves the next load.
    }
  }, [routeHead]);
  // What the half sheet has past its head and body: on a phone's sheet
  // from the bottom the way on to the screen's edge, less the gap it
  // floats above that edge by (with it, the nav log's first heading
  // showed a line under the tabs); from the top, the grabber at its foot.
  const halfChrome = fromBottom ? Math.max(0, edgeInset - SHEET_INSET) : GRABBER;
  const detents = useMemo<Record<PanelState, number>>(() => {
    const full = Math.max(peek, room);
    const half = Math.max(peek, (routeHead ?? Math.round(ROUTE_HEAD_REM * rootPx())) + halfChrome);
    const lowest = compact && !capsule ? Math.min(capsuleHeight, peek) : peek;
    return { peek: lowest, half: Math.min(half, full), full };
  }, [peek, room, routeHead, halfChrome, compact, capsule, capsuleHeight]);
  // The body's height at half, for what it shows first to fill and no
  // more (--half-body): the search's Favorites, an airport's name and
  // actions.
  const halfBody = Math.max(0, detents.half - headHeight - halfChrome);
  // Where the panel's top-right button sits -- the search's gear, the
  // route's close, an airport's or the airspace's card's close -- one
  // place in every panel, at the pilot's ask, so a finger or a pointer
  // left there need not move as one panel gives way to another: in from
  // the side as the head's row is (px-3), and centred on the head's first
  // line, the search field's 41 points (2.5625rem), as the gear is.
  // `--corner-line` is how far down that line a 36-point button sits;
  // `--corner-inset` is where it is from the top of a body with no head
  // row over it (a card's): the head's own padding, less the room the
  // status bar takes from both.
  const headPad = fromBottom ? "0.25rem" : onPhone ? "max(0.5rem, env(safe-area-inset-top))" : "0.5rem";
  const bodyPad = !fromBottom && onPhone ? "env(safe-area-inset-top)" : "0px";
  const corner = {
    "--corner-line": "calc((2.5625rem - 36px) / 2)",
    "--corner-inset": `calc(${headPad} - ${bodyPad} + (2.5625rem - 36px) / 2)`,
  } as CSSProperties;

  // A drag on the grabber or the head follows the finger, and lets go to
  // the detent it was heading for (useDetentDrag).
  const shown = dragged ?? detents[state];
  // A phone's panel takes Maps' three shapes: the capsule at rest; in
  // from the edges, every corner round, up to half way and while dragged
  // there; and nearer the top on the screen's edges, as Maps' is all the
  // way up -- its far corners as round as the half sheet's, the glass
  // nearly whole.
  const nearFull = shown >= (detents.half + detents.full) / 2;
  const shape: "capsule" | "inset" | "edge" = capsule ? "capsule" : nearFull ? "edge" : "inset";
  const geometry = {
    capsule: { side: CAPSULE_INSET, gap: capsuleGap, radius: `${headHeight / 2}px` },
    inset: { side: SHEET_INSET, gap: SHEET_INSET, radius: `${SHEET_INSET_RADIUS}px` },
    edge: {
      side: 0, gap: 0,
      radius: fromBottom ? `${SHEET_INSET_RADIUS}px ${SHEET_INSET_RADIUS}px 0 0` : `0 0 ${SHEET_INSET_RADIUS}px ${SHEET_INSET_RADIUS}px`,
    },
  }[shape];
  // A drag from the capsule turns it into the sheet as the finger goes
  // (MORPH), as Maps' does: it jumped to the sheet's shape and head at a
  // touch, the head too tall for the height the finger had it at, and its
  // glass gave way to an opaque fill for as long as the finger was down.
  // And back: a sheet dragged down to the capsule's height turns into it
  // on the way, rather than at the release.
  const morphing = !!compact && dragged !== null;
  const morph = capsule ? 0 : morphing ? Math.min(1, Math.max(0, (dragged - capsuleHeight) / MORPH)) : 1;
  if (morphing && morph < 1 && shape === "inset") {
    geometry.side = between(CAPSULE_INSET, SHEET_INSET, morph);
    geometry.gap = between(capsuleGap, SHEET_INSET, morph);
    geometry.radius = `${between(capsuleHeight / 2, SHEET_INSET_RADIUS, morph)}px`;
  }
  // The glass the whole way, its fill following the height: the capsule's,
  // the half sheet's, nearly whole all the way up (GLASS_FILL).
  const fill = morph < 1 ? between(GLASS_FILL.capsule, GLASS_FILL.half, morph)
    : between(GLASS_FILL.half, GLASS_FILL.full, Math.min(1, Math.max(0, (shown - detents.half) / Math.max(1, detents.full - detents.half))));
  // While it turns, the capsule's own content fades out over the sheet's
  // head as that fades in -- unless the two are one (the search bar).
  const crossFade = morphing && morph < 1 && compact !== top;
  const { startDrag: drag, swallow } = useDetentDrag({
    detents, shown, fromBottom, onRelease: onStateChange, setDragged,
    // Down to the capsule's own height, which is less than the sheet's
    // lowest detent: its head alone, no controls.
    floor: compact ? capsuleHeight : undefined,
  });
  const startDrag = (event: Parameters<typeof drag>[0]) => {
    if (capsule) setCapsuleHeight(shown);
    drag(event);
  };

  // What it covers of the map where it has come to rest, for the map to
  // fit a route clear of it, as Maps' route sits above its sheet: on a
  // phone the capsule's strip at rest, and the half sheet out -- all the
  // way up as well, where the map is hidden and what counts is what shows
  // once it comes down; from `md` up the column at the left while it is
  // out, or the corner it rests in while it is not. Not while dragged:
  // the map refits once the panel settles (MapShell).
  const expanded = state !== "peek";
  const coveredOnPhone = expanded ? detents.half + SHEET_INSET : peek + (capsule ? capsuleGap : 0);
  useEffect(() => {
    if (!onPhone && expanded) onInsetsChange({ top: 0, bottom: 0, left: 16 + CARD, out: true });
    else {
      const strip = onPhone ? coveredOnPhone : peek + SHEET_MARGIN;
      onInsetsChange(fromBottom ? { top: 0, bottom: strip, left: 0, out: expanded } : { top: strip, bottom: 0, left: 0, out: expanded });
    }
  }, [peek, onPhone, expanded, fromBottom, coveredOnPhone, onInsetsChange]);

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

  // The panel's height on <body> as well, for the stylesheet's rules about
  // what else is over the map (index.css): the map's buttons under a
  // phone's sheet all the way up, and the toasts over a panel out. They
  // asked <body> with :has() before, and a :has() at the top of the page
  // restyled the whole page at every change of an attribute it named --
  // data-state among them, which every stock component sets as it opens
  // or closes: 56 ms a time on a laptop, four times that on a phone, at
  // each tab picked (measured 2026-10-07).
  useLayoutEffect(() => {
    const body = document.body;
    body.dataset.mapPanel = state;
    body.toggleAttribute("data-map-sheet", onPhone);
    return () => {
      delete body.dataset.mapPanel;
      body.removeAttribute("data-map-sheet");
    };
  }, [state, onPhone]);

  // A tap on the grabber cycles the panel's three heights, small to big
  // and back, at the pilot's ask: from half it goes on the way the panel
  // last moved -- up from the pill, down from all the way up -- where it
  // went from the pill all the way up and from either back to the pill.
  const [was, setWas] = useState(state);
  const [rising, setRising] = useState(true);
  if (state !== was) {
    setWas(state);
    setRising(RANK[state] > RANK[was]);
  }
  const cycle = () => onStateChange(state === "peek" || state === "full" ? "half" : rising ? "full" : "peek");

  // iOS's grabber: 36 by 5, five points in from the panel's far edge, in a
  // button a little wider than it. Like iOS's, it is less a button than
  // the mark of where to drag, and the whole head drags; tapped, it cycles
  // the heights (above), and it is what a keyboard and VoiceOver use. Its
  // hit area (index.css) reaches fourteen into a margin of the panel's
  // that keeps it off the route's, the controls' and the body's own. Its
  // old test id, from when it was the sidebar's trigger, is kept for the
  // suite.
  // On the capsule it lies over the capsule's own padding, as Maps' does,
  // its box that padding and no hit area past it: reaching fourteen
  // further, it took a tap on the top of the search field.
  const grabber = (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      data-testid="sidebar-trigger-button"
      onClick={cycle}
      // Inside the head (from the bottom) the head follows the drag already.
      onPointerDown={event => { event.stopPropagation(); startDrag(event); }}
      // On the capsule two short of its padding: the route chip's 44-point
      // hit area reaches a point and a half past the chip, into it.
      style={{ height: capsule ? CAPSULE_PAD - 2 : GRABBER }}
      className={cn(
        "mx-auto flex w-24 shrink-0 touch-none justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset print:hidden",
        // In the capsule's thin padding, two points from its edge; on the
        // sheet five, as iOS's.
        fromBottom ? (capsule ? "items-start pt-[2px]" : "items-start pt-[5px]") : (capsule ? "items-end pb-[2px]" : "items-end pb-[5px]"),
        capsule && cn("absolute inset-x-0 z-10 after:hidden!", fromBottom ? "top-0" : "bottom-0"),
        // Its hit area (index.css) wide but no further into the head than
        // four points: the route's box starts four under it.
        !capsule && (fromBottom ? "after:bottom-[-4px]! after:top-0!" : "after:top-[-4px]! after:bottom-0!"),
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
      data-capsule={capsule || undefined}
      data-shape={onPhone ? shape : undefined}
      style={{
        ...corner,
        // The height follows a finger without lag, and the capsule's turn
        // into the sheet with it; the shape eases in and out as a drag
        // crosses half way up, to the screen's edges and back.
        height: shown, transition: !measured || (morphing && morph < 1) ? "none" : dragged === null ? SHEET_SETTLE : SHEET_RESHAPE,
        ...(onPhone && dragged !== null ? { "--glass-fill": `${fill}%` } : {}),
        ...(onPhone ? {
          left: geometry.side, right: geometry.side,
          ...(fromBottom ? { bottom: keyboard && !capsule ? keyboard + geometry.gap : geometry.gap } : { top: geometry.gap }),
          borderRadius: geometry.radius,
        } : capsule ? { borderRadius: headHeight / 2 } : {}),
      }}
      className={cn(
        // Clipped rather than hidden: a hidden overflow can still be
        // scrolled by a script, and a row brought into view in the body
        // scrolled the whole panel, its head up out of sight.
        "fixed z-40 flex flex-col overflow-clip text-foreground",
        // Liquid Glass at every height, as Maps' is: the chart through it,
        // its rim lit, its own shadow -- the sheet a frostier pane of it,
        // for a nav log read on it, and all the way out nearly whole.
        capsule ? GLASS
          : !onPhone ? MATERIAL
            : dragged !== null ? GLASS : nearFull ? GLASS_SHEET_FULL : GLASS_SHEET,
        !onPhone && cn(
          "left-[max(1rem,env(safe-area-inset-left))] w-[24rem]",
          !capsule && "rounded-[10px] shadow-[0_2px_10px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:shadow-[0_2px_10px_rgba(0,0,0,0.45)] dark:ring-white/10",
          fromBottom ? "bottom-[max(0.5rem,env(safe-area-inset-bottom))]" : "top-[max(0.5rem,env(safe-area-inset-top))]",
        ),
      )}
    >
      {/* The head, dragged as the grabber is: the grabber first on a sheet
          from the bottom, the top row, any notice, the controls -- or, at
          rest, the capsule, its grabber on its far edge from the top. */}
      {crossFade && (
        <div aria-hidden="true" inert className="pointer-events-none absolute inset-x-0 top-0 z-10 p-[9px]" style={{ opacity: 1 - morph }}>
          {compact}
        </div>
      )}
      <div ref={setHead} className="relative flex shrink-0 touch-none flex-col" onPointerDown={startDrag}>
        {fromBottom && grabber}
        <div className="flex flex-col" style={crossFade ? { opacity: morph } : undefined}>
        {/* One header in both shapes, so what the capsule and the sheet
            both show -- the search bar -- stays the same element as the
            one turns into the other, focus and keyboard and all. From
            the top of a phone's screen the sheet's starts under the
            status bar or the island. */}
        <header
          className={cn(
            "@container flex items-center gap-2 print:hidden",
            // The same glass all round from either edge, and the same size,
            // at the pilot's ask: from the top it was twelve points taller.
            // Twelve on the side away from the grabber and nine on the
            // grabber's -- mirrored, from the top -- so a route's chip's
            // 44-point hit area (index.css) stays in the capsule, which
            // clips what is past its edge; the search bar's the same, so
            // the pill is one height whatever it holds, at the pilot's ask.
            capsule ? cn("p-[9px]", fromBottom ? "pb-3" : "pt-3")
              // No top row (a place's card alone): only the room the status
              // bar takes from the top of a phone's screen.
              : top == null ? (!fromBottom && onPhone ? "pt-[env(safe-area-inset-top)]" : undefined)
                // Four under the grabber from the bottom: the band over the
                // route's box was 36 points, thick beside Maps' 20.
                : cn("px-3 pb-1", fromBottom ? "pt-1" : onPhone ? "pt-[max(0.5rem,env(safe-area-inset-top))]" : "pt-2"),
          )}
        >
          {capsule ? compact : top}
        </header>
        {!capsule && controls && (
          // Wrapped onto two lines (a 320-point Slide Over), the two
          // twelve apart, and twelve and more under the top row, so their
          // hit areas (index.css) meet rather than overlap.
          <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-3 px-3 pt-3 print:hidden", fromBottom ? "pb-2.5" : "pb-5")}>{controls}</div>
        )}
        </div>
        {capsule && !fromBottom && grabber}
      </div>
      {/* Over a grabber at the bottom, clear of its hit area. */}
      {/* The separator over the body, and its room over a grabber at its
          foot, only past half, at the pilot's ask: at half the tabs' own
          bar is the line under the head. */}
      <div
        className={cn("flex min-h-0 flex-1 flex-col border-border/60", expanded && shown > detents.half + 1 && cn("border-t", !fromBottom && "pb-4"))}
        style={{ "--half-body": `${halfBody}px` } as CSSProperties}
        data-panel-body=""
      >
        <PanelHalfContext.Provider value={setTabsAt}>{children}</PanelHalfContext.Provider>
      </div>
      {/* The grabber last on a sheet from the top. */}
      {!fromBottom && !capsule && grabber}
      {/* The rest of the way to the screen's edge, under the home
          indicator, below the body. */}
      {edgeInset > 0 && !capsule && (
        <div className="shrink-0" style={{ height: Math.max(0, edgeInset - geometry.gap) }} aria-hidden="true" />
      )}
    </section>
  );
}
