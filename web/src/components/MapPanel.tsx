import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import { useKeyboardInset, useSafeArea, useWindowHeight } from "../hooks/use-viewport";
import {
  GLASS, MATERIAL, BarOverPicture, PanelSize, PILL_RADIUS, usePanelDragging, SHEET_MARGIN, TabBarMinimized,
  useTabsShown, type MapInsets, type PanelState,
} from "./mapChrome";
import { useOpenCards } from "../lib/openCards";
import { PillPicture } from "./PillPicture";
import { SheetCardHost } from "./SheetCard";
import { raisedFor, useSheetCards } from "../lib/sheetCards";
import TabKept from "./TabKept";
import { prefersReducedMotion } from "../lib/motion";
import { usePreferences } from "../lib/preferences";
import { restingAt, settleSeconds, type Detents } from "./sheet/engine";
import { useSheetDrag } from "./sheet/useSheetDrag";

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
/** A phone's sheet eases where it is going on iOS's ease-out
 *  (feedback: no spring). */
const EASE = "cubic-bezier(0, 0, 0.58, 1)";
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
 * under those. A sheet on the navigation bar's edge with iOS's three
 * detents -- the pill (its first row), half the screen, all of it -- and
 * a grabber on its far edge: drag it, its first row, the head, or with a
 * finger anywhere on the body, and it follows the finger and lets go to
 * the detent it was heading for; tap the grabber and it cycles; Escape
 * lowers it. The screen's width on a phone; from `md` up 24 rem wide at
 * the left.
 *
 * One sheet, a bottom sheet or a top sheet by the pilot's Layout setting
 * (useNavEdge), at the owner's ask (2026-11-04: "make sure that sheet code
 * is simple and just either bottom sheet or top sheet, based on the
 * user's setup"); the floating card it was from `md` up, placed by its
 * height, went. It is placed by one number, its height `h`: a column
 * laid out at the larger of where it is and where it is going, held on
 * its screen edge by its own style (bottom: 0, or top: 0), and slid off
 * that edge by what is laid out past h (laid - h) -- no height eased, no
 * shape changed, the glass as it is at every size. A settle is a CSS
 * transition of that transform alone; under a finger the transform is
 * written once a frame. What must stay in sight at the sheet's free edge
 * is moved back by the same number: a bottom sheet's route figures (the
 * body cut off over them by a translate and its content's reverse one),
 * a top sheet's head. The map
 * goes with the sheet's edge frame by frame (lib/map/sheetSlide), and
 * the page hears the room the sheet leaves as a turn starts (sheetturn)
 * and once it has landed (onInsetsChange) -- nothing per frame through
 * React. Each mechanism this replaced (a capsule-to-sheet morph, Web
 * Animations synced to the map, a WebKit special case, measured heads
 * with transitionend state) was a fix for the previous one's artefact,
 * and the owner saw the sum as glitchy (2026-11-04).
 *
 * Not a stock sheet, which the app's other sheets are (shadcn's Sheet):
 * those are modal Radix dialogs, and one that never closes would hold
 * the keyboard's focus inside itself and hide the map.
 */
