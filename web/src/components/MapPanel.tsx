import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { sheetEdges, useDetentDrag, type SheetSays } from "../hooks/use-detent-drag";
import { useIsMobile } from "../hooks/use-mobile";
import { useNavEdge } from "../hooks/use-nav-edge";
import { useKeyboardInset, useSafeArea, useVisualHeight, useWindowHeight } from "../hooks/use-viewport";
import {
  GLASS, GLASS_FILL, GLASS_SHEET, GLASS_SHEET_FULL, MATERIAL, BarOverPicture, PanelSize, PILL_RADIUS, usePanelDragging, SHEET_INSET, SHEET_INSET_RADIUS, SHEET_MARGIN, SHEET_RESHAPE, SHEET_SECONDS, SETTLE_LEAST, SETTLE_MOST, SETTLE_POINTS, TabBarMinimized,
  sheetSettle, useTabsShown, type MapInsets, type PanelState,
} from "./mapChrome";
import { useOpenCards } from "../lib/openCards";
import { PillPicture } from "./PillPicture";
import { SheetCardHost } from "./SheetCard";
import { raisedFor, useSheetCards } from "../lib/sheetCards";
import TabKept from "./TabKept";
import { prefersReducedMotion } from "../lib/motion";

/** How far the half sheet is in from the screen's sides and its edge: on
 *  them, as Apple's Maps on the web has its sheet (the owner's screenshots
 *  of it, 2026-10-26); it floated for an hour that day, and from
 *  2026-10-25 it was on them for the route box's buttons' room. The pill
 *  keeps SHEET_INSET. */
const HALF_INSET = 0;

interface Props {
  /** The panel's name -- "Flight Planning", "Model Training" -- for its
   *  grabber and a screen reader. */
  label: string;
  /** The row over everything, always in sight: the route and the
   *  workspace's actions. */
  top: ReactNode;
  /** A top row kept while out of sight (the planner's route box): under
   *  another tab's head, a card alone or the pill it stays built, hidden,
   *  and is `top` again as it was left, as iOS keeps a tab's screen. Built
   *  again from nothing at every switch to FPL it was the most of a
   *  switch's time (the route's pills and pickers, the 23 Oct profile). */
  kept?: ReactNode;
  /** The row under it, in sight at rest too: the airplane and the
   *  departure time, the rating's progress. */
  controls?: ReactNode;
  /** What the panel holds at rest, in place of the route's row and the
   *  controls: a capsule floating over the chart, as Maps' is -- the
   *  training route with a way to its options. With a tab bar the capsule
   *  is the bar alone (`bar`). Without either the panel rests with its
   *  head in sight. */
  compact?: ReactNode;
  /** The body: the nav log and the briefing, the training list. */
  children: ReactNode;
  /** The planner's tab bar (TabBar): the panel's first row over the
   *  sheet, and at rest the pill itself, on a phone as on a larger screen. */
  bar?: ReactNode;
  /** What the panel is showing: a tab of the planner (its head, pill,
   *  foot and the options below), a card open alone over it (the bar
   *  over the card, the pill keeping it, never folding to the tabs alone
   *  under it), or the console's layer (the Setup tab: the bar over the
   *  console, with no head of its own). The options that belong to a tab
   *  -- its head in the pill, its pill's body, its foot staying -- are a
   *  tab's alone, and the console takes neither a card over it nor the
   *  body to the edge: the panel keeps to that, not each caller. */
  layer?: "tab" | "card" | "console";
  /** A card from another tab's world open over this one -- an airport's
   *  card over FPL -- on a phone the bar minimized to the card's kind with
   *  Back to the tab, at the owner's ask ("don't make the tabs into a
   *  centered label unless going from another tab"); else the tabs. */
  cardOver?: boolean;
  /** Pinned at the sheet's foot at every size: the route's figures, at the
   *  pilot's ask -- in the pill in the tabs' place, the pill's own height
   *  (the owner's "the calculations should replace the tabs in the pill
   *  while keeping it the same size"), a tap on them half way. */
  foot?: ReactNode;
  /** The body down to the sheet's own edge, over the home indicator's
   *  inset, where the rest of the way is kept clear for every other
   *  panel: an airport's card, its tiles and tabs at its foot (PlaceCard),
   *  at the pilot's ask. The inset's height is `--half-foot` to it. */
  toEdge?: boolean;
  state: PanelState;
  onStateChange: (state: PanelState) => void;
  onInsetsChange: (insets: MapInsets) => void;
}

/** What the capsule's content keeps from its grabber's edge: nine, the
 *  grabber in it, and twelve from the other, so the pill round the
 *  41-point field is 62 -- the pilot found 69, with fourteen, thick
 *  beside Maps'. */
const CAPSULE_PAD = 9;
/** The grabber's button: 16 tall, its pill five in from the panel's edge. */
const GRABBER = 16;
/** The half sheet's height, in rem, the same on every tab: FPL's route
 *  whole in it -- its box, its chips, the side view at its ten rem with
 *  the dry run's play, and the figures -- at the owner's ask ("Let's make
 *  the half card this tall. This way we won't have to hide the buttons for
 *  dry run", their iPhone's screenshot of the sheet 368 points tall in
 *  Safari, its text at 16 px). A dry run plays in the side view's place,
 *  the chips kept over it (PlanWorkspace). It was 19.75rem, FPL's Saved
 *  flights whole and the side view 109 points of its 160; before that
 *  18.6rem, Setup's account and its email whole and no more. */
const HALF_REM = 23;
/** The most of all the way up the half sheet takes, so the two stay two
 *  sizes: on a short screen -- a phone on its side, 402 points -- its rem
 *  came to all the way up, and a drag up from half had nowhere to go (the
 *  iOS audit's iphone-landscape, #253). There it is the 328 points the old
 *  19.75rem made, near enough; on a phone held upright it is not reached. */
const HALF_MOST = 0.85;
/** The least body worth showing at half, rem: one row of a list (44
 *  points). Less is no body -- the half ends at the head and the foot --
 *  where a phone on its side with a larger text left a sliver of FPL's
 *  first row cut through over the route's figures (the owner's screenshot,
 *  2026-10-22). */
const HALF_BODY_LEAST_REM = 2.75;
/** The root's font size, which the text size the reader has set moves:
 *  read once, as the page has it. Read at each of the panel's renders as
 *  the page opened, it made the browser work out the page's styles there
 *  and then, 45 ms of a phone's (4x, 2026-10-10). Read again after a
 *  resize or a turn of the phone, and when the page comes back to the
 *  front or out of the back-forward cache, which is how a text size set
 *  in iOS's Settings or Safari's aA reaches a page with no resize. */
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
 *  whole page -- 666 elements, 177 to 260 ms of a phone's (4x) in the
 *  first frame of every turn, before the sheet had moved (traced on the
 *  phone project, half to the pill, 2026-10-28). */
let coverDeclaration: CSSStyleDeclaration | null = null;
const coverRule = () => {
  if (!coverDeclaration) {
    const sheet = document.head.appendChild(document.createElement("style")).sheet!;
    sheet.insertRule("[data-map-controls], [data-map-food], .leaflet-bottom {}", 0);
    coverDeclaration = (sheet.cssRules[0] as CSSStyleRule).style;
  }
  return coverDeclaration;
};

/** A card's width from `md` up: 24rem. */
const CARD = 384;


/** How far a drag from the capsule takes to turn it into the sheet: over
 *  it, the way in from the screen's edges, the corners, the glass and the
 *  head follow the finger from the capsule's to the sheet's. */
const MORPH = 96;

/** The pill with a tab bar: the tabs' row and its margins, or a route's
 *  figures in their place at the same height. */
const PILL_REM = 3.625;

const between = (from: number, to: number, t: number) => from + (to - from) * t;

/** The sizes in order, for which way the panel last moved. */
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
 * -- and a grabber on its far edge: drag it, the head, or with a finger
 * anywhere on the body, and it follows the finger and lets go to the
 * detent it was heading for; tap the
 * grabber and it opens or lowers; Escape lowers it. The same from the
 * top of the screen as from the bottom. The screen's width on a phone;
 * from `md` up a card at the left, as Maps' is on an iPad and a Mac. The
 * chart behind it still pans and zooms, and it is never dismissed.
 *
 * Not a stock sheet, which the app's other sheets are (shadcn's Sheet):
 * those are modal Radix dialogs, and one that never closes would hold
 * the keyboard's focus inside itself and hide the map, and any dialog
 * opened before it, from a screen reader.
 */
/** Under the head, the body and the foot a shade darker than the glass
 *  over them: black at 4% on the light sheet, 18% on the dark. The grey of
 *  notes a step darker on it in the light (oklch 0.5, from 0.556): on the
 *  shade it read 4.35:1, under WCAG's 4.5 (the iOS audit's P15 in CI,
 *  f08a6d3c); the blue of tappable words a step darker too (oklch 0.48,
 *  from 0.522): a nav log's "Show the work" on its selected row read
 *  4.33:1 (8465f5a8): --tint-shade, which each look sets (index.css). The
 *  dark's grey as it was, set again here as the light's is set. */
const SHEET_BELOW = "[--muted-foreground:oklch(0.5_0_0)] [--tint:var(--tint-shade)] dark:[--muted-foreground:oklch(0.708_0_0)] print:bg-transparent";

