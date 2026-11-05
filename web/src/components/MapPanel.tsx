import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Drawer } from "@base-ui/react/drawer";
import { cn } from "cn";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import { useKeyboardInset, useSafeArea, useWindowHeight } from "../hooks/use-viewport";
import {
  GLASS, MATERIAL, BarOverPicture, PanelSize, PILL_RADIUS, usePanelDragging, SETTLE_LEAST, SHEET_MARGIN, TabBarMinimized,
  useTabsShown, type MapInsets, type PanelState,
} from "./mapChrome";
import { useOpenCards } from "../lib/openCards";
import { PillPicture } from "./PillPicture";
import { SheetCardHost } from "./SheetCard";
import { raisedFor, useSheetCards } from "../lib/sheetCards";
import TabKept from "./TabKept";
import { prefersReducedMotion } from "../lib/motion";
import { usePreferences } from "../lib/preferences";
import { settleSeconds, type Detents } from "./sheet/engine";

interface Props {
  /** The panel's name -- "Flight Planning", "Model Training" -- for its
   *  grabber and a screen reader. */
  label: string;
  /** The row over everything, always in sight: the route and the
   *  workspace's actions. */
  top: ReactNode;
  /** A top row kept while out of sight (the planner's route box): under
   *  another tab's head, a card alone or the pill it stays built, hidden,
   *  and is `top` again as it was left, as iOS keeps a tab's screen. */
  kept?: ReactNode;
  /** The row under it, in sight at rest too: the airplane and the
   *  departure time, the rating's progress. */
  controls?: ReactNode;
  /** What the panel holds at rest with no tab bar: a capsule's own row
   *  (the training route with a way to its options). With a bar the pill
   *  is the bar alone. */
  compact?: ReactNode;
  /** The body: the nav log and the briefing, the training list. */
  children: ReactNode;
  /** The planner's tab bar (TabBar), or the strip's ribbon: the sheet's
   *  first row, and at rest the pill itself. */
  bar?: ReactNode;
  /** What the panel is showing: a tab of the planner, a card open alone
   *  over it, or the console's layer (the Setup tab). */
  layer?: "tab" | "card" | "console";
  /** A card from another tab's world open over this one: on a phone the
   *  bar minimized to the card's kind with Back to the tab. */
  cardOver?: boolean;
  /** Pinned at the sheet's foot at every size: the route's figures, or
   *  the strip's one field -- in the pill its one row. */
  foot?: ReactNode;
  /** The body down to the sheet's own edge, over the home indicator's
   *  inset (PlaceCard). The inset's height is `--half-foot` to it. */
  toEdge?: boolean;
  /** The airplane flying the route (useFlyingMode): the tab bar, the top
   *  row and the controls put away, the pill its foot alone. */
  flying?: boolean;
  state: PanelState;
  onStateChange: (state: PanelState) => void;
  onInsetsChange: (insets: MapInsets) => void;
}

/** The half sheet's height, in rem, the same on every tab: FPL's route
 *  whole in it -- its box, its chips, the side view with the dry run's
 *  play, and the figures -- at the owner's ask ("Let's make the half card
 *  this tall", their iPhone's screenshot of the sheet 368 points tall). */
const HALF_REM = 23;
/** The most of all the way up the half sheet takes, so the two stay two
 *  sizes on a short screen (a phone on its side, 402 points). */
const HALF_MOST = 0.85;
/** The least body worth showing at half, rem: one row of a list (44
 *  points). Less is no body: the half ends at the head and the foot. */
const HALF_BODY_LEAST_REM = 2.75;
/** A card's width from `md` up: 24rem. */
const CARD = 384;
/** The grabber's row at the far edge of a card or a sheet from the top. */
const GRABBER = 16;
/** The first row's room under the grabber: ten points, the grabber's bar
 *  in it four from the edge (iOS's is five on a sheet, two on Maps' pill:
 *  one place at every size here). */
const ROW_PAD = "pt-2.5";
/** The sizes in order, for which way the panel last moved. */
const RANK: Record<PanelState, number> = { peek: 0, half: 1, full: 2 };

/** The root's font size, read once and again after a resize, a turn of
 *  the phone, or the page coming back to the front (a text size set in
 *  iOS's Settings reaches a page with no resize). */
let rootFont: number | null = null;
if (typeof window !== "undefined") {
  const forget = () => { rootFont = null; };
  window.addEventListener("resize", forget);
  window.addEventListener("pageshow", forget);
  document.addEventListener("visibilitychange", forget);
}
const rootPx = () => (rootFont ??= parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);

/** Where the map's buttons and its credits ride on the sheet's top
 *  (--sheet-cover, index.css): a rule of their own, set on them alone.
 *  Set on <body>, an inherited property, every change of it restyled the
 *  whole page (177 to 260 ms of a phone's at 4x, 2026-10-28). */