export default function MapPanel({ label, top, kept, controls, compact, children, state: pageState, onStateChange: tellPage, onInsetsChange: tellInsets, toEdge: edgeAsked = false, bar, layer = "tab", cardOver: overAsked = false, foot, flying = false }: Props) {
  // The pill's first row: the tab bar, or in the strip layout the strip's
  // one field (the foot), its ribbon (the bar) from half way up
  // (features/strip, lib/preferences). The owner's field-tabs layout puts
  // its field at the top of the map, so its pill is the tabs' (2026-11-04).
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

  // The size the sheet shows: the page's, or the one it was asked for
  // here (a drag let go, the grabber, a tab's tap), told to the page once
  // it has landed -- told at once, the page drew the whole workspace again
  // for the new size before the sheet could move (140 ms at 4x).
  const [size, setSize] = useState(pageState);
  const asked = useRef<PanelState | null>(null);
  // What the sheet is doing: nothing, a finger on it, or on its way.
  const [motion, setMotion] = useState<"drag" | "settle" | null>(null);
  const motionRef = useRef(motion);
  // The height the column is laid out at on its way: the larger of the
  // two ends of a settle, under a finger half or all the way up.
  const [moveLaid, setMoveLaid] = useState<number | null>(null);
  // The pill: its first row and nothing else laid out, the column its
  // own height.
  const atPill = size === "peek" && hasPill;

  // Measured at rest only: the pill's own height (the column laid out as
  // the pill), the head's band and the foot.
  const [panel, setPanelNode] = useState<HTMLElement | null>(null);
  const [headBand, setHeadBand] = useState<HTMLDivElement | null>(null);
  const [footNode, setFootNodeState] = useState<HTMLDivElement | null>(null);
  // The parts the placement writes to, in refs: what is written to a
  // frame at a time is no state of the render's.
  const nodes = useRef<{ panel: HTMLElement | null; head: HTMLElement | null; foot: HTMLElement | null; body: HTMLElement | null; inner: HTMLElement | null }>({ panel: null, head: null, foot: null, body: null, inner: null });
  const setPanel = useCallback((node: HTMLElement | null) => { nodes.current.panel = node; setPanelNode(node); }, []);
  const setFootNode = useCallback((node: HTMLDivElement | null) => { nodes.current.foot = node; setFootNodeState(node); }, []);
  const setInnerNode = useCallback((node: HTMLDivElement | null) => { nodes.current.inner = node; }, []);
  const setHeadNode = useCallback((node: HTMLDivElement | null) => { nodes.current.head = node; setHeadBand(node); }, []);
  const [pillHeight, setPillHeight] = useState<number | null>(null);
  const [headHeight, setHeadHeight] = useState(0);
  const [footHeight, setFootHeight] = useState(0);
  const atPillRef = useRef(atPill);
  useEffect(() => {
    if (!panel) return;
    const watch = new ResizeObserver(() => {
      if (motionRef.current !== null || !atPillRef.current) return;
      setPillHeight(panel.offsetHeight);
    });
    watch.observe(panel);
    return () => watch.disconnect();
  }, [panel]);
  useEffect(() => {
    if (!headBand) return;
    const watch = new ResizeObserver(() => { if (motionRef.current === null) setHeadHeight(headBand.offsetHeight); });
    watch.observe(headBand);
    return () => watch.disconnect();
  }, [headBand]);
  useEffect(() => {
    if (!footNode) return;
    const watch = new ResizeObserver(() => { if (motionRef.current === null) setFootHeight(footNode.offsetHeight); });
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

  // Where a drag can come to rest: the pill, half and all the way up.
  const halfChrome = fromBottom ? edgeInset : GRABBER;
  const detents = useMemo<Detents>(() => {
    const peek = pillHeight ?? Math.round(4.25 * rootPx()) + edgeInset;
    const whole = Math.max(peek, room);
    const askedHalf = Math.max(peek, Math.min(Math.round(HALF_REM * rootPx()) + halfChrome, Math.round(whole * HALF_MOST)));
    const body = askedHalf - headHeight - halfChrome - footHeight;
    const half = body > 0 && body < HALF_BODY_LEAST_REM * rootPx() ? Math.max(peek, askedHalf - body) : askedHalf;
    // All the way up only as far as a short card on top needs (cardFit):
    // a fix's card was a line and an empty sheet up to the status bar.
    const full = cardFit === null ? whole : Math.max(Math.min(half, whole), Math.min(whole, headHeight + halfChrome + cardFit));
    return { peek, half: Math.min(half, full), full };
  }, [pillHeight, edgeInset, room, halfChrome, headHeight, footHeight, cardFit]);
  const detentsRef = useRef(detents);
  // The column's height: at the pill its own, else the size's -- or on
  // its way, the larger end.
  const laid = moveLaid ?? (atPill ? null : detents[size]);
  const laidPx = laid ?? detents.peek;
  const halfBody = Math.max(0, detents.half - headHeight - halfChrome - footHeight);
  const fullBody = Math.max(0, detents.full - headHeight - halfChrome - footHeight);

  // What it covers of the map where it comes to rest (insetsOf).
  const insetsFor = useCallback((s: PanelState, d: Detents) => insetsOf(s, d, onPhone, fromBottom), [onPhone, fromBottom]);

  // The one number: the sheet's height now. At rest the size's detent; on
  // its way, where the transform has it this frame.
  const hRef = useRef(detents[size]);
  const laidRef = useRef(laidPx);
  // The column's height as the render sets it (null at the pill at rest,
  // where it is the pill's own), for place() to put back.
  const laidStyleRef = useRef(laid);
  const pinRef = useRef(false);
  const fromBottomRef = useRef(fromBottom);
  const onPhoneRef = useRef(onPhone);
  const sizeRef = useRef(size);
  const currentHeight = useCallback(() => {
    const el = nodes.current.panel;
    if (motionRef.current !== "settle" || !el) return hRef.current;
    const transform = getComputedStyle(el).transform;
    // Its own laid height less how far off its edge it is slid this frame.
    return transform && transform !== "none" ? el.offsetHeight - Math.abs(new DOMMatrix(transform).m42) : hRef.current;
  }, []);
  // Every part's transition: on for a settle, off at rest and under a finger.
  const setEase = useCallback((seconds: number | null) => {
    const { panel: el, head, foot, body, inner } = nodes.current;
    const curve = seconds ? `${seconds}s ${EASE}` : null;
    for (const part of [el, head, body, inner]) if (part) part.style.transition = curve ? `transform ${curve}` : "";
    if (foot) foot.style.transition = curve ? `transform ${curve}, --sheet-progress ${curve}` : "";
    coverRule().setProperty("--sheet-cover-ease", curve ?? "0s");
  }, []);
  // The sheet at `h`, written straight to the style: held on its edge by
  // its style (bottom: 0 or top: 0) and slid off it by what is laid out
  // past h, never toward the screen's middle, so its edge never leaves
  // the screen's (the owner, 2026-11-04: "why is it moving at all from the
  // bottom?"). Where a finger outruns the render that lays the column out
  // taller (setMoveLaid), the sheet's own height goes with it. What must
  // stay in sight at its free edge is moved back by the same: a bottom
  // sheet's figures, the body cut off over them (the pin); a top sheet's
  // head, the body with it. A bottom sheet's top carries the map's
  // buttons (--sheet-cover).
  const place = useCallback((h: number) => {
    hRef.current = h;
    const { panel: el, head, foot, body, inner } = nodes.current;
    if (!el) return;
    const short = h > laidRef.current + 0.5;
    el.style.height = short ? `${Math.ceil(h)}px` : laidStyleRef.current === null ? "" : `${laidStyleRef.current}px`;
    const over = short ? 0 : Math.max(0, laidRef.current - h);
    const shift = (px: number) => (px ? `translate3d(0, ${Math.round(px * 100) / 100}px, 0)` : "");
    if (fromBottomRef.current) {
      el.style.transform = shift(over);
      const pinned = pinRef.current ? over : 0;
      if (head) head.style.transform = "";
      if (foot) foot.style.transform = shift(-pinned);
      if (body) {
        body.style.transform = shift(-pinned);
        body.style.overflow = pinned ? "clip" : "";
      }
      if (inner) inner.style.transform = shift(pinned);
    } else {
      el.style.transform = shift(-over);
      for (const part of [head, body]) if (part) part.style.transform = shift(over);
      if (foot) foot.style.transform = "";
      if (body) body.style.overflow = "";
      if (inner) inner.style.transform = "";
    }
    if (onPhoneRef.current && fromBottomRef.current) coverRule().setProperty("--sheet-cover", `${Math.max(0, Math.round(h))}px`);
    else coverRule().removeProperty("--sheet-cover");
  }, []);

  // A settle: to `target`, from where the sheet is now, started after the
  // commit that lays the column out for it (the pending move, below).
  // `begun`: already on its way, set off at the release itself (below).
  const pending = useRef<{ from: number; to: number; target: PanelState; begun?: { at: number; seconds: number } } | null>(null);
  const landTimer = useRef(0);
  const settleTo = useCallback((target: PanelState, now = false) => {
    const from = currentHeight();
    const to = detentsRef.current[target];
    window.clearTimeout(landTimer.current);
    const move: NonNullable<typeof pending.current> = { from, to, target };
    pending.current = move;
    // A finger let go: the sheet sets off in this frame, not after the
    // render the new size asks for. Dragged down to the pill, that render
    // lays out the pill's row and puts the body away, and the sheet sat
    // where the finger left it for as long as it took (the owner,
    // 2026-11-04: "it still takes a second to settle when dragging
    // down"). The column is laid out at the larger end already under a
    // finger, and place() makes it taller where it is not.
    if (now && nodes.current.panel) {
      const seconds = prefersReducedMotion() || Math.abs(to - from) < 0.5 ? 0 : settleSeconds(to - from);
      // Laid out at the larger end from the start, as the render about
      // to come lays it (setMoveLaid below): one height for the whole
      // settle, the transform alone eased.
      if (to > laidRef.current) {
        laidRef.current = to;
        laidStyleRef.current = to;
      }
      setEase(null);
      place(from);
      if (seconds > 0) {
        void nodes.current.panel.offsetHeight;
        setEase(seconds);
      }
      place(to);
      motionRef.current = "settle";
      move.begun = { at: performance.now(), seconds };
    }
    setSize(target);
    setMotion("settle");
    setMoveLaid(Math.max(laidRef.current, to));
  }, [currentHeight, setEase, place]);
  const ask = useCallback((target: PanelState, now = false) => {
    asked.current = target;
    settleTo(target, now);
  }, [settleTo]);
  // The page's own size, come as a prop: gone to.
  useEffect(() => {
    if (pageState !== sizeRef.current) settleTo(pageState);
  }, [pageState, settleTo]);
  const land = useCallback((target: PanelState) => {
    window.clearTimeout(landTimer.current);
    setEase(null);
    nodes.current.foot?.style.setProperty("--sheet-progress", target === "full" ? "1" : "0");
    motionRef.current = null;
    setMotion(null);
    setMoveLaid(null);
    if (asked.current === target) {
      asked.current = null;
      tellPage(target);
    }
    // Measured again at rest, what the observers let pass on the way.
    if (headBand) setHeadHeight(headBand.offsetHeight);
    if (footNode) setFootHeight(footNode.offsetHeight);
  }, [setEase, headBand, footNode, tellPage]);

  // After every commit: the refs in step with the render, then the sheet
  // placed -- a settle begun where one is pending, else where it rests.
  const settledOnce = useRef(false);
  useLayoutEffect(() => {
    laidRef.current = laidPx;
    laidStyleRef.current = laid;
    fromBottomRef.current = fromBottom;
    onPhoneRef.current = onPhone;
    sizeRef.current = size;
    atPillRef.current = atPill;
    detentsRef.current = detents;
    motionRef.current = motion;
    pinRef.current = footShown && !atPill;
    const { panel: el, foot } = nodes.current;
    if (!el) return;
    const m = pending.current;
    if (m?.begun) {
      // Set off at the release: only its end to wait for, and the parts
      // this render laid out (the pin, the column's height) put in step.
      pending.current = null;
      place(m.to);
      foot?.style.setProperty("--sheet-progress", m.target === "full" ? "1" : "0");
      el.dispatchEvent(new CustomEvent<SheetTurn>("sheetturn", { bubbles: true, detail: { insets: insetsFor(m.target, detents) } }));
      const left = m.begun.seconds * 1000 + 40 - (performance.now() - m.begun.at);
      landTimer.current = window.setTimeout(() => land(m.target), Math.max(0, left));
      return;
    }
    if (m) {
      pending.current = null;
      const seconds = prefersReducedMotion() || Math.abs(m.to - m.from) < 0.5 ? 0 : settleSeconds(m.to - m.from);
      setEase(null);
      place(m.from);
      if (seconds > 0) {
        // The start seen before the end: a transition runs from the
        // computed style, and the figures' new start is of this commit.
        void el.offsetHeight;
        setEase(seconds);
      }
      place(m.to);
      foot?.style.setProperty("--sheet-progress", m.target === "full" ? "1" : "0");
      el.dispatchEvent(new CustomEvent<SheetTurn>("sheetturn", { bubbles: true, detail: { insets: insetsFor(m.target, detents) } }));
      landTimer.current = window.setTimeout(() => land(m.target), seconds * 1000 + 40);
      return;
    }
    if (motion === null) {
      const target = detents[size];
      // Grown or shrunk at rest -- a route's figures come to the pill, the
      // keyboard up -- eased there, as a size is; the first measurement
      // put in place.
      if (settledOnce.current && Math.abs(hRef.current - target) > 1 && !prefersReducedMotion()) {
        settleTo(size);
        return;
      }
      if (pillHeight !== null || !atPill) settledOnce.current = true;
      hRef.current = target;
      foot?.style.setProperty("--sheet-progress", size === "full" ? "1" : "0");
    }
    place(hRef.current);
  });
  useEffect(() => () => window.clearTimeout(landTimer.current), []);
  // Said a frame on, so that what the workspace draws for a sheet on the
  // move (FPL's strips, usePanelDragging) is not in the frame the sheet
  // sets off in: there it held the first frame of the move back by the
  // workspace's render (sampled at CPU 4x, 2026-11-04).
  useEffect(() => {
    const frame = requestAnimationFrame(() => usePanelDragging.setState({ dragging: motion !== null }));
    return () => cancelAnimationFrame(frame);
  }, [motion]);
  // The room it leaves the map, told once at rest (the turn's event said
  // it as the sheet set off).
  const insetsNow = useMemo(() => insetsFor(size, detents), [insetsFor, size, detents]);
  useEffect(() => {
    if (motion === null) tellInsets(insetsNow);
  }, [motion, insetsNow, tellInsets]);

  // A drag: from the grabber, the first row, the head and the pill's
  // foot by pointer; from the body by touch (useSheetDrag).
  const { startDrag, swallow, body: dragBody } = useSheetDrag({
    detents, fromBottom,
    height: currentHeight,
    began: () => {
      const h = currentHeight();
      window.clearTimeout(landTimer.current);
      pending.current = null;
      setEase(null);
      motionRef.current = "drag";
      setMotion("drag");
      // Laid out at half under a finger, all the way up once past it.
      setMoveLaid(Math.max(h, h > detentsRef.current.half + 1 ? detentsRef.current.full : detentsRef.current.half));
      place(h);
    },
    place: h => {
      place(h);
      const d = detentsRef.current;
      const want = h > d.half + 1 ? d.full : d.half;
      if (want !== laidRef.current) setMoveLaid(want);
    },
    release: (h, speed) => ask(restingAt(detentsRef.current, h, speed), true),
  });
  const setBodyRef = useCallback((node: HTMLDivElement | null) => {
    nodes.current.body = node;
    dragBody(node);
  }, [dragBody]);

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

  // Escape lowers it, pressed anywhere in it -- but not in a menu or a
  // list it opened, which closes first.
  const expanded = size !== "peek";
  useEffect(() => {
    if (!panel || !expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) ask("peek");
    };
    panel.addEventListener("keydown", onKey);
    return () => panel.removeEventListener("keydown", onKey);
  }, [panel, expanded, ask]);
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
  useEffect(() => () => { coverRule().removeProperty("--sheet-cover"); coverRule().removeProperty("--sheet-cover-ease"); }, []);

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
  // the foot of a top sheet; tapped it cycles the heights, and
  // it is what a keyboard and VoiceOver use. Its hit area stops at the
  // first row, whose tabs have their own 44 points.
  const grabber = (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      data-testid="sidebar-trigger-button"
      onClick={cycle} onKeyDown={arrows}
      onPointerDown={event => { event.stopPropagation(); startDrag(event); }}
      className={cn(
        "absolute inset-x-0 z-30 mx-auto flex w-24 touch-none justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset print:hidden",
        "after:inset-x-0! after:top-0! after:bottom-0!",
        fromBottom ? "top-0 h-2.5 items-start pt-1" : "bottom-0 h-4 items-end pb-[5px]",
      )}
    >
      <span className={cn("h-[5px] w-9 rounded-full", ownHead || pillPictured ? "bg-white/75 shadow-[0_0_3px_rgba(0,0,0,.5)]" : "bg-muted-foreground/40")} aria-hidden="true" />
    </button>
  );
  const atRest = motion === null;

  return (
    <>
    <section
      ref={setPanel}
      data-slot="map-panel" data-panel={size} {...(onPhone ? { "data-sheet": "" } : {})}
      aria-label={label}
      onClickCapture={swallow}
      data-capsule={atPill && atRest || undefined}
      style={{
        ...vars,
        // Docked on its edge, the screen's width on a phone, as a classic
        // iOS tab bar sits on the home indicator: the owner, 2026-11-04,
        // "should the tabs not be screen width if they are not floating?".
        // A bottom sheet sits on the keyboard while it is up.
        ...(fromBottom ? { bottom: keyboard } : { top: 0 }),
        height: laid ?? undefined, willChange: "transform",
        borderRadius: fromBottom ? `${PILL_RADIUS}px ${PILL_RADIUS}px 0 0` : `0 0 ${PILL_RADIUS}px ${PILL_RADIUS}px`,
      }}
      className={cn(
        // Clipped rather than hidden: a hidden overflow can still be
        // scrolled by a script, and a row brought into view in the body
        // scrolled the whole panel, its head up out of sight.
        "fixed z-40 flex flex-col overflow-clip text-foreground",
        // Liquid Glass at every size, as Maps' is: the chart through it,
        // blurred, the same pane whether it is the pill or the sheet.
        onPhone ? GLASS : MATERIAL,
        onPhone ? "inset-x-0" : "left-[max(1rem,env(safe-area-inset-left))] w-[24rem] shadow-[0_2px_10px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:shadow-[0_2px_10px_rgba(0,0,0,0.45)] dark:ring-white/10",
      )}
    >
      {pillPictured && pill && <PillPicture pill={pill} />}
      {fromBottom && grabber}
      {/* The head's band, dragged as the grabber is: the first row (the
          bar), the top row, any notice, the controls. Over the body, which
          runs on up under it (`under`): frosted while anything is there. */}
      <div
        ref={setHeadNode} data-head-band=""
        className={cn("relative flex shrink-0 touch-none flex-col", under && "z-20", !fromBottom && "pt-[env(safe-area-inset-top)]")}
        onPointerDown={startDrag}
      >
        {bar && (
          <div
            className={cn(
              // One row at every size: the tabs' 48 under the grabber's
              // ten, four under them; minimized to a card's name, as tall
              // as the name's 44-point area, a line under it.
              // The grabber's band, the tabs 52 tall, six under them: the
              // tab up's capsule clear of the grabber and of the search
              // under it, the same rhythm as the field below (the owner,
              // 2026-11-04: 49 points "too congested", "make the space
              // around the tabs slick like the grabber and the search bar").
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
              {/* The kept row first, in the one place whatever is shown, so
                  it is never built again; out of sight inert and not laid
                  out (tab-away). */}
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
      {/* The body: dragged from anywhere under a finger where its content
          is not scrolling (useSheetDrag). Cut off over the figures on the
          way by a translate, its content moved back by the same (inner). */}
      <div
        ref={setBodyRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col border-border/60", expanded && laidPx > detents.half + 1 && cn(!ownHead && "border-t", !fromBottom && "pb-4"),
          SHEET_BELOW,
          // At rest the pill is its one row: the body kept out of sight
          // and of the keyboard's reach.
          atPill && "hidden",
        )}
        // The sizes the body's content is laid out to, from the column's
        // own: changed at a turn and at rest, never per frame.
        style={{ "--half-body": `${halfBody}px`, "--full-body": `${fullBody}px`, "--half-foot": `${toEdge && fromBottom ? halfChrome : 0}px`, "--head-room": `${under ? headHeight : 0}px`, "--panel-head": `${under ? headHeight : 0}px` } as CSSProperties}
        data-panel-body=""
      >
        <div ref={setInnerNode} className="flex min-h-0 flex-1 flex-col">
          <TabKept away={cardsUp}>{children}</TabKept>
          <SheetCardHost shown={cardsUp} />
        </div>
      </div>
      {/* The route's figures, or the strip's field, pinned at the sheet's
          foot at every size: in the pill its one row. Kept under a card,
          out of sight, with what it holds open. */}
      {!!foot && (footShown || cardsUp) && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer convenience, not a control: the grabber is the keyboard's way to open the sheet, and the figures' own buttons stay focusable
        <div
          ref={setFootNode}
          className={cn(
            // One box at every size, the figures centred in it, so the
            // figures growing (--sheet-progress) never lays the sheet out
            // again: the row's 44 and its padding, the line over it clear
            // in the pill. What gives way in the pill (data-pill-hides)
            // is put away there.
            "flex min-h-[3.875rem] shrink-0 flex-col justify-center border-t pb-1 print:hidden", ROW_PAD, cardInPill ? "px-0" : "px-4",
            !footShown && "hidden",
            // In the pill the finger is the sheet's (touch-none), as on the
            // tabs: the browser's own scroll took it and cancelled the drag.
            atPill ? "touch-none border-transparent [&_[data-pill-hides]]:hidden [&>*]:flex-none" : cn("border-border/60", SHEET_BELOW),
            fieldPill && atPill && "px-3",
          )}
          style={{ ...(toEdge && fromBottom && !atPill ? { paddingBottom: Math.max(10, edgeInset) } : {}) } as CSSProperties}
          data-testid="panel-foot"
          // In the pill a finger anywhere on it drags the sheet, as the tabs
          // do; a tap on it opens it half way.
          onPointerDown={atPill ? startDrag : undefined}
          onClick={atPill ? () => ask("half") : undefined}
        >{foot}</div>
      )}
      {!fromBottom && grabber}
      {/* The rest of the way to the screen's edge, under the home
          indicator -- in the body where it runs to the edge (toEdge). */}
      {!toEdge && edgeInset > 0 && <div className="shrink-0" style={{ height: edgeInset }} aria-hidden="true" />}
    </section>
    </>
  );
}