export default function MapPanel({ label, top, kept, controls, compact, children, state: pageState, onStateChange: tellPage, onInsetsChange: tellInsets, toEdge: edgeAsked = false, bar, layer = "tab", cardOver: overAsked = false, foot }: Props) {
  // A size asked for in the panel itself -- its grabber, a key, a finger
  // let go, the tab bar's taps -- shown at once, and the page told once the
  // sheet has landed (below): told at once, the page drew the whole
  // workspace again for the new size before the sheet could move, 140 ms
  // of a phone's (4x) in the key's own task (traced on the phone project,
  // half to the pill, 2026-10-28). What the page sets itself comes as it
  // always did.
  // Kept until the page is at it, through the page's own commits of the
  // sizes asked before it on the way (a tap after a tap): let go at the
  // first, the sheet went back a size for a frame and the grabber's next
  // tap the wrong way. A size the page sets of its own lets it go.
  const [askedHere, setAskedHere] = useState<{ to: PanelState; sent: PanelState[]; seen: PanelState } | null>(null);
  if (askedHere && askedHere.seen !== pageState) {
    setAskedHere(pageState === askedHere.to || !askedHere.sent.includes(pageState) ? null : { ...askedHere, seen: pageState });
  }
  const state = askedHere && (pageState === askedHere.seen) ? askedHere.to : pageState;
  const onStateChange = useCallback((to: PanelState) => {
    setAskedHere(was => ({ to, sent: [...(was?.sent ?? []), to], seen: pageState }));
  }, [pageState]);
  // A tab's options for a tab, a card's for a card: what each layer takes.
  const cardInPill = layer === "card";
  const cardOver = layer !== "console" && overAsked;
  // A card opened over whatever is here (SheetCard: a control's, a thing's
  // tapped on the chart): the body's room its, the head's row, the
  // controls and the foot out of sight under it -- kept, the controls that
  // opened it among them, for when it is put away.
  const raised = useSheetCards(s => raisedFor(s.stack));
  const cardsUp = raised !== null;
  const toEdge = layer !== "console" && edgeAsked && !cardsUp;
  // No half size, at the owner's ask ("let's remove the half card"): the
  // tabs alone, the pill and all the way up.
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
  // At rest a pill floating over the chart, as Maps' is: with a tab bar the
  // tabs, at the owner's ask ("When no route is entered, let's have tabs on
  // the pill"), and a route's figures pinned under them (the foot, "If a
  // route is entered, then let's pin the calculations at the bottom"); a
  // card over the tab its name, Back and the close, the bar minimized.
  // With no bar the capsule's own content (`compact`). The tab bar is the
  // sheet's first row half way and all the way up as well, on a phone held
  // upright as on its side; over a card alone too, as iOS keeps its tab
  // bar on every screen; gone with the keyboard up, as iOS's is.
  const hasPill = !!bar || !!compact;

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
  // The foot's height, measured as the head's is, added to every detent.
  const [footNode, setFootNode] = useState<HTMLDivElement | null>(null);
  const [footMeasured, setFootMeasured] = useState(0);
  const setFoot = useCallback((node: HTMLDivElement | null) => {
    setFootNode(node);
    if (node) setFootMeasured(node.offsetHeight);
  }, []);
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
  const [dragged, setDraggedNow] = useState<number | null>(null);
  // Where a finger last had it, for how far a release has still to go.
  const [lastDragged, setLastDragged] = useState<number | null>(null);
  const setDragged = useCallback((height: number | null) => {
    setDraggedNow(height);
    if (height !== null) setLastDragged(height);
  }, []);
  // A pill of tabs, before one has been measured (a page opened all the
  // way up): its row and the tabs' over it (3.5rem), the height a tap
  // down eases to before it turns into the pill.
  const [capsuleHeight, setCapsuleHeight] = useState(41 + CAPSULE_PAD + 12);
  // At rest with a capsule to show, it floats clear of the screen's
  // edges as Maps' does: in from the sides, above the home indicator
  // (into its inset a little, as Maps sits) or under the status bar.
  // Brought down to it by a tap, the sheet keeps what it shows as its
  // height eases down, to the pill's own height (one row, 3.625rem: the
  // tabs, or a route's figures in their place), and turns into the pill
  // once there (`settling`, until the ease ends): turned at once, what it
  // showed was gone before it moved (the owner's "removes content before
  // sliding down to pill from half"). It eased to a height of its own
  // before -- the half layout's idea of the pill -- and stopped there, then
  // eased again (the other session's "stays a second" measures); the pill's
  // height is known now. Not after a finger: the last of the way down is
  // laid out as the pill already (pillShape).
  const [settling, setSettling] = useState(false);
  const [stateWas, setStateWas] = useState(state);
  const [wasDragging, setWasDragging] = useState(false);
  // Turning between the pill and the sheet, or let go by a finger, until
  // the height has eased where it was going (fromFoot).
  const [turning, setTurning] = useState(false);
  // Whether a finger had the sheet down in the last of the way to the
  // pill (MORPH), where it is laid out as the pill already. Let go above
  // that -- thrown down from half -- it settles as a tap does, keeping what
  // it shows as it eases down: it turned into the pill at the release,
  // its content gone while the sheet was still half way up (the owner,
  // 2026-10-27: "it's removing all content instead of sliding it down
  // with the sheet").
  const [dragLow, setDragLow] = useState(false);
  const low = dragged !== null && dragged - capsuleHeight < MORPH;
  if (dragged !== null && low !== dragLow) setDragLow(low);
  if (state !== stateWas) {
    setStateWas(state);
    setSettling(stateWas !== "peek" && state === "peek" && dragged === null && (!wasDragging || !dragLow) && hasPill);
    if (stateWas === "peek" || state === "peek") setTurning(true);
  }
  if (wasDragging !== (dragged !== null)) {
    setWasDragging(dragged !== null);
    if (dragged === null) {
      setTurning(true);
      // Gone to the pill under the finger before it let go, high.
      if (state === "peek" && stateWas === "peek" && !dragLow && hasPill) setSettling(true);
    }
  }
  const capsule = hasPill && state === "peek" && dragged === null && !settling;
  // Observed afresh as the panel changes size or the tab its head or the pill its own, the
  // observer's first answer the height then: WebKit's observer let the
  // tabs alone's growth into the pill go unreported, and the pill kept the
  // tabs' 58 points, its row below the screen's edge until something else
  // re-measured it (measured in the Playwright image's WebKit, 2026-10-13).
  useEffect(() => {
    if (!head) return;
    const observer = new ResizeObserver(() => setHeadHeight(head.offsetHeight));
    observer.observe(head);
    return () => observer.disconnect();
  }, [head, state, top, capsule]);
  // And the figures' own height in it, what it holds past what gives way
  // there (FPL's side view, data-pill-hides) -- the same in the pill, where
  // that is put away, as out of it: the least the foot keeps (fromFoot).
  // Kept on the node, not in state, and read again as the figures change
  // size: held at the full sheet's row as they shrank on the way down to
  // half, the foot let go of the ten points over it only once at rest, the
  // figures dropping them in one frame (sampled on the phone project under
  // a finger: DIST at 783 through the settle, then 793), the snap the owner
  // saw from full to half (2026-10-28).
  const footRow = useRef(0);
  const footHeld = useRef(false);
  const holdFoot = useCallback((node: HTMLElement) => {
    // The figures and the foot's own border and padding (pt-1, pb-2.5).
    node.style.minHeight = footHeld.current && footRow.current > 0 ? `calc(${footRow.current}px + 1px + 0.875rem)` : "";
  }, []);
  useEffect(() => {
    if (!footNode) return;
    const observer = new ResizeObserver(() => {
      // Its height counted once at rest: following the figures through a
      // settle, it drew the panel again at every frame.
      if (!footHeld.current) setFootMeasured(footNode.offsetHeight);
      // Each part's own height, not its box's: squeezed in a short sheet,
      // the box measured less, and the foot's least with it, a dry run's
      // figures put under the sheet's foot as it came down. What gives way
      // keeps its padding (the dry run's eight under its chart).
      let row = 0;
      for (const part of footNode.firstElementChild?.children ?? []) {
        if (!part.matches("[data-pill-hides]")) row += part.scrollHeight;
        else if (getComputedStyle(part).display !== "none") {
          const style = getComputedStyle(part);
          row += parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        }
      }
      footRow.current = row;
      holdFoot(footNode);
    });
    observer.observe(footNode);
    // The figures themselves, which change size inside a foot held at its
    // least.
    for (const part of footNode.firstElementChild?.children ?? []) observer.observe(part);
    return () => observer.disconnect();
  }, [footNode, state, capsule, holdFoot]);
  // The figures pinned at the sheet's foot, out of the pill: its one row
  // says the route's (the capsule's own).
  const footShown = !!foot && (!capsule || !!bar) && !cardsUp;
  const footHeight = footShown ? footMeasured : 0;
  // The bar shown: the sheet's first row out of the pill, over its head or
  // the console's layer with no head of its own.
  const barShown = !!bar && !(onPhone && keyboard);
  // The card up draws its own head over a picture (lib/openCards), and
  // the tabs asked for over it (TabBar): for `ownHead`, below.
  const pictureCard = useOpenCards(s => s.picture);
  const tabsShown = useTabsShown(s => s.shown);
  // A card from another tab over this one, on a phone held upright: the
  // tab bar minimized to the card's kind, Back at its left, as iOS's
  // navigation bar is; else the tabs, at the owner's ask. Wider, a card
  // with room for every tab keeps them, as iPadOS's does.
  // A card from a control or the chart over it too (SheetCard): its name
  // and close take the tabs' place on top, as the expanded theme's are
  // (the owner, 2026-10-27: "Shouldn't the title replace the tabs?"), the
  // tabs back as it is put away.
  const minimized = cardOver || (onPhone && cardsUp);
  const barNamed = !!bar && barShown && minimized && cardsUp;
  useEffect(() => {
    useSheetCards.setState({ barNamed });
    return () => useSheetCards.setState({ barNamed: false });
  }, [barNamed]);
  // A pill of tabs, or of a route's figures (one button the pill's whole
  // height), rests the whole safe area up, clear of the home indicator (the
  // HIG's Layout; the iOS audit's P12 caught the figures 6 points into it);
  // a capsule of its own content ends at its padding and can sit six lower.
  const capsuleGap = fromBottom ? Math.max(12, Math.round(safe.bottom) - (bar ? 0 : 6)) : Math.round(safe.top) + SHEET_MARGIN;
  // The capsule is its head alone, the grabber over its padding.
  const peek = (capsule ? headHeight : Math.round(headHeight + (fromBottom ? edgeInset : GRABBER))) + footHeight;
  // The capsule's height, kept while it rests, for the lowest detent once
  // it is the sheet: dragged, the sheet's head is measured where the
  // capsule's was, and the lowest detent came out as tall as the half
  // that ends at the head -- so a drag let go at the separator went back
  // down to the capsule, the two being one height and the lowest first.
  if (capsule && capsuleHeight !== headHeight + footHeight) setCapsuleHeight(headHeight + footHeight);
  // One half height for every tab, FPL's with a route too, at the owner's
  // asks ("Keep the half card consistent in size for all tabs including
  // fpl"; "Make the half card a bit taller so email in setup fits at the
  // bottom"): in rem, so it grows with the text as what it holds does.
  // What the half sheet has past its head and body: on a phone's sheet
  // from the bottom the way on to the screen's edge, less the gap it
  // floats above that edge by (with it, the nav log's first heading
  // showed a line under the tabs); from the top, the grabber at its foot.
  const halfChrome = fromBottom ? Math.max(0, edgeInset - HALF_INSET) : GRABBER;
  // The heights it is measured at: the pill, all the way up, and the half
  // sheet it took the place of -- not a height it rests at any more, but
  // what its glass and corners still change by between the two.
  const detents = useMemo<Record<"peek" | "half" | "full", number>>(() => {
    const full = Math.max(peek, room);
    // Settling down to the pill, the pill's own height as it was last
    // measured, whatever the sheet's head measures on the way.
    // With a tab bar the pill is one known height, its row's, at rest as
    // on the way to it: measured as it turned, the foot was still the half's
    // (the side view in it) for a frame, and the pill rose to 140 and back.
    // Settling down to it, as far as the pill's top: in from the screen's
    // edge by SHEET_INSET where the pill floats its gap over it, the sheet
    // stops that much taller and turns into the pill with its height and
    // its gap easing together, its top still. It came down to the pill's
    // height and rose by the difference after: 26 points over an iPhone's
    // home indicator, a route's figures clipped at the top the last of the
    // way down (the safe area emulated as the iOS audit does, 2026-10-15).
    const pillPx = Math.round(PILL_REM * rootPx());
    // Now that the settling sheet takes the pill's gap as it eases (its
    // shape, below), it stops at the pill's own height: stopped the gap
    // taller, it eased down 12 points more once it had turned, the
    // readjust at the end the owner saw ("at the end readjusts for a
    // second to small detent"; sampled: 70 at the landing, 58 after).
    const lowest = bar && (capsule || settling) ? pillPx
      : settling ? capsuleHeight : hasPill && !capsule ? Math.min(capsuleHeight, peek) : peek;
    // Never taller than its rem, whatever a tab holds (the owner's "this
    // tall only"): what does not fit gives way in it.
    const asked = Math.max(lowest, Math.min(Math.round(HALF_REM * rootPx()) + halfChrome, Math.round(full * HALF_MOST)));
    const body = asked - headHeight - halfChrome - footHeight;
    const half = body > 0 && body < HALF_BODY_LEAST_REM * rootPx() ? Math.max(lowest, asked - body) : asked;
    return { peek: lowest, half: Math.min(half, full), full };
  }, [peek, room, halfChrome, hasPill, capsule, capsuleHeight, settling, bar, headHeight, footHeight]);
  // The body's height at half, for what it shows first to fill and no
  // more (--half-body): the search's Favorites, an airport's name and
  // actions.
  const halfBody = Math.max(0, detents.half - headHeight - halfChrome - footHeight);
  // And all the way up (--full-body): what a list sized to the sheet fits
  // in it there, FPL's Routes' four cards.
  const fullBody = Math.max(0, detents.full - headHeight - halfChrome - footHeight);
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

  // A phone's sheet from the bottom moved by the compositor
  // (useSheetMotion), the page's style keeping its box only elsewhere: a
  // card from `md` up, a sheet from the top, and with the keyboard up.
  const slides = onPhone && fromBottom && !keyboard && measured;
  // A drag on the grabber or the head follows the finger, and lets go to
  // the detent it was heading for (useDetentDrag).
  const shown = dragged ?? detents[state];
  // How long it takes to get where it is going: the pill to half's time
  // over its distance, the speed the owner likes, kept for a longer move
  // ("to/from full card snaps very quickly", every move having taken the
  // same 0.45 s) -- from where it was, or let go, from where the finger
  // left it.
  const target = detents[state];
  const draggingNow = dragged !== null;
  // Whether it is on its way there (`moving`), on a phone moved by the
  // compositor until it has landed (useSheetMotion).
  const [settleOf, setSettleOf] = useState({ target, dragging: draggingNow, seconds: SHEET_SECONDS, moving: false });
  if (settleOf.target !== target || settleOf.dragging !== draggingNow) {
    const from = settleOf.dragging && !draggingNow ? lastDragged ?? settleOf.target : settleOf.target;
    const seconds = Math.min(SETTLE_MOST, Math.max(SETTLE_LEAST, (SHEET_SECONDS * Math.abs(target - from)) / SETTLE_POINTS));
    setSettleOf({ target, dragging: draggingNow, seconds: draggingNow ? settleOf.seconds : Math.round(seconds * 100) / 100, moving: !draggingNow && slides });
  }
  const settle = useMemo(() => sheetSettle(settleOf.seconds), [settleOf.seconds]);
  // A phone's panel takes Maps' three shapes: the capsule at rest; in
  // from the edges, every corner round, up to half way and while dragged
  // there; and nearer the top on the screen's edges, as Maps' is all the
  // way up -- its far corners as round as the half sheet's, the glass
  // nearly whole.
  const nearFull = shown >= (detents.half + detents.full) / 2;
  // 0 at half and below, 1 all the way up, between as a finger takes it:
  // what grows with the sheet past half (FlightLine's figures).
  const progress = Math.min(1, Math.max(0, (shown - detents.half) / Math.max(1, detents.full - detents.half)));
  // Taking the capsule's place, width and corners as it eases down to it
  // (`settling`), its content still shown: one move into the pill, as
  // Maps' is, where it slid down as the sheet and turned into the pill
  // once there (the owner, 2026-10-27: "the sheet goes all the way bottom
  // and then becomes a floating tabs").
  const shape: "capsule" | "inset" | "edge" = capsule || settling ? "capsule" : nearFull ? "edge" : "inset";
  const edgeRadius = fromBottom ? `${SHEET_INSET_RADIUS}px ${SHEET_INSET_RADIUS}px 0 0` : `0 0 ${SHEET_INSET_RADIUS}px ${SHEET_INSET_RADIUS}px`;
  const pillCorner = Math.min(PILL_RADIUS, (headHeight + footHeight) / 2);
  const geometry = {
    // As wide as the sheet in from the edges, at the owner's ask ("let's
    // make the width of minimal to half card layout").
    capsule: { side: SHEET_INSET, gap: capsuleGap, radius: `${pillCorner}px`, far: pillCorner, near: pillCorner },
    // Half way as all the way up: on the screen's sides and its edge, the
    // far corners round, at the owner's ask (2026-10-25, "the extra space
    // on the sides": the route box's buttons fit on the airplane's line).
    // It floated in from them by SHEET_INSET, as iOS 26's Maps does.
    inset: { side: HALF_INSET, gap: HALF_INSET, radius: HALF_INSET > 0 ? `${SHEET_INSET_RADIUS}px` : edgeRadius, far: SHEET_INSET_RADIUS, near: HALF_INSET > 0 ? SHEET_INSET_RADIUS : 0 },
    edge: { side: 0, gap: 0, radius: edgeRadius, far: SHEET_INSET_RADIUS, near: 0 },
  }[shape];
  // A drag from the capsule turns it into the sheet as the finger goes
  // (MORPH), as Maps' does: it jumped to the sheet's shape and head at a
  // touch, the head too tall for the height the finger had it at, and its
  // glass gave way to an opaque fill for as long as the finger was down.
  // And back: a sheet dragged down to the capsule's height turns into it
  // on the way, rather than at the release.
  const morphing = hasPill && dragged !== null;
  const morph = capsule ? 0 : morphing ? Math.min(1, Math.max(0, (dragged - capsuleHeight) / MORPH)) : 1;
  // Laid out as the pill: at rest there, and on a finger's way down into it
  // from half, over the last of the way (MORPH), so the pill is what comes
  // to rest under the finger -- it was the half's layout until let go, and
  // then the pill's in one frame, its tabs ten points up and its figures a
  // hundred (measured by the other session). On the way up from the pill
  // the sheet's layout comes at once, where it is still below the screen.
  const pillShape = capsule || (!!bar && dragged !== null && state !== "peek" && morph < 1);
  // The pill with a route: its figures in the tabs' place, at the tabs'
  // height (3.625rem: their row and its margins).
  const figuresPill = pillShape && !!bar && footShown;
  // Laid out as the pill -- its grabber, its row of tabs or figures, where
  // the pill has them -- from the start of a settle down to it, not only
  // once there, what it shows still in sight: laid out as the half sheet
  // to the last frame, the figures jumped 6 points up and 4 across as the
  // pill's layout came in (sampled on the phone project: DIST at 793, 108.5
  // the frame before, 786.7, 112.3 after), the "snap at the end" the owner
  // felt (2026-10-27).
  const pillLaid = pillShape || settling;
  // An airport's or an airplane's card draws its own head over its
  // picture out of the pill, its share and its close on it (PhotoHead), at
  // the owner's pick of the cards' redesign (A2, 2026-10-29): the
  // minimized bar left out over it there, and the grabber laid over the
  // picture's top, as Maps lays its own over a place's photos. In the pill
  // the bar as ever, and with the tabs asked for there, the tabs.
  const ownHead = pictureCard && layer === "card" && !cardsUp && !pillLaid && !tabsShown;
  const barHere = barShown && !ownHead;
  // And in the pill, the card's name, its line and its buttons over its
  // head's picture, blurred (PillPicture), at the owner's pick (P5,
  // 2026-10-29): only the cards with a picture head, only at rest there.
  const pill = useOpenCards(s => s.pill);
  const pillPictured = !!pill && pictureCard && capsule && minimized && barHere && !figuresPill && !tabsShown;
  // The head's row: in the pill only without a tab bar (whose pill is the
  // bar), out of it wherever there is a top row or no bar shown.
  const headerShown = pillShape ? !bar : top != null || !barShown;
  const headContent = capsule ? compact : top;
  // The kept row is the one in sight now.
  const keptHere = kept != null && headerShown && headContent === kept;
  // With a route's figures at its foot, the sheet is laid out from the foot
  // up, the head giving way at the top where there is not room for both
  // and the figures never less than their row (footRow), as the owner
  // asked them pinned at the bottom ("While dragging fpl keep the
  // calculations pinned at the bottom"). Laid out from the top, the pill's
  // figures went out of sight under the sheet's foot the moment it turned,
  // the tabs in their place, and came back only past 213 points of a
  // 298-point sheet -- coming down, the same the other way (the other
  // session's frames, 2026-10-15). The grabber stays on the sheet's edge.
  // On the way only, under a finger or easing: at rest the head keeps the
  // top, as anything it shows in place -- a route's problem under its
  // box -- grows it down, not up out of sight.
  const fromFoot = onPhone && fromBottom && !!bar && footShown && !pillShape && (turning || settling || dragged !== null);
  useLayoutEffect(() => {
    footHeld.current = fromFoot;
    if (!footNode) return;
    holdFoot(footNode);
    if (fromFoot) return;
    // Its height at rest, which the observer let pass while it was held.
    const frame = requestAnimationFrame(() => setFootMeasured(footNode.offsetHeight));
    return () => cancelAnimationFrame(frame);
  }, [fromFoot, footNode, holdFoot]);
  if (morphing && morph < 1 && shape === "inset") {
    // From the pill's shape, in from the sides and every corner round, to
    // the sheet's on the sides and edge, its near corners square.
    const pillRadius = Math.min(PILL_RADIUS, capsuleHeight / 2);
    const far = between(pillRadius, SHEET_INSET_RADIUS, morph), near = between(pillRadius, HALF_INSET > 0 ? SHEET_INSET_RADIUS : 0, morph);
    geometry.side = between(SHEET_INSET, HALF_INSET, morph);
    geometry.gap = between(capsuleGap, HALF_INSET, morph);
    geometry.radius = fromBottom ? `${far}px ${far}px ${near}px ${near}px` : `${near}px ${near}px ${far}px ${far}px`;
    geometry.far = far;
    geometry.near = near;
  }
  // The way on from the body to the screen's edge, under the home
  // indicator: kept clear below the body, or the body's own (toEdge).
  const edgeRoom = Math.max(0, edgeInset - geometry.gap);
  // The glass the whole way, its fill following the height: the capsule's,
  // the half sheet's, nearly whole all the way up (GLASS_FILL).
  const fill = morph < 1 ? between(GLASS_FILL.capsule, GLASS_FILL.half, morph)
    : between(GLASS_FILL.half, GLASS_FILL.full, Math.min(1, Math.max(0, (shown - detents.half) / Math.max(1, detents.full - detents.half))));
  // While it turns, the capsule's own content fades out over the sheet's
  // head as that fades in -- unless the two are one (the search bar).
  const crossFade = morphing && morph < 1 && !bar && compact !== top;
  // Where a drag can come to rest: the pill, half and all the way up.
  const { startDrag: drag, swallow, body: dragBody } = useDetentDrag({
    detents, shown, fromBottom, onRelease: onStateChange, setDragged,
    // Down to the capsule's own height, which is less than the sheet's
    // lowest detent: its head alone, no controls.
    floor: hasPill ? capsuleHeight : undefined,
  });
  // The body, for the motion to cut it off over the figures, and for the
  // drag to hear a finger on it.
  const [bodyNode, setBodyNode] = useState<HTMLDivElement | null>(null);
  const setBodyRef = useCallback((node: HTMLDivElement | null) => {
    dragBody(node);
    setBodyNode(node);
  }, [dragBody]);
  // Under a finger, or easing down to the pill: the body is drawn as all
  // the way up while it is. On a phone for the whole of a move, which the
  // page hears of only once it is over: what the workspace shows only out
  // of the pill (FPL's strips) is in it from the start of the way up.
  const isDragged = dragged !== null || settling || settleOf.moving;
  useEffect(() => {
    usePanelDragging.setState({ dragging: isDragged });
  }, [isDragged]);
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
  // Half way and all the way up, what counts is the half sheet.
  // Down at the pill, its strip at rest from the turn on, not the room
  // the sheet takes on its way down: the map, sent to the middle of what
  // the sheet left on the way (174 points, then 160), was slid on again
  // once it landed (70), the map settling a second after the tabs had
  // (the owner, 2026-10-27: "After the tabs pill, map takes a while to
  // settle down").
  const pillRest = bar ? Math.round(PILL_REM * rootPx()) : capsuleHeight;
  const coveredOnPhone = expanded ? detents.half + HALF_INSET : hasPill ? pillRest + capsuleGap : peek;
  const out = expanded;
  const insetsNow = useMemo<MapInsets>(() => {
    const up = state === "full";
    if (!onPhone && state !== "peek") return { top: 0, bottom: 0, left: 16 + CARD, out: true, up };
    const strip = onPhone ? coveredOnPhone : peek + SHEET_MARGIN;
    return fromBottom ? { top: 0, bottom: strip, left: 0, out, up } : { top: strip, bottom: 0, left: 0, out, up };
  }, [peek, onPhone, out, state, fromBottom, coveredOnPhone]);
  // The panel, its head's band (below) and the body, as the page has them.
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [headBand, setHeadBand] = useState<HTMLDivElement | null>(null);
  const pageBox: CSSProperties = slides ? {} : {
    height: shown,
    ...(onPhone ? {
      left: geometry.side, right: geometry.side,
      ...(fromBottom ? { bottom: keyboard && !capsule ? keyboard + geometry.gap : geometry.gap } : { top: geometry.gap }),
      borderRadius: geometry.radius,
    } : capsule ? { borderRadius: Math.min(PILL_RADIUS, (headHeight + footHeight) / 2) } : {}),
  };
  const spacerShown = !toEdge && (edgeRoom > 0 || (fromBottom && onPhone && !!bar && footShown));
  const landed = useCallback(() => {
    setSettling(false);
    setTurning(false);
    setSettleOf(was => (was.moving ? { ...was, moving: false } : was));
  }, []);
  const edges = useCallback((edge: SheetSays | null) => {
    if (!panel) return;
    if (edge) sheetEdges.set(panel, edge);
    else sheetEdges.delete(panel);
  }, [panel]);
  const sheetParts = useCallback(() => ({ panel, head: headBand, body: bodyNode, foot: footNode }), [panel, headBand, bodyNode, footNode]);
  useSheetMotion({
    on: slides, parts: sheetParts,
    look: {
      h: shown, gap: geometry.gap, side: geometry.side, far: geometry.far, near: geometry.near,
      foot: geometry.gap + (spacerShown ? (pillLaid ? 0 : edgeRoom) : 0),
    },
    dragging: dragged !== null,
    // Under a finger laid out at half, and all the way up once past it.
    dragRoom: h => (h > detents.half + 1 ? detents.full : detents.half),
    sheetSide: HALF_INSET, seconds: settleOf.seconds, pinned: fromFoot, landed, edges,
    pageKeys: Object.keys(pageBox), waiting: settleOf.moving || settling || turning, insets: insetsNow,
  });
  // The room it leaves the map told in a transition as a phone's sheet sets
  // off, for the map's own moves at a turn (a point kept clear of the
  // panel, Nearest's fit), which go in the sheet's time from its start;
  // MapShell's turn has started already, on the sheet's event. Elsewhere
  // (a card from `md` up, the page opening) told at once, as before: the
  // map is placed for the room before it is first drawn.
  const moving = slides && settleOf.moving;
  useEffect(() => {
    if (moving) startTransition(() => tellInsets(insetsNow));
    else tellInsets(insetsNow);
  }, [moving, insetsNow, tellInsets]);
  // The size once the sheet is at rest, and never in a transition: the
  // page's own setter puts all the way up in the address at once
  // (flushSync), and with its size still to come in the transition it read
  // all the way up out of the address as the pill, and the sheet went from
  // all the way up to the pill and on to half for a frame (tab-bar.spec's
  // grabber, route-fit.spec's map sliding with it).
  const asking = askedHere && askedHere.to !== pageState ? askedHere.to : null;
  useEffect(() => {
    if (asking && !moving) tellPage(asking);
  }, [asking, moving, tellPage]);
  // The tabs' row moves between its two places as the sheet does, not at
  // the turn: in the pill at its own margin (mt-1.5) from the top, in the
  // sheet under the grabber -- ten points apart, where it jumped as the
  // pill turned into the sheet, at the tap or a finger's first move, and
  // back once the sheet had come down (the other session's frames,
  // 2026-10-15). Laid out where it is now, it is moved by a transform from
  // where it was to where it comes to rest, in the sheet's own time; under
  // a finger it follows the turn (morph).
  const barRow = useRef<HTMLDivElement>(null);
  const barMove = useRef<Animation | null>(null);
  const barWas = useRef<{ laid: number; rests: number } | null>(null);
  const pillBarTop = 0.375 * rootPx();
  // Where the row is laid out, which is the pill's from the start of a
  // settle down to it (pillLaid): taken as the sheet's, the row was moved
  // ten points too high all the way down and dropped back as the pill
  // came in (sampled on the phone project with no route: tabs at 768.8
  // the frame before, 780 after; the owner's video, 2026-10-27).
  const barLaid = pillLaid ? pillBarTop : GRABBER;
  const barRests = capsule || settling ? pillBarTop : GRABBER;
  const barUnder = hasPill ? between(pillBarTop, GRABBER, morph) : barLaid;
  useLayoutEffect(() => {
    const row = barRow.current;
    if (!row) return;
    const was = barWas.current;
    const put = (offset: number) => { row.style.transform = Math.abs(offset) < 0.5 ? "" : `translateY(${offset}px)`; };
    const stop = () => { barMove.current?.cancel(); barMove.current = null; };
    // Its own row only: put away in the figures' pill, or with the keyboard.
    if (!fromBottom || !onPhone || figuresPill || !barHere) {
      barWas.current = null;
      stop();
      put(0);
      return;
    }
    if (dragged !== null) {
      stop();
      put(barUnder - barLaid);
      barWas.current = { laid: barLaid, rests: barUnder };
      return;
    }
    barWas.current = { laid: barLaid, rests: barRests };
    if (was && was.laid === barLaid && was.rests === barRests) return;
    stop();
    put(0);
    const from = (was?.rests ?? barLaid) - barLaid, to = barRests - barLaid;
    if (Math.abs(from - to) < 0.5) {
      put(to);
      return;
    }
    barMove.current = row.animate(
      [{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }],
      { duration: settleOf.seconds * 1000, easing: "cubic-bezier(0, 0, 0.58, 1)", fill: "forwards" },
    );
  }, [barLaid, barRests, barUnder, dragged, fromBottom, onPhone, figuresPill, barHere, settleOf.seconds]);

  // The figures carried from where they were to where the pill lays them,
  // in the sheet's time, where the foot's change of layout put them there
  // in one frame: 2.5 points up as the sheet turned from half to the pill,
  // before it had moved (sampled on the phone project, DIST at 793 then
  // 790.5), the snap the owner saw in "the calculations" (video,
  // 2026-10-28). Where they sit above the foot's own edge -- the foot is on
  // the sheet's -- read as they settle (a ResizeObserver, no layout forced
  // in a commit), and again once, at the turn.
  const footAbove = useRef<number | null>(null);
  useEffect(() => {
    const content = footNode?.firstElementChild;
    if (!footNode || !content) return;
    const read = () => { footAbove.current = footNode.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom; };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(footNode);
    watch.observe(content);
    return () => watch.disconnect();
  }, [footNode]);
  const footLaid = useRef(pillLaid);
  useLayoutEffect(() => {
    if (footLaid.current === pillLaid) return;
    footLaid.current = pillLaid;
    const content = footNode?.firstElementChild as HTMLElement | null;
    const was = footAbove.current;
    if (!footNode || !content || was == null) return;
    const now = footNode.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom;
    footAbove.current = now;
    const by = now - was;
    if (dragged !== null || prefersReducedMotion() || Math.abs(by) < 0.5 || Math.abs(by) > 24) return;
    content.animate(
      [{ transform: `translateY(${by}px)` }, { transform: "none" }],
      { duration: settleOf.seconds * 1000, easing: "cubic-bezier(0, 0, 0.58, 1)" },
    );
  }, [pillLaid, footNode, dragged, settleOf.seconds]);


  // Escape lowers it, pressed anywhere in it -- but not in a menu or a
  // list it opened, which is a portal outside it and closes first.

  // What the sheet covers of the map, for the map's buttons to ride on its
  // top (--sheet-cover, MapControls), as Maps' do: worked out from the
  // sheet's own height and how far its foot is off the screen's edge, the
  // very values its own style takes, and eased with its own curve when it
  // settles (--sheet-cover-ease), so the two move as one by construction.
  // Measured from the page, a frame behind, they lagged a fast sheet by up
  // to 40 points; moved once it had stopped, they were out of step with the
  // card altogether (the owner's video, 2026-10-26). `beyond` is how far the
  // map runs past the fixed sheet's ground, taken at rest: on the owner's
  // iPhone Safari's toolbar made it other than nothing.
  const beyond = useRef(0);
  const geometryGap = useRef(0);
  useEffect(() => {
    if (!panel || !onPhone || !fromBottom) return;
    const map = document.getElementById("content");
    if (!map) return;
    const take = () => {
      if (usePanelDragging.getState().dragging || panel.style.transform) return;
      beyond.current = Math.round(map.getBoundingClientRect().bottom - (panel.getBoundingClientRect().bottom + geometryGap.current));
    };
    take();
    const watch = new ResizeObserver(take);
    watch.observe(map);
    return () => watch.disconnect();
  }, [panel, onPhone, fromBottom]);
  const gapNow = geometry.gap;
  const easeNow = dragged === null && measured ? settle.curve : "0s";
  useLayoutEffect(() => {
    geometryGap.current = gapNow;
    const cover = !onPhone || !fromBottom || keyboard ? 0 : Math.max(0, Math.round(beyond.current + gapNow + shown));
    const rule = coverRule();
    rule.setProperty("--sheet-cover", `${cover}px`);
    rule.setProperty("--sheet-cover-ease", easeNow);
  }, [onPhone, fromBottom, keyboard, gapNow, shown, easeNow]);
  useEffect(() => () => { coverRule().removeProperty("--sheet-cover"); coverRule().removeProperty("--sheet-cover-ease"); }, []);
  // Scrolled up, a page's content runs on under the head and is seen
  // through it, at the owner's ask with a sheet of iOS's ("look at this for
  // the see-through under the top bar"): the scroller at the top of the
  // body reaches up under the head by its height (--head-room, the
  // under-head utility), so it starts where it did; and while there is
  // content under the head, the head is frosted over it, a line under it
  // (data-under) -- at rest, nothing scrolled, it is the sheet's own glass.
  const under = !pillShape;
  // The sizes the body's content is laid out to (--half-body and the
  // rest), held while the sheet moves on a phone and set once it is at
  // rest: an inherited property, each change restyled all the body holds,
  // and its head two points taller as the tabs went to the pill's row laid
  // the nav log out again in the middle of the turn (traced on the phone
  // project, 55 ms at 4x).
  const bodySizes = { half: halfBody, full: fullBody, foot: toEdge && fromBottom ? halfChrome : 0, head: under ? headHeight : 0 };
  const [heldSizes, setHeldSizes] = useState(bodySizes);
  const holdSizes = slides && (settleOf.moving || dragged !== null || turning || settling);
  if (!holdSizes && (Object.keys(bodySizes) as (keyof typeof bodySizes)[]).some(k => bodySizes[k] !== heldSizes[k])) setHeldSizes(bodySizes);
  const sizes = holdSizes ? heldSizes : bodySizes;
  useEffect(() => {
    if (!headBand || !panel || !under) return;
    // "local" where a card's own head (its title, its tabs) is under the
    // panel's and is frosted with it, the line under that one alone.
    const frost = (scroller: Element | undefined) => {
      if (scroller && scroller.scrollTop > 0) headBand.setAttribute("data-under", scroller.hasAttribute("data-local-head") ? "local" : "");
      else headBand.removeAttribute("data-under");
    };
    const onScroll = (event: Event) => {
      const at = event.target;
      if (at instanceof HTMLElement && at.classList.contains("under-head") && panel.contains(at)) frost(at);
    };
    // A tab or a card come up: the scroller now in sight, as scrolled as
    // it was left -- after the frame, not in the middle of the commit.
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
  // The pill once the height has eased there; or after a while, should no
  // transition end come (none to run, Reduce Motion).
  useEffect(() => {
    if (!settling || !panel) return;
    const done = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === "height") setSettling(false);
    };
    const late = window.setTimeout(() => setSettling(false), slides ? LANDED_LATE : SETTLE_MOST * 1000 + 100);
    panel.addEventListener("transitionend", done);
    return () => { panel.removeEventListener("transitionend", done); window.clearTimeout(late); };
  }, [settling, panel, slides]);
  // And the turn over the same way.
  useEffect(() => {
    if (!turning || !panel) return;
    const done = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === "height") setTurning(false);
    };
    const late = window.setTimeout(() => setTurning(false), slides ? LANDED_LATE : SETTLE_MOST * 1000 + 100);
    panel.addEventListener("transitionend", done);
    return () => { panel.removeEventListener("transitionend", done); window.clearTimeout(late); };
  }, [turning, panel, slides]);
  useEffect(() => {
    if (!panel || !expanded) return;
    const onKey = (event: KeyboardEvent) => {
      // Not under a card, whose own Escape puts it away (SheetCard) and
      // prevents the default.
      if (event.key === "Escape" && !event.defaultPrevented) onStateChange("peek");
    };
    panel.addEventListener("keydown", onKey);
    return () => panel.removeEventListener("keydown", onKey);
  }, [panel, expanded, onStateChange]);
  // A card opened comes up half way at the least, as a place's card does,
  // all the way for a search; the last put away, the panel goes back to
  // where it was and shows what was under them, as Maps' sheet does.
  // Not where what put the last away moved the panel itself, in the same
  // tap (the approach's Chart, all the way up on the field's card): the
  // size it was at while they were open (`heldAt`) is no longer the one.
  const raisedFrom = useRef<PanelState | null>(null);
  const heldAt = useRef<PanelState | null>(null);
  const sizeNow = useRef({ state, onStateChange });
  useEffect(() => {
    sizeNow.current = { state, onStateChange };
    if (raised) heldAt.current = state;
  });
  useEffect(() => {
    const { state: now, onStateChange: to } = sizeNow.current;
    if (raised) {
      raisedFrom.current ??= now;
      if (RANK[now] < RANK[raised]) to(raised);
    } else if (raisedFrom.current !== null) {
      const back = raisedFrom.current;
      raisedFrom.current = null;
      if (back !== now && now === heldAt.current) to(back);
    }
  }, [raised]);

  // The panel's height on <body> as well, for the stylesheet's rules about
  // what else is over the map (index.css): the map's buttons under a
  // phone's sheet all the way up, and the toasts over a panel out. They
  // asked <body> with :has() before, and a :has() at the top of the page
  // restyled the whole page at every change of an attribute it named --
  // data-state among them, which every stock component sets as it opens
  // or closes: 56 ms a time on a laptop, four times that on a phone, at
  // each tab picked (measured 2026-10-07).
  // Each set on its own: put back and set again together at every turn,
  // the sheet's attribute restyled what it names for nothing.
  useLayoutEffect(() => {
    document.body.dataset.mapPanel = state;
    return () => { delete document.body.dataset.mapPanel; };
  }, [state]);
  useLayoutEffect(() => {
    document.body.toggleAttribute("data-map-sheet", onPhone);
    return () => document.body.removeAttribute("data-map-sheet");
  }, [onPhone]);

  // The panel's three sizes, as a tap asks for them (PanelSize, for the
  // tab bar too).
  const panelSize = useMemo(() => ({ size: state, to: onStateChange, card: cardInPill }), [state, onStateChange, cardInPill]);
  // A tap on the grabber cycles the panel's three heights, small to big
  // and back, at the pilot's ask: from half it goes on the way the panel
  // last moved -- up from the pill, down from all the way up. The arrow
  // keys step it, for a keyboard and VoiceOver.
  const [was, setWas] = useState(state);
  const [rising, setRising] = useState(true);
  if (state !== was) {
    setWas(state);
    setRising(RANK[state] > RANK[was]);
  }
  const cycle = () => onStateChange(state === "peek" || state === "full" ? "half" : rising ? "full" : "peek");
  const arrows = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowUp" && state !== "full") onStateChange(state === "peek" ? "half" : "full");
    else if (event.key === "ArrowDown" && state !== "peek") onStateChange(state === "full" ? "half" : "peek");
    else return;
    event.preventDefault();
  };

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
      onClick={cycle} onKeyDown={arrows}
      // Inside the head (from the bottom) the head follows the drag already.
      onPointerDown={event => { event.stopPropagation(); startDrag(event); }}
      // On the capsule two short of its padding: the route chip's 44-point
      // hit area reaches a point and a half past the chip, into it.
      // Over the tabs' head on a phone, no deeper than the room over the
      // tabs (their mt-1.5), so a tab's 44-point hit area stays its own.
      style={{ height: pillLaid ? CAPSULE_PAD - 2 : GRABBER }}
      className={cn(
        "mx-auto flex w-24 shrink-0 touch-none justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset print:hidden",
        // In the capsule's thin padding, two points from its edge; on the
        // sheet five, as iOS's.
        fromBottom ? (pillLaid ? "items-start pt-[2px]" : "items-start pt-[5px]") : (pillLaid ? "items-end pb-[2px]" : "items-end pb-[5px]"),
        pillLaid && cn("absolute inset-x-0 z-10 after:hidden!", fromBottom ? "top-0" : "bottom-0"),
        (fromFoot || ownHead) && "absolute inset-x-0 top-0 z-10",
        // Its hit area (index.css) wide but no further into the head than
        // four points: the route's box starts four under it. Over the head
        // on the sheet's edge (fromFoot), its own box only: drawn over the
        // tabs there, it took the top of their 44 points (the iOS audit's P1).
        !pillLaid && (fromBottom ? (fromFoot || ownHead ? "after:bottom-0! after:top-0!" : "after:bottom-[-4px]! after:top-0!") : "after:top-[-4px]! after:bottom-0!"),
      )}
    >
      {/* Over a card's picture (ownHead), white with a shade, as Maps'
          is over a place's photos: the grey was lost on a dark one. */}
      <span className={cn("h-[5px] w-9 rounded-full", ownHead || pillPictured ? "bg-white/75 shadow-[0_0_3px_rgba(0,0,0,.5)]" : "bg-muted-foreground/40")} aria-hidden="true" />
    </button>
  );

  return (
    <>
    <section
      ref={setPanel}
      data-slot="map-panel" data-panel={state} {...(onPhone ? { "data-sheet": "" } : {})}
      aria-label={label}
      onClickCapture={swallow}
      data-capsule={capsule || undefined}
      data-shape={onPhone ? shape : undefined}
      style={{
        ...corner,
        ...pageBox,
        // The height follows a finger without lag, and the capsule's turn
        // into the sheet with it; the shape eases in and out as a drag
        // crosses half way up, to the screen's edges and back. On a phone
        // the move is the compositor's (useSheetMotion), its colour and
        // shadow eased here.
        transition: !measured || (morphing && morph < 1) ? "none"
          : slides ? (dragged === null ? `background-color ${settle.curve}, box-shadow ${settle.curve}` : "none")
            : dragged === null ? `${settle.height}, background-color ${settle.curve}, box-shadow ${settle.curve}` : SHEET_RESHAPE,
        // In steps of four: an inherited property, every change of it
        // restyles all the sheet holds, and changed at every frame of a drag
        // above half it cost that drag a frame in three.
        ...(onPhone && dragged !== null ? { "--glass-fill": `${Math.round(fill / 4) * 4}%` } : {}),
      }}
      className={cn(
        // Clipped rather than hidden: a hidden overflow can still be
        // scrolled by a script, and a row brought into view in the body
        // scrolled the whole panel, its head up out of sight.
        "fixed z-40 flex flex-col overflow-clip text-foreground", fromFoot && "justify-end",
        // Liquid Glass at every height, as Maps' is: the chart through it,
        // its rim lit, its own shadow -- the sheet a frostier pane of it,
        // for a nav log read on it, and all the way out nearly whole.
        // The pill's glass from the start of a settle down to it, its colour
        // easing there with the height (below), where the sheet's opaque
        // fill turned to the pill's glass in one frame as it landed (the
        // owner, 2026-10-27: "the color transition is not smooth").
        capsule || (settling && onPhone) ? GLASS
          : !onPhone ? MATERIAL
            : nearFull ? GLASS_SHEET_FULL : GLASS_SHEET,
        !onPhone && cn(
          "left-[max(1rem,env(safe-area-inset-left))] w-[24rem]",
          !capsule && "rounded-[10px] shadow-[0_2px_10px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:shadow-[0_2px_10px_rgba(0,0,0,0.45)] dark:ring-white/10",
          fromBottom ? "bottom-[max(0.5rem,env(safe-area-inset-bottom))]" : "top-[max(0.5rem,env(safe-area-inset-top))]",
        ),
      )}
    >
      {pillPictured && pill && <PillPicture pill={pill} />}
      {/* The head, dragged as the grabber is: the grabber first on a sheet
          from the bottom, the top row, any notice, the controls -- or, at
          rest, the capsule, its grabber on its far edge from the top. */}
      <div
        ref={setHeadBand} data-head-band=""
        // Over the body, which runs on up under it (`under`): frosted with
        // the sheet's own colour while anything is there (index.css). Not
        // raised in the pill, whose grabber lies over its edge.
        className={cn("flex shrink-0 flex-col", under && "z-20")}
      >
      <div
        ref={setHead} className={cn("flex shrink-0 touch-none flex-col", !fromFoot && "relative")} onPointerDown={startDrag}
        // The grabber's room, kept on the sheet's edge over the head (fromFoot).
        style={fromFoot ? { paddingTop: GRABBER } : undefined}
      >
        {fromBottom && grabber}
        <div className="flex flex-col">
        {/* The tab bar as the sheet's first row (barShown), measured with
            the head, so every height still fits it. Not in the pill, which
            is its one row (`compact`) -- kept in the page there, out of
            sight, for what it hears on the whole panel: a swipe across to
            the tab beside, a mouse's wheel up a size (TabBar). */}
        {bar && (
          <div
            ref={barRow}
            className={cn(
              // On a phone the tab up's name alone when a card from another
              // tab is over it (TabBarMinimized), a row as tall as the
              // name's 44-point hit area, in the middle of the band from the
              // sheet's edge to the line under it, the grabber's 16 in it,
              // at the owner's ask ("center the title and the back/close
              // button vertically in that top space"): sixteen under it over
              // the line, as the grabber's are over it, the hit areas, three
              // past the row, kept off a card under it (the iOS audit's P1).
              // 56 in the sheet, the tabs' icons 28 and words 13 with room
              // round them: six of the tab's glass over the icon, five from
              // the word to the line (TabBar, TabGlass); the pill's 48, its
              // height fixed.
              // In the pill the pill's row whatever it holds, a card's name and its
              // buttons too: the minimized bar's sixteen under it, for the line
              // under a sheet's first row, set them high in the pill, the room
              // under them twice that over (the owner's "Not centered in the
              // bottom pill").
              "flex shrink-0 px-2", pillLaid ? "h-12" : minimized ? "min-h-11 pb-4" : "h-14", !barHere && "hidden",
              // In the pill the pill's whole, round its grabber; out of it,
              // under a card's name, the line under the sheet's first row --
              // under the tabs, the tabs' own line of glass (TabGlass).
              pillLaid ? (fromBottom ? "mt-1.5 mb-1" : "mt-1 mb-1.5") : minimized ? "border-b border-border/60" : "",
              figuresPill && "hidden",
              !fromBottom && onPhone && "h-auto pt-[env(safe-area-inset-top)]",
            )}
            // A swipe up or down on the tabs drags the panel as the head
            // does, at the owner's ask ("dragging the card should work by
            // swiping up/down anywhere on the card"). A tap that does not
            // move ten points is the tab's (useDetentDrag).
          >
            <TabBarMinimized.Provider value={minimized}><BarOverPicture.Provider value={pillPictured}><PanelSize.Provider value={panelSize}>{bar}</PanelSize.Provider></BarOverPicture.Provider></TabBarMinimized.Provider>
          </div>
        )}
        {/* Under the tab bar, the route's box and its buttons a shade
            darker too (SHEET_BELOW), for the clear glass to stand off it
            (the owner's "So clear buttons can pop out more"). */}
        <div className={cn("relative flex flex-col", bar && barHere && !pillShape && SHEET_BELOW)}>
        {crossFade && (
          <div aria-hidden="true" inert className="pointer-events-none absolute inset-x-0 top-0 z-10 p-[9px]" style={{ opacity: 1 - morph }}>
            {compact}
          </div>
        )}
        <div className={cn("flex flex-col", cardsUp && !pillShape && "hidden")} style={crossFade ? { opacity: morph } : undefined}>
        {/* One header in both shapes, so what the capsule and the sheet
            both show -- the search bar -- stays the same element as the
            one turns into the other, focus and keyboard and all. From
            the top of a phone's screen the sheet's starts under the
            status bar or the island. */}
        {(headerShown || kept != null) && (
          <header
            className={!headerShown ? "contents" : cn(
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
                : top == null ? (!fromBottom && onPhone && !barShown ? "pt-[env(safe-area-inset-top)]" : undefined)
                  // Four under the grabber from the bottom: the band over the
                  // route's box was 36 points, thick beside Maps' 20.
                  : cn("px-3 pb-1", barShown ? "pt-1" : fromBottom ? "pt-1" : onPhone ? "pt-[max(0.5rem,env(safe-area-inset-top))]" : "pt-2"),
            )}
          >
            {/* The kept row first, in the one place whatever is shown, so
                it is never built again; out of sight out of the row's
                flow, inert, and not laid out (tab-away). */}
            {kept != null && (
              <div className={keptHere ? "contents" : "tab-away pointer-events-none absolute"} inert={!keptHere}>{kept}</div>
            )}
            {headerShown && !keptHere && headContent}
          </header>
        )}
        {!pillShape && controls && (
          // Wrapped onto two lines (a 320-point Slide Over), the two
          // twelve apart, so their hit areas (index.css) meet rather than
          // overlap; and as close under the top row and over what follows
          // as theirs let them, at the owner's ask ("minimize the empty
          // spaces between the route box, the buttons and the profile
          // view"): eight under the route's box (its 44 points reach 1.5
          // past it, the chips' 6), and six over the foot's line.
          <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-3 px-3 pt-1 print:hidden", fromBottom ? "pb-1.5" : "pb-5")}>{controls}</div>
        )}
        </div>
        </div>
        </div>
      </div>
      </div>
      {/* Over a grabber at the bottom, clear of its hit area. */}
      {/* The separator over the body, and its room over a grabber at its
          foot, only past half, at the pilot's ask: at half the tabs' own
          bar is the line under the head. */}
      <div
        // Dragged from anywhere under a finger, as the head is, where its
        // content is not scrolling (useDetentDrag).
        ref={setBodyRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col border-border/60", expanded && shown > detents.half + 1 && cn(!ownHead && "border-t", !fromBottom && "pb-4"),
          // A shade darker than the head over it, at the owner's ask ("Can
          // we try a bit darker color for sheet below the top frosty
          // bar?"), as iOS's grouped lists sit a shade under their bar:
          // the head and its glass buttons stand off what scrolls (SHEET_BELOW).
          !pillShape && SHEET_BELOW,
          // At rest the pill is its one row: the body, squeezed to nothing
          // there, kept but out of sight and of the
          // keyboard's reach -- unclipped, a card open in it (an airplane's,
          // its name, Follow and close) ran over the pill's figures.
          pillShape && "invisible overflow-clip",
        )}
        // The foot as it is at half, whatever the height now: a card laid
        // out to it keeps one layout all the way up.
        style={{ "--half-body": `${sizes.half}px`, "--full-body": `${sizes.full}px`, "--half-foot": `${sizes.foot}px`, "--head-room": `${sizes.head}px`, "--panel-head": `${sizes.head}px` } as CSSProperties}
        data-panel-body=""
      >
        {/* Under a card opened over it, kept as it was (TabKept). */}
        <TabKept away={cardsUp}>{children}</TabKept>
        <SheetCardHost shown={cardsUp} />
      </div>
      {/* The route's figures, pinned at the card's foot at every height
          (`foot`): over the home indicator's room where the body runs to
          the edge (toEdge), which then runs to the figures. */}
      {/* Kept under a card, out of sight, with what it holds open (the
          fuel's breakdown, a card of its own). */}
      {!!foot && (footShown || cardsUp) && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a pointer convenience, not a control: the grabber is the keyboard's way to open the sheet, and the figures' own buttons stay focusable
        <div
          ref={setFoot}
          className={cn(
            // A card's summary has its own sides, the card's 16 (PanelCard),
            // which line it up with Back and the close over it as all the
            // way up: the foot's own 16 too set it in by 32, at the owner's
            // notice ("half card is not aligned with the back and close
            // buttons").
            // Giving way where the half is short of it, after the body: FPL's
            // side view shrinks first (PlanWorkspace), its figures kept whole.
            // The sheet's shade until it is the pill, not from the start of
            // the settle down to it: its colours changed there restyled all
            // the figures and the side view, in the frame the sheet was to
            // start moving in.
            "flex min-h-0 shrink flex-col print:hidden", cardInPill ? "px-0" : "px-4", !pillShape && SHEET_BELOW, !footShown && "hidden",
            // In the pill under the tabs, the figures alone: what the foot
            // keeps for half way and up (FPL's side view, data-pill-hides)
            // put away.
            // Its content centred there, the dry run's too, whose figures
            // sat at the pill's top under the grabber, its column grown.
            pillLaid ? "h-[3.625rem] shrink-0 justify-center [&_[data-pill-hides]]:hidden [&>*]:flex-none" : "border-t border-border/60 pt-1 pb-2.5",
          )}
          style={{
            ...(toEdge && fromBottom && !pillLaid ? { paddingBottom: Math.max(10, edgeRoom) } : {}),
            // How far up it is past half, for what grows with it (FlightLine's
            // figures, the side view folding away) -- set here, on the foot
            // where those are, not on the sheet: an inherited property
            // changed on the sheet restyled the nav log's every row.
            // Held where it was under a finger, and eased on with the sheet
            // once let go: following the finger, the figures' every size
            // laid the foot out again at each frame, a third of a drag's
            // time above half (measured with and without the foot).
            "--sheet-progress": dragged === null ? progress : state === "full" ? 1 : 0,
            transition: settle.progress,
          } as CSSProperties}
          data-testid="panel-foot"
          // In the pill a finger anywhere on it drags the sheet, as the tabs
          // do; a tap on it opens it half way, the tabs over the route.
          // Not a button itself: it holds the figures' own (Time en route,
          // Fuel), and a button inside a button is what axe's
          // nested-interactive fails (the nightly iOS audit, map and a
          // service out). The grabber, "Flight Planning", opens the sheet
          // from the keyboard and for a screen reader.
          onPointerDown={capsule ? startDrag : undefined}
          onClick={capsule ? () => onStateChange("half") : undefined}
        >{foot}</div>
      )}
      {/* The grabber last on a sheet from the top. */}
      {/* At the pill's foot too, under the figures there (`foot`), where
          it was the head's and sat over them. */}
      {!fromBottom && grabber}
      {/* The rest of the way to the screen's edge, under the home
          indicator, below the body -- in the body where it runs to the
          edge (toEdge). */}
      {/* With a route's figures at its foot, there in the pill as well, at
          nothing, so that it grows in the sheet's own time as the sheet
          comes down to the screen's edge, the two keeping the figures where
          they were (fromFoot): put there at once, it would lift them the
          home indicator's height as the pill turned. */}
      {!toEdge && (edgeRoom > 0 || (fromBottom && onPhone && !!bar && footShown)) && (
        <div
          className="shrink-0" aria-hidden="true"
          style={{ height: pillLaid ? 0 : edgeRoom, transition: !slides && dragged === null && measured ? `height ${settle.curve}` : "none" }}
        />
      )}
    </section>
    </>
  );
}