let coverDeclaration: CSSStyleDeclaration | null = null;
const coverRule = () => {
  if (!coverDeclaration) {
    const sheet = document.head.appendChild(document.createElement("style")).sheet!;
    sheet.insertRule("[data-map-controls], [data-map-food], .leaflet-bottom {}", 0);
    coverDeclaration = (sheet.cssRules[0] as CSSStyleRule).style;
  }
  return coverDeclaration;
};

/** Under the head, the body and the foot a shade darker than the glass
 *  over them, the grey of notes and the blue of tappable words a step
 *  darker on it for WCAG's 4.5:1 (--tint-shade, index.css). */
const SHEET_BELOW = "[--muted-foreground:oklch(0.5_0_0)] [--tint:var(--tint-shade)] dark:[--muted-foreground:oklch(0.708_0_0)] print:bg-transparent";

/** What the panel covers of the map at `s`: on a phone the pill's strip,
 *  or the half sheet -- all the way up as well, where what counts is what
 *  shows once it comes down; from `md` up the column at the left while it
 *  is out, or the corner it rests in. */
function insetsOf(s: PanelState, d: Detents, onPhone: boolean, fromBottom: boolean): MapInsets {
  const up = s === "full";
  if (!onPhone && s !== "peek") return { top: 0, bottom: 0, left: 16 + CARD, out: true, up };
  const strip = onPhone ? (s === "peek" ? d.peek : d.half) : d.peek + SHEET_MARGIN;
  return fromBottom ? { top: 0, bottom: strip, left: 0, out: s !== "peek", up } : { top: strip, bottom: 0, left: 0, out: s !== "peek", up };
}

/** What a phone's sheet says as it sets off for another size, on its
 *  "sheetturn" event: the room it will leave the map (MapShell). */
export interface SheetTurn { insets: MapInsets }

/**
 * The page's one panel over the map, the way Maps on an iPhone has one:
 * the route and the workspace's actions always in sight, the airplane
 * and the departure time under them, and the workspace's own content
 * under those. A sheet on the navigation bar's edge with three detents
 * -- the pill (its first row), half the screen, all of it -- and a
 * grabber on its free edge: drag it, or the sheet anywhere a list is not
 * scrolling, and it lets go to a detent; tap the grabber and it cycles;
 * Escape lowers it. The screen's width on a phone; from `md` up 24 rem
 * wide at the left.
 *
 * A stock sheet, Base UI's Drawer, at the owner's ask (2026-11-04: "Can
 * we try the stock sheet?"), the one shadcn's drawer moved to once Vaul
 * went unmaintained: a bottom sheet or a top sheet by the pilot's Layout
 * setting (useNavEdge), the detents its snap points, non-modal so the map
 * stays the map's. The Drawer follows the finger, picks the detent and
 * slides the popup, laid out at its full height, by its snap point's
 * offset; a flick goes one size (snapToSequentialPoints, the owner's
 * "the pill should not go straight to full"), and a swipe past the pill
 * never closes it (its null snap point refused). What must stay in sight
 * at the sheet's free edge is moved back by the same offset (pin): a
 * bottom sheet's route figures, the body cut off over them, and a top
 * sheet's head -- written to those few elements alone, a frame at a time
 * under a finger and as one eased transition in a settle, never through
 * a variable every element under the sheet inherits, which restyled the
 * whole sheet at each frame of a drag (the owner, 2026-11-04: "the
 * movement of sheet is not smooth, it's jerky"). The map goes with the sheet's edge frame
 * by frame (lib/map/sheetSlide, reading the popup's transform), and the
 * page hears the room the sheet leaves as it sets off (sheetturn) and
 * once it has landed (onInsetsChange).
 */