/** What a phone's sheet looks like at a moment, wherever it is laid out:
 *  its height and how far its foot is off the screen's edge (`gap`), how
 *  far in from the sides it is, its far and near corners, and how far the
 *  foot's figures sit off the screen's edge. */
interface Look { h: number; gap: number; side: number; far: number; near: number; foot: number }
const LOOK_KEYS = ["h", "gap", "side", "far", "near", "foot"] as const;
const sameLook = (a: Look, b: Look) => LOOK_KEYS.every(k => Math.abs(a[k] - b[k]) < 0.5);
const lookBetween = (a: Look, b: Look, t: number) =>
  Object.fromEntries(LOOK_KEYS.map(k => [k, between(a[k], b[k], t)])) as unknown as Look;

/** Where what it holds is laid out in it, read once a layout: its width,
 *  the screen's edge, the head's and the body's foot from its top, the
 *  foot's own height and the room under it. */
interface Laid { width: number; edge: number; headFoot: number; bodyFoot: number; footHeight: number; under: number }

/** How much of the sheet's shadow over the map stays in sight above it
 *  while it is cut to its height (clip-path), in px: more than the 12 of
 *  its blur. */
const SHADOW_ROOM = 24;

/** The sheet at `look`, laid out `height` tall on the screen's edge and
 *  `side` in from its sides: moved down and narrowed by transforms, cut
 *  to its height at its foot, the figures held where the look has them,
 *  and -- where the figures are pinned at its foot (`pinned`) -- the head
 *  pushed up out of its top and the body cut off over them, as the sheet
 *  laid out from its foot up had them: the body moved up by what it would
 *  run over them and what it holds moved down as much, the body clipping
 *  it (overflow: clip), so that each is a transform the compositor runs.
 *  The cut at the foot is a clip-path, the browser's own frames: it moves
 *  only the few points of the pill's gap over the screen's edge. */
function paintOf(look: Look, height: number, side: number, laid: Laid, pinned: boolean) {
  const down = height - (look.gap + look.h);
  const wide = (laid.width + 2 * (side - look.side)) / laid.width;
  const footTop = look.foot + laid.footHeight;
  const over = pinned ? Math.max(0, footTop - (height - laid.bodyFoot - down)) : 0;
  return {
    sheet: { transform: `translateY(${down}px) scaleX(${wide})` },
    cut: {
      clipPath: `inset(-${SHADOW_ROOM}px -1px ${height - look.h}px -1px round 0px 0px ${look.near}px ${look.near}px)`,
      borderRadius: `${look.far}px ${look.far}px 0px 0px`,
    },
    foot: { transform: `translateY(${laid.under - down - look.foot}px)` },
    head: { transform: `translateY(${-(pinned ? Math.max(0, footTop - (height - laid.headFoot - down)) : 0)}px)` },
    body: { transform: `translateY(${-over}px)` },
    held: { transform: `translateY(${over}px)` },
  };
}

/** Where between `from` and `to` the head starts to be pushed or the body
 *  cut (each a most of nothing and a straight line): keyframes there as
 *  well as at the two ends make the pieces exact. */
function bends(from: Look, to: Look, height: number, laid: Laid) {
  const at = new Set([0, 1]);
  for (const foot of [laid.headFoot, laid.bodyFoot]) {
    const over = (look: Look) => look.foot + laid.footHeight - (height - foot - (height - (look.gap + look.h)));
    const a = over(from), b = over(to);
    if (a * b < 0) at.add(a / (a - b));
  }
  return [...at].sort((x, y) => x - y);
}