export default function MapPanel({ label, top, kept, controls, compact, children, state: pageState, onStateChange: tellPage, onInsetsChange: tellInsets, toEdge: edgeAsked = false, bar, layer = "tab", cardOver: overAsked = false, foot, flying = false }: Props) {
  // The pill's first row: the tab bar, or in the strip layout the strip's
  // one field (the foot), its ribbon (the bar) from half way up
  // (features/strip, lib/preferences).
  const fieldPill = usePreferences(s => s.layout === "strip") && !!foot;
  const cardInPill = layer === "card";
  const cardOver = layer !== "console" && overAsked;
  // A card opened over whatever is here (SheetCard): the body's room its,
  // the head's row, the controls and the foot out of sight under it.
  const raised = useSheetCards(s => raisedFor(s.stack));
  const cardsUp = raised !== null;
  // The top card's content's own height, where it is a card raised half
  // way: the sheet then goes no higher than it needs (the detents' full).
  const sheetHost = useSheetCards(s => s.host);
  const topCard = useSheetCards(s => s.stack.at(-1)?.id ?? null);
  const [measuredFit, setMeasuredFit] = useState<{ id: string; px: number } | null>(null);
  useEffect(() => {
    if (!sheetHost || !topCard || raised !== "half") return;
    const card = [...sheetHost.querySelectorAll<HTMLElement>("[data-sheet-card]")].at(-1);
    if (!card) return;
    const seen = new ResizeObserver(() => {
      const last = card.lastElementChild as HTMLElement | null;
      if (last) setMeasuredFit({ id: topCard, px: Math.ceil(last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(card).paddingBottom)) });
    });
    for (const part of card.children) seen.observe(part);
    return () => seen.disconnect();
  }, [sheetHost, topCard, raised]);
  const cardFit = raised === "half" && measuredFit && measuredFit.id === topCard ? measuredFit.px : null;
  const toEdge = layer !== "console" && edgeAsked && !cardsUp;
  const onPhone = useIsMobile();
  const edge = useNavEdge();
  const safe = useSafeArea();
  const windowHeight = useWindowHeight();
  // With the keyboard up, what it covers is not there: the sheet sits on
  // the keyboard, a field typed into in it in sight.
  const keyboard = useKeyboardInset();
  const fromBottom = edge === "bottom";
  const hasPill = !!bar || !!compact;
  // How tall it can be: eight points short of the far edge's inset.
  const room = windowHeight - keyboard - Math.round(fromBottom ? safe.top : safe.bottom) - SHEET_MARGIN;
  // A bottom sheet runs on to the screen's edge, under the home indicator
  // (or eight points where there is none), so its content sits clear of it.
  const edgeInset = fromBottom && !keyboard ? Math.max(Math.round(safe.bottom), SHEET_MARGIN) : 0;

  // The size the sheet shows: the page's, or the one it was sent to here
  // (a drag let go, the grabber, a tab's tap), told to the page once it
  // has landed -- told at once, the page drew the whole workspace again
  // for the new size as the sheet set off (140 ms at 4x).
  const [size, setSize] = useState(pageState);
  const sizeRef = useRef(size);
  const asked = useRef<PanelState | null>(null);
  // On its way to `size`, and how long the way takes.
  const [moving, setMoving] = useState(false);
  // None until it first moves: drawn where it rests as the page opens,
  // not eased there from wherever the Drawer had it before measuring.
  const [seconds, setSeconds] = useState(0);
  const atPill = size === "peek" && hasPill;

  // Measured at rest: the head's band, the foot, and what the pill shows.
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [headBand, setHeadBandState] = useState<HTMLDivElement | null>(null);
  const [footNode, setFootNodeState] = useState<HTMLDivElement | null>(null);
  // The parts held in sight at the free edge (pin), written to directly.
  const parts = useRef<{ head: HTMLElement | null; body: HTMLElement | null; inner: HTMLElement | null; foot: HTMLElement | null }>({ head: null, body: null, inner: null, foot: null });
  const setHeadBand = useCallback((node: HTMLDivElement | null) => { parts.current.head = node; setHeadBandState(node); }, []);
  const setFootNode = useCallback((node: HTMLDivElement | null) => { parts.current.foot = node; setFootNodeState(node); }, []);
  const setBodyNode = useCallback((node: HTMLDivElement | null) => { parts.current.body = node; }, []);
  const setInnerNode = useCallback((node: HTMLDivElement | null) => { parts.current.inner = node; }, []);
  const [headHeight, setHeadHeight] = useState(0);
  const [footHeight, setFootHeight] = useState(0);
  const [pillHeight, setPillHeight] = useState<number | null>(null);
  const movingRef = useRef(moving);
  useEffect(() => {
    if (!headBand) return;
    const watch = new ResizeObserver(() => { if (!movingRef.current) setHeadHeight(headBand.offsetHeight); });
    watch.observe(headBand);
    return () => watch.disconnect();
  }, [headBand]);
  useEffect(() => {
    if (!footNode) return;
    const watch = new ResizeObserver(() => { if (!movingRef.current) setFootHeight(footNode.offsetHeight); });
    watch.observe(footNode);
    return () => watch.disconnect();
  }, [footNode]);

  // The figures pinned at the sheet's foot: in sight at every size but
  // under a card.
  const footShown = !!foot && !cardsUp;
  // The bar: the sheet's first row -- and the pill itself, unless the pill
  // is the figures (the tabs layout with a route) or the strip's field.
  const barShown = !!bar && !(onPhone && keyboard) && !flying;
  const pictureCard = useOpenCards(s => s.picture);
  const tabsShown = useTabsShown(s => s.shown);
  // A card from another tab over this one on a phone: the tab bar
  // minimized to the card's kind, as iOS's navigation bar is; a card from
  // a control or the chart (SheetCard) the same, its name on the bar.
  const minimized = cardOver || (onPhone && cardsUp);
  const barNamed = !!bar && barShown && minimized && cardsUp;
  useEffect(() => {
    useSheetCards.setState({ barNamed });
    return () => useSheetCards.setState({ barNamed: false });
  }, [barNamed]);
  // An airport's or an airplane's card draws its own head over its
  // picture out of the pill (PhotoHead): the minimized bar left out over
  // it, the grabber laid over the picture.
  const ownHead = pictureCard && layer === "card" && !cardsUp && !atPill && !tabsShown;
  const barHere = barShown && !ownHead && !(atPill && footShown);
  // In the pill, the card's name over its head's picture (PillPicture).
  const pill = useOpenCards(s => s.pill);
  const pillPictured = !!pill && (pictureCard || !!pill.colour) && atPill && minimized && barHere && !tabsShown;
  // The head's row: in the pill only without a tab bar (whose pill is the
  // bar or the figures); out of it wherever there is a top row or no bar.
  const headerShown = !flying && !cardsUp && (atPill ? !bar : top != null || !barShown);
  const headContent = atPill ? compact : top;
  const keptHere = kept != null && headerShown && headContent === kept;

  // The pill's height, measured as the pill at rest: its head (the bar or
  // its own row), the figures where they are its row, and the grabber's
  // or the home indicator's room.
  const halfChrome = fromBottom ? edgeInset : GRABBER;
  useEffect(() => {
    if (!atPill || moving || !headBand) return;
    const measure = () => setPillHeight(Math.ceil(headBand.offsetHeight + (footShown && footNode ? footNode.offsetHeight : 0) + halfChrome));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(headBand);
    if (footShown && footNode) watch.observe(footNode);
    return () => watch.disconnect();
  }, [atPill, moving, headBand, footNode, footShown, halfChrome]);

  // Where it comes to rest: the pill, half and all the way up, in px.
  const detents = useMemo<Detents>(() => {
    const peek = pillHeight ?? Math.round(4.25 * rootPx()) + halfChrome;
    const whole = Math.max(peek, room);
    const askedHalf = Math.max(peek, Math.min(Math.round(HALF_REM * rootPx()) + halfChrome, Math.round(whole * HALF_MOST)));
    const body = askedHalf - headHeight - halfChrome - footHeight;
    const half = body > 0 && body < HALF_BODY_LEAST_REM * rootPx() ? Math.max(peek, askedHalf - body) : askedHalf;
    // All the way up only as far as a short card on top needs (cardFit):
    // a fix's card was a line and an empty sheet up to the status bar.
    const full = cardFit === null ? whole : Math.max(Math.min(half, whole), Math.min(whole, headHeight + halfChrome + cardFit));
    return { peek, half: Math.min(half, full), full };
  }, [pillHeight, room, halfChrome, headHeight, footHeight, cardFit]);
  const detentsRef = useRef(detents);
  const snapPoints = useMemo(() => [detents.peek, detents.half, detents.full], [detents]);
  const halfBody = Math.max(0, detents.half - headHeight - halfChrome - footHeight);
  const fullBody = Math.max(0, detents.full - headHeight - halfChrome - footHeight);

  // What it covers of the map where it comes to rest (insetsOf).
  const insetsFor = useCallback((s: PanelState, d: Detents) => insetsOf(s, d, onPhone, fromBottom), [onPhone, fromBottom]);

  // The parts held in sight, `off` px in from where the popup's free edge
  // is laid out (its full height less its height now): a bottom sheet's
  // figures and body up by it, the body's content back down; a top
  // sheet's head and body down by it. Transform only, on these alone.
  const pinState = useRef({ fromBottom, footShown });
  useLayoutEffect(() => {
    pinState.current = { fromBottom, footShown };
  }, [fromBottom, footShown]);
  const pin = useCallback((off: number, ease: string) => {
    const { head, body, inner, foot } = parts.current;
    const { fromBottom: bottom, footShown: figures } = pinState.current;
    const shift = (px: number) => (Math.abs(px) < 0.25 ? "" : `translate3d(0, ${Math.round(px * 100) / 100}px, 0)`);
    const write = (el: HTMLElement | null, px: number) => {
      if (!el) return;
      // The figures' growth (--sheet-progress) eased with the sheet too.
      const transition = !ease ? "" : el === foot ? `transform ${ease}, --sheet-progress ${ease}` : `transform ${ease}`;
      const transform = shift(px);
      // Written only where it changes: each write is a restyle.
      if (el.style.transition !== transition) el.style.transition = transition;
      if (el.style.transform !== transform) el.style.transform = transform;
      // Its own layer while it is moved off its place, so a frame of a
      // drag or a settle moves it rather than painting it again; none
      // where it rests in place (all the way up), the layers cost memory.
      const layer = px || ease ? "transform" : "";
      if (el.style.willChange !== layer) el.style.willChange = layer;
    };
    const up = bottom && figures ? off : 0;
    write(foot, bottom ? -up : 0);
    write(body, bottom ? -up : off);
    write(inner, up);
    write(head, bottom ? 0 : off);
    if (body && body.style.overflow !== (up ? "clip" : "")) body.style.overflow = up ? "clip" : "";
  }, []);
  // How far in the popup's free edge is this frame, from its transform.
  const offNow = useCallback(() => {
    if (!panel) return 0;
    const transform = getComputedStyle(panel).transform;
    const y = transform && transform !== "none" ? new DOMMatrix(transform).m42 : 0;
    return Math.max(0, pinState.current.fromBottom ? y : -y);
  }, [panel]);

  // A frame at a time while a finger is on it or it is on its way, until
  // it has been still a few frames: under a finger (the Drawer's
  // data-swiping) the parts held in sight, and on a phone's bottom sheet
  // the map's buttons riding on its top (--sheet-cover).
  const followFrame = useRef(0);
  const fullRef = useRef(detents.full);
  const restRef = useRef(0);
  useLayoutEffect(() => {
    fullRef.current = detents.full;
    restRef.current = Math.max(0, detents.full - detents[size]);
  }, [detents, size]);
  const follow = useCallback((held: boolean) => {
    if (!panel) return;
    cancelAnimationFrame(followFrame.current);
    let last = NaN, still = 0, pressed = held, swiped = false;
    const lift = () => { pressed = false; };
    window.addEventListener("pointerup", lift, { once: true });
    window.addEventListener("pointercancel", lift, { once: true });
    const step = () => {
      const off = offNow();
      const swiping = panel.hasAttribute("data-swiping");
      if (swiping) pin(off, "");
      else if (swiped && !movingRef.current) {
        // Let go where it was (or past the pill, the close refused): no
        // new size to commit, so the popup and the parts go back to it
        // here, on the shortest settle's time.
        panel.style.setProperty("--sheet-seconds", `${SETTLE_LEAST}s`);
        pin(restRef.current, `${SETTLE_LEAST}s cubic-bezier(0, 0, 0.58, 1)`);
      }
      swiped = swiping;
      const h = Math.max(0, Math.round(fullRef.current - off));
      if (h !== last) {
        if (onPhone && pinState.current.fromBottom) coverRule().setProperty("--sheet-cover", `${h}px`);
        else coverRule().removeProperty("--sheet-cover");
      }
      still = h === last ? still + 1 : 0;
      last = h;
      if (pressed || movingRef.current || still < 6) followFrame.current = requestAnimationFrame(step);
      else {
        window.removeEventListener("pointerup", lift);
        window.removeEventListener("pointercancel", lift);
      }
    };
    step();
  }, [panel, onPhone, offNow, pin]);
  useEffect(() => () => {
    cancelAnimationFrame(followFrame.current);
    coverRule().removeProperty("--sheet-cover");
  }, []);
  useLayoutEffect(() => {
    if (!moving) follow(false);
  }, [moving, follow, detents, size]);
  // The parts held in sight go where the sheet is going, in the commit
  // that sets its snap point, on its curve and time; at rest, put there.
  useLayoutEffect(() => {
    const off = Math.max(0, detents.full - detents[size]);
    pin(off, moving && seconds > 0 ? `${seconds}s cubic-bezier(0, 0, 0.58, 1)` : "");
  }, [pin, moving, seconds, detents, size, footShown, fromBottom]);

  // Off to `target`: the popup's snap point changes in this render, the
  // map told as it sets off, the page once it has landed.
  const landTimer = useRef(0);
  const go = useCallback((target: PanelState, tell: boolean) => {
    const from = detentsRef.current[sizeRef.current];
    const to = detentsRef.current[target];
    const settle = prefersReducedMotion() ? 0 : settleSeconds(to - from);
    window.clearTimeout(landTimer.current);
    if (tell) asked.current = target;
    sizeRef.current = target;
    movingRef.current = true;
    setSize(target);
    setSeconds(settle);
    setMoving(true);
    panel?.dispatchEvent(new CustomEvent<SheetTurn>("sheetturn", { bubbles: true, detail: { insets: insetsFor(target, detentsRef.current) } }));
    follow(false);
    landTimer.current = window.setTimeout(() => {
      movingRef.current = false;
      setMoving(false);
      if (asked.current === target) {
        asked.current = null;
        tellPage(target);
      }
      if (headBand) setHeadHeight(headBand.offsetHeight);
      if (footNode) setFootHeight(footNode.offsetHeight);
    }, settle * 1000 + 40);
  }, [panel, insetsFor, follow, tellPage, headBand, footNode]);
  const ask = useCallback((target: PanelState) => go(target, true), [go]);
  useEffect(() => () => window.clearTimeout(landTimer.current), []);
  useLayoutEffect(() => {
    detentsRef.current = detents;
  }, [detents]);
  // The page's own size, come as a prop: gone to.
  useEffect(() => {
    if (pageState !== sizeRef.current) go(pageState, false);
  }, [pageState, go]);
  // What the workspace draws for a sheet on the move (FPL's strips).
  useEffect(() => {
    const frame = requestAnimationFrame(() => usePanelDragging.setState({ dragging: moving }));
    return () => cancelAnimationFrame(frame);
  }, [moving]);
  // The room it leaves the map, told once at rest (the turn's event said
  // it as the sheet set off).
  const insetsNow = useMemo(() => insetsFor(size, detents), [insetsFor, size, detents]);
  useEffect(() => {
    if (!moving) tellInsets(insetsNow);
  }, [moving, insetsNow, tellInsets]);

  // The Drawer's own say: the detent a drag let go at, and a close -- by
  // a swipe past the pill or Escape -- refused, Escape lowering it.
  const snapped = (point: Drawer.Root.SnapPoint | null, details: Drawer.Root.SnapPointChangeEventDetails) => {
    if (point === null) {
      details.cancel();
      return;
    }
    const d = detentsRef.current;
    const px = typeof point === "number" ? point : parseFloat(point);
    const target = (Object.keys(d) as PanelState[]).reduce((best, s) => (Math.abs(d[s] - px) < Math.abs(d[best] - px) ? s : best));
    if (target !== sizeRef.current) ask(target);
  };
  const openChanged = (open: boolean, details: Drawer.Root.ChangeEventDetails) => {
    if (open) return;
    details.cancel();
    if (details.reason === "escape-key" && sizeRef.current !== "peek") ask("peek");
  };

  // Scrolled up, a page's content runs on under the head and is seen
  // through it (--head-room, the under-head utility); while there is
  // content under the head, the head is frosted over it (data-under).
  const under = !atPill;
  useEffect(() => {
    if (!headBand || !panel || !under) return;
    const frost = (scroller: Element | undefined) => {
      if (scroller && scroller.scrollTop > 0) headBand.setAttribute("data-under", scroller.hasAttribute("data-local-head") ? "local" : "");
      else headBand.removeAttribute("data-under");
    };
    const onScroll = (event: Event) => {
      const at = event.target;
      if (at instanceof HTMLElement && at.classList.contains("under-head") && panel.contains(at)) frost(at);
    };
    const frame = requestAnimationFrame(() => frost(
      [...panel.querySelectorAll<HTMLElement>(".under-head")].find(el => el.checkVisibility?.() ?? el.offsetParent !== null),
    ));
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      headBand.removeAttribute("data-under");
    };
  }, [headBand, panel, under, label, cardOver, layer, cardsUp]);

  const expanded = size !== "peek";
  // A card opened comes up half way at the least, all the way for a
  // search; the last put away, the panel goes back to where it was.
  const raisedFrom = useRef<PanelState | null>(null);
  const heldAt = useRef<PanelState | null>(null);
  useEffect(() => {
    if (raised) heldAt.current = size;
  });
  useEffect(() => {
    const now = sizeRef.current;
    if (raised) {
      raisedFrom.current ??= now;
      if (RANK[now] < RANK[raised]) ask(raised);
    } else if (raisedFrom.current !== null) {
      const back = raisedFrom.current;
      raisedFrom.current = null;
      if (back !== now && now === heldAt.current) ask(back);
    }
  }, [raised, ask]);

  // The panel's size on <body> as well, for the stylesheet's rules about
  // what else is over the map (index.css). Each set on its own.
  useLayoutEffect(() => {
    document.body.dataset.mapPanel = size;
    return () => { delete document.body.dataset.mapPanel; };
  }, [size]);
  useLayoutEffect(() => {
    document.body.toggleAttribute("data-map-sheet", onPhone);
    return () => document.body.removeAttribute("data-map-sheet");
  }, [onPhone]);

  const panelSize = useMemo(() => ({ size, to: ask, card: cardInPill }), [size, ask, cardInPill]);
  // A tap on the grabber cycles the three heights, small to big and back:
  // from half it goes on the way the panel last moved. The arrow keys
  // step it, for a keyboard and VoiceOver.
  const [was, setWas] = useState(size);
  const [rising, setRising] = useState(true);
  if (size !== was) {
    setWas(size);
    setRising(RANK[size] > RANK[was]);
  }
  const cycle = () => ask(size === "peek" || size === "full" ? "half" : rising ? "full" : "peek");
  const arrows = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowUp" && size !== "full") ask(size === "peek" ? "half" : "full");
    else if (event.key === "ArrowDown" && size !== "peek") ask(size === "full" ? "half" : "peek");
    else return;
    event.preventDefault();
  };

  // Where the panel's top-right button sits, one place in every panel
  // (--corner-line, --corner-inset).
  const headPad = fromBottom ? "0.25rem" : "max(0.5rem, env(safe-area-inset-top))";
  const bodyPad = fromBottom ? "0px" : "env(safe-area-inset-top)";
  const vars = {
    "--corner-line": "calc((2.5625rem - 36px) / 2)",
    "--corner-inset": `calc(${headPad} - ${bodyPad} + (2.5625rem - 36px) / 2)`,
  } as CSSProperties;

  // iOS's grabber: 36 by 5 in a button a little wider, over the first
  // row's own room at the sheet's free edge: the top of a bottom sheet,
  // the foot of a top sheet; tapped it cycles the heights, and it is what
  // a keyboard and VoiceOver use. Its hit area stops at the first row,
  // whose tabs have their own 44 points.
  const grabber = (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      data-testid="sidebar-trigger-button"
      onClick={cycle} onKeyDown={arrows}
      className={cn(
        "absolute inset-x-0 z-30 mx-auto flex w-24 touch-none justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset print:hidden",
        "after:inset-x-0! after:top-0! after:bottom-0!",
        fromBottom ? "top-0 h-2.5 items-start pt-1" : "bottom-0 h-4 items-end pb-[5px]",
      )}
    >
      <span className={cn("h-[5px] w-9 rounded-full", ownHead || pillPictured ? "bg-white/75 shadow-[0_0_3px_rgba(0,0,0,.5)]" : "bg-muted-foreground/40")} aria-hidden="true" />
    </button>
  );
  // The popup eases to its snap point on the owner's curve and time, and
  // follows the finger with no transition (data-swiping).
  const withSheet = "transition-transform duration-[var(--sheet-seconds)] ease-[cubic-bezier(0,0,0.58,1)] motion-reduce:transition-none";
  const restingPill = atPill && !moving;

  return (
    <Drawer.Root
      open modal={false} disablePointerDismissal
      swipeDirection={fromBottom ? "down" : "up"}
      snapPoints={snapPoints} snapPoint={detents[size]} onSnapPointChange={snapped}
      snapToSequentialPoints
      onOpenChange={openChanged}
    >
      <Drawer.Portal>
        {/* The screen the sheet is held on: on the keyboard while it is up.
            Not a target itself, so the map under it is the map's. */}
        <Drawer.Viewport className="pointer-events-none fixed inset-x-0 top-0 z-40 print:static" style={{ bottom: keyboard }}>
          <Drawer.Popup
            ref={setPanel}
            // A finger on it: the map's buttons go with it.
            onPointerDown={() => follow(true)}
            initialFocus={false}
            finalFocus={false}
            aria-label={label}
            data-slot="map-panel" data-panel={size} {...(onPhone ? { "data-sheet": "" } : {})}
            data-capsule={restingPill || undefined}
            style={{
              ...vars,
              height: detents.full,
              borderRadius: fromBottom ? `${PILL_RADIUS}px ${PILL_RADIUS}px 0 0` : `0 0 ${PILL_RADIUS}px ${PILL_RADIUS}px`,
              "--sheet-seconds": `${seconds}s`,
            } as CSSProperties}
            className={cn(
              // Clipped rather than hidden: a hidden overflow can still be
              // scrolled by a script, and a row brought into view in the
              // body scrolled the whole panel, its head up out of sight.
              "group/sheet pointer-events-auto absolute flex flex-col overflow-clip text-foreground outline-none will-change-transform",
              // Slid by the Drawer's offset and the finger's movement, in
              // a class, not the element's own style: the Drawer clears
              // its popup's inline transform as a finger goes down, which
              // took the sheet to its full height at a touch (the owner,
              // 2026-11-04: "As soon as I touch the sheet it goes all the
              // way up"), and React never put it back.
              "[transform:translateY(calc(var(--drawer-snap-point-offset)_+_var(--drawer-swipe-movement-y)))]",
              withSheet, "data-[swiping]:transition-none",
              fromBottom ? "bottom-0" : "top-0",
              // Liquid Glass at every size, as Maps' is: the chart through
              // it, blurred, the same pane whether it is the pill or the sheet.
              onPhone ? GLASS : MATERIAL,
              onPhone ? "inset-x-0" : "left-[max(1rem,env(safe-area-inset-left))] w-[24rem] shadow-[0_2px_10px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:shadow-[0_2px_10px_rgba(0,0,0,0.45)] dark:ring-white/10",
            )}
          >
            {pillPictured && pill && <PillPicture pill={pill} />}
            {fromBottom && grabber}
            {/* The head's band: the first row (the bar), the top row, any
                notice, the controls. Over the body, which runs on up under
                it (`under`): frosted while anything is there. */}
            <div
              ref={setHeadBand} data-head-band=""
              className={cn("relative flex shrink-0 flex-col", under && "z-20", !fromBottom && "pt-[env(safe-area-inset-top)]")}
            >
              {bar && (
                <div
                  className={cn(
                    // The grabber's band, the tabs 52 tall, six under them: the
                    // tab up's capsule clear of the grabber and of the search
                    // under it (the owner, 2026-11-04: 49 points "too
                    // congested", "make the space around the tabs slick like
                    // the grabber and the search bar"); minimized to a card's
                    // name, as tall as the name's 44-point area, a line under it.
                    "flex shrink-0 px-2", ROW_PAD, minimized ? "min-h-11 border-b border-border/60 pb-2" : "h-[4.25rem] pb-1.5",
                    !barHere && "hidden",
                  )}
                >
                  <TabBarMinimized.Provider value={minimized}><BarOverPicture.Provider value={pillPictured}><PanelSize.Provider value={panelSize}>{bar}</PanelSize.Provider></BarOverPicture.Provider></TabBarMinimized.Provider>
                </div>
              )}
              {/* Under the tab bar, the route's box and its buttons a shade
                  darker (SHEET_BELOW), for the clear glass to stand off it. */}
              <div className={cn("relative flex flex-col", bar && barHere && !atPill && SHEET_BELOW, !headerShown && kept == null && "hidden")}>
                {(headerShown || kept != null) && (
                  <header
                    className={!headerShown ? "contents" : cn(
                      "@container flex items-center gap-2 print:hidden",
                      atPill ? cn("px-[9px] pb-3", ROW_PAD)
                        : top == null ? undefined
                          : cn("px-3 pb-1", barHere ? "pt-1" : ROW_PAD),
                    )}
                  >
                    {/* The kept row first, in the one place whatever is shown,
                        so it is never built again; out of sight inert and not
                        laid out (tab-away). */}
                    {kept != null && (
                      <div className={keptHere ? "contents" : "tab-away pointer-events-none absolute"} inert={!keptHere}>{kept}</div>
                    )}
                    {headerShown && !keptHere && headContent}
                  </header>
                )}
                {headerShown && !atPill && controls && (
                  <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-3 px-3 pt-1 print:hidden", fromBottom ? "pb-1.5" : "pb-5")}>{controls}</div>
                )}
              </div>
            </div>
            {/* The body, laid out at every size and cut off where the sheet
                ends: over a bottom sheet's figures by a translate, its
                content moved back by the same. At rest in the pill out of
                sight and of the keyboard's reach. */}
            <div
              ref={setBodyNode}
              className={cn(
                "flex min-h-0 flex-1 flex-col border-border/60", expanded && cn(!ownHead && "border-t", !fromBottom && "pb-4"),
                SHEET_BELOW,
                restingPill && "invisible",
              )}
              inert={restingPill}
              // The sizes the body's content is laid out to: changed as it
              // sets off and at rest, never per frame.
              style={{ "--half-body": `${halfBody}px`, "--full-body": `${fullBody}px`, "--half-foot": `${toEdge && fromBottom ? halfChrome : 0}px`, "--head-room": `${under ? headHeight : 0}px`, "--panel-head": `${under ? headHeight : 0}px` } as CSSProperties}
              data-panel-body=""
            >
              <div ref={setInnerNode} className="flex min-h-0 flex-1 flex-col">
                <TabKept away={cardsUp}>{children}</TabKept>
                <SheetCardHost shown={cardsUp} />
              </div>
            </div>
            {/* The route's figures, or the strip's field, pinned at the
                sheet's foot at every size: in the pill its one row. Kept
                under a card, out of sight, with what it holds open. */}
            {!!foot && (footShown || cardsUp) && (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer convenience, not a control: the grabber is the keyboard's way to open the sheet, and the figures' own buttons stay focusable
              <div
                ref={setFootNode}
                className={cn(
                  // One box at every size, the figures centred in it, so
                  // the figures growing (--sheet-progress) never lays the
                  // sheet out again: the row's 44 and its padding, the line
                  // over it clear in the pill. What gives way in the pill
                  // (data-pill-hides) is put away there.
                  "flex min-h-[3.875rem] shrink-0 flex-col justify-center border-t pb-1 print:hidden", ROW_PAD, cardInPill ? "px-0" : "px-4",
                  !footShown && "hidden",
                  atPill ? "border-transparent [&_[data-pill-hides]]:hidden [&>*]:flex-none" : cn("border-border/60", SHEET_BELOW),
                  fieldPill && atPill && "px-3",
                )}
                style={{ "--sheet-progress": size === "full" ? "1" : "0", ...(toEdge && fromBottom && !atPill ? { paddingBottom: Math.max(10, edgeInset) } : {}) } as CSSProperties}
                data-testid="panel-foot"
                // In the pill a tap on it opens it half way.
                onClick={atPill ? () => ask("half") : undefined}
              >{foot}</div>
            )}
            {!fromBottom && grabber}
            {/* The rest of the way to the screen's edge, under the home
                indicator -- in the body where it runs to the edge (toEdge). */}
            {!toEdge && edgeInset > 0 && <div className="shrink-0" style={{ height: edgeInset }} aria-hidden="true" />}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