const SHEET_EASE = "cubic-bezier(0, 0, 0.58, 1)";


/** What a phone's sheet says as it sets off for another size, on its
 *  "sheetturn" event: the room it will leave the map (MapShell). */
export interface SheetTurn { insets: MapInsets }

/** How long the panel waits to hear the sheet has landed before taking it
 *  as landed all the same, in ms: well past the longest move. */
const LANDED_LATE = 2000;

/**
 * A phone's sheet moved by the compositor, as Maps' is: laid out once at
 * the larger of where it was and where it is going, and moved, narrowed
 * and cut to its height by transforms and a clip in the sheet's own time
 * (Web Animations), so no frame of the move waits on laying out what it
 * holds. Under a finger the look follows the finger the same way, laid out
 * at half (all the way up once past it). At rest it is laid out as it is.
 * Its height eased (a CSS transition) laid the panel's content out at
 * every frame, and with a route four frames came of 0.3 s at 4x, the
 * first 460 ms after the key (traced on the phone project, 2026-10-28).
 */
function useSheetMotion({ on, parts: partsOf, look, dragging, dragRoom, sheetSide, seconds, pinned, landed, edges, pageKeys, waiting, insets }: {
  on: boolean;
  /** The sheet, its head's band, its body and its foot, as the page has
   *  them now. */
  parts: () => { panel: HTMLElement | null; head: HTMLElement | null; body: HTMLElement | null; foot: HTMLElement | null };
  look: Look;
  dragging: boolean;
  /** The height it is laid out at under a finger at `h`. */
  dragRoom: (h: number) => number;
  /** How far in from the sides it is laid out under a finger. */
  sheetSide: number;
  seconds: number;
  pinned: boolean;
  /** Come to rest where it was going. */
  landed: () => void;
  /** Where to say the sheet's edge is (sheetSlide). */
  edges: (edge: SheetSays | null) => void;
  /** The box's properties the page's own style sets while this is off. */
  pageKeys: readonly string[];
  /** The panel waiting to hear it has landed. */
  waiting: boolean;
  /** The room it leaves the map where it is going, for the map's own
   *  move as it sets off (the turn's event, MapShell). */
  insets: MapInsets;
}) {
  type Part = keyof ReturnType<typeof paintOf>;
  type Move = {
    from: Look; to: Look; height: number; side: number; laid: Laid; pinned: boolean;
    runs: { part: Part; run: Animation }[]; turn: number;
  };
  const move = useRef<Move | null>(null);
  const was = useRef<Look | null>(null);
  const turns = useRef(0);
  // Whether its transforms and clips are on what it moves, to take off at
  // rest -- only then, so a style of the parts' own is left as it is.
  const painted = useRef(false);
  const said = useRef(landed);
  useEffect(() => { said.current = landed; });
  useLayoutEffect(() => {
    const { panel, head, body, foot } = partsOf();
    if (!panel) return;
    const held = body ? [...body.children].filter((el): el is HTMLElement => el instanceof HTMLElement) : [];
    const parts: [HTMLElement, Part][] = ([[panel, "sheet"], [panel, "cut"], [foot, "foot"], [head, "head"], [body, "body"], ...held.map(el => [el, "held"])] as [HTMLElement | null, Part][])
      .filter((part): part is [HTMLElement, Part] => !!part[0]);
    const stop = () => { for (const { run } of move.current?.runs ?? []) run.cancel(); };
    const clear = () => {
      if (!painted.current) return;
      painted.current = false;
      for (const el of [panel, foot, head, body, ...held]) if (el) { el.style.transform = ""; el.style.clipPath = ""; }
      if (body) body.style.overflow = "";
    };
    const BOX = ["height", "bottom", "left", "right", "borderRadius"] as const;
    const box = (values: Record<(typeof BOX)[number], string>) => {
      for (const key of BOX) if (panel.style[key] !== values[key]) panel.style[key] = values[key];
    };
    const rest = (at: Look) => {
      stop();
      move.current = null;
      clear();
      box({ height: `${at.h}px`, bottom: `${at.gap}px`, left: `${at.side}px`, right: `${at.side}px`, borderRadius: `${at.far}px ${at.far}px ${at.near}px ${at.near}px` });
      was.current = at;
    };
    // Laid out on the screen's edge, `height` tall, its far corners round.
    const lay = (height: number, side: number, far: number) => {
      box({ height: `${height}px`, bottom: "0px", left: `${side}px`, right: `${side}px`, borderRadius: `${far}px ${far}px 0px 0px` });
    };
    const measure = (): Laid => {
      const headFoot = head ? head.offsetTop + head.offsetHeight : 0;
      const footShown = !!foot && foot.offsetParent !== null;
      return {
        width: panel.offsetWidth, edge: panel.offsetTop + panel.offsetHeight, headFoot,
        bodyFoot: body ? body.offsetTop + body.offsetHeight : headFoot,
        footHeight: footShown ? foot.offsetHeight : 0,
        under: footShown ? panel.offsetHeight - (foot.offsetTop + foot.offsetHeight) : 0,
      };
    };
    const sameLaid = (a: Laid, b: Laid) => (Object.keys(a) as (keyof Laid)[]).every(k => Math.abs(a[k] - b[k]) < 0.5);
    const lookNow = () => {
      const m = move.current;
      if (!m) return was.current;
      const t = m.runs[0]?.run.effect?.getComputedTiming().progress;
      return lookBetween(m.from, m.to, m.runs.length ? (t ?? 1) : 1);
    };
    const paint = (m: Move, at: Look) => {
      const p = paintOf(at, m.height, m.side, m.laid, m.pinned);
      for (const [el, part] of parts) Object.assign(el.style, p[part]);
      painted.current = true;
    };
    // The body clips what it holds where it is cut off over the figures.
    const clip = (pinnedNow: boolean) => {
      const overflow = pinnedNow ? "clip" : "";
      if (body && body.style.overflow !== overflow) body.style.overflow = overflow;
    };
    const keyframes = (m: Move) => {
      const at = bends(m.from, m.to, m.height, m.laid);
      const paints = at.map(t => paintOf(lookBetween(m.from, m.to, t), m.height, m.side, m.laid, m.pinned));
      return (part: Part) => paints.map((p, i) => ({ offset: at[i], ...p[part] })) as Keyframe[];
    };
    // The sheet's edge for the map, where its look has it now, and the
    // move it is on by itself.
    const edgeOf = (m: Move, at: Look) => m.laid.edge - at.gap - at.h;
    edges({
      edge: () => {
        const at = lookNow();
        if (!at || !on) return panel.getBoundingClientRect().top;
        return move.current ? edgeOf(move.current, at) : panel.offsetTop + panel.offsetHeight - at.h;
      },
      move: () => {
        const m = move.current, run = m?.runs[0]?.run;
        return m && run ? { run, from: edgeOf(m, m.from), to: edgeOf(m, m.to) } : null;
      },
    });
    if (!on) {
      // The page's style has the box again: what it does not set, put away.
      if (move.current || was.current) {
        stop();
        move.current = null;
        clear();
        for (const key of BOX) if (!pageKeys.includes(key)) panel.style[key] = "";
      }
      was.current = null;
      return;
    }
    const now = lookNow();
    const m = move.current;
    if (dragging) {
      // Under a finger: laid out once for where it can go, and the look
      // painted as it comes, frame by frame.
      stop();
      const height = Math.max(m?.height ?? 0, dragRoom(look.h), look.gap + look.h);
      lay(height, sheetSide, look.far);
      clip(pinned);
      move.current = { from: look, to: look, height, side: sheetSide, laid: measure(), pinned, runs: [], turn: ++turns.current };
      paint(move.current, look);
      was.current = look;
      return;
    }
    if (m && m.runs.length && sameLook(m.to, look)) {
      // On its way where it was going: the keyframes again only should
      // what it holds have been laid out afresh since (a commit mid-way).
      const laid = measure();
      if (!sameLaid(laid, m.laid) || m.pinned !== pinned) {
        m.laid = laid;
        m.pinned = pinned;
        clip(pinned);
        const frames = keyframes(m);
        for (const { part, run } of m.runs) (run.effect as KeyframeEffect | null)?.setKeyframes(frames(part));
      }
      return;
    }
    if (!now || sameLook(now, look) || prefersReducedMotion() || seconds <= 0) {
      rest(look);
      if (m || waiting) said.current();
      return;
    }
    // A move: laid out as big as both ends, the look eased from where it
    // is now to where it is going.
    stop();
    const height = Math.max(m?.height ?? 0, now.gap + now.h, look.gap + look.h);
    lay(height, look.side, look.far);
    clip(pinned);
    const next: Move = { from: now, to: look, height, side: look.side, laid: measure(), pinned, runs: [], turn: ++turns.current };
    move.current = next;
    const frames = keyframes(next);
    const timing = { duration: seconds * 1000, easing: SHEET_EASE, fill: "forwards" as const };
    // No cut where nothing of it shows: on the screen's edge with square
    // near corners at both ends (half way and all the way up), what it
    // cuts off is under the screen's edge, and its frames would be the
    // browser's for nothing.
    const cutting = !(now.gap < 0.5 && look.gap < 0.5 && now.near < 0.5 && look.near < 0.5 && Math.abs(now.far - look.far) < 0.5);
    if (!cutting) panel.style.clipPath = "";
    painted.current = true;
    next.runs = parts.filter(([, part]) => cutting || part !== "cut").map(([el, part]) => ({ part, run: el.animate(frames(part), timing) }));
    next.runs[0]!.run.finished.then(() => {
      if (move.current?.turn !== next.turn) return;
      rest(look);
      said.current();
    }, () => {});
    panel.dispatchEvent(new CustomEvent<SheetTurn>("sheetturn", { bubbles: true, detail: { insets } }));
  });
  useEffect(() => () => edges(null), [edges]);
}
