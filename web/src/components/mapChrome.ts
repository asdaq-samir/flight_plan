import { GLASS_EDGE } from "../lib/glass";
import { createContext, type ReactNode } from "react";
import { create } from "zustand";
import { TEXT } from "../lib/text";

/**
 * What the map's chrome shares -- the panel over it (MapPanel), its
 * buttons (MapControls) and the map itself (MapShell) -- kept apart
 * from the components so each file exports components only.
 */

/**
 * How far the panel is out, as iOS's sheet detents are named in Maps:
 * resting at the screen's edge with only its top showing, half the
 * screen (an airport's card), or the whole of it (the nav log and the
 * briefing).
 */
export type PanelState = "peek" | "half" | "full";

/** What the panel covers of the map where it has settled -- the capsule
 *  at rest, the half sheet out -- in pixels from each edge, so the map
 *  can fit a route clear of it and keep its chart credit in sight
 *  (MapShell, index.css). */
export interface MapInsets {
  top: number;
  bottom: number;
  left: number;
  /** Where the panel has settled: at rest (its capsule, or a desktop's
   *  corner) or out. The map follows a change of this (MapShell), not
   *  every change of the size -- a notice under the route, the head
   *  measured again -- which would take the map from under a pilot's
   *  finger as the plan streams in. */
  out: boolean;
  /** All the way up: the map hidden, fitted to what shows once it comes
   *  down. Coming down to the pill is a change the map follows too, the
   *  pill's own height measured as it comes. */
  up: boolean;
}
export const NO_INSETS: MapInsets = { top: 0, bottom: 0, left: 0, out: false, up: false };
export const MapInsetsContext = createContext<MapInsets>(NO_INSETS);

/** The settings, as the console's last tab (ConsoleTabs): the page's
 *  own (MapPage), the same in either console. */
export const ConsoleSettingsContext = createContext<ReactNode>(null);

/** The console's close where it is a layer of the map's panel rather
 *  than a sheet of its own -- on a phone (MapPage) -- for its header to
 *  put it away with (ConsoleHeader): with no sheet round it, it has no
 *  sheet's own close, title or description to use. */
export const ConsoleInPanelContext = createContext<{ close: () => void } | null>(null);

/** Whether the tab bar is minimized (MapPanel): out of the pill on a
 *  phone, the sheet up, it is the tab up's name alone, centred, as iOS
 *  26's tab bar minimizes, at the pilot's ask; tapped, every tab again
 *  (TabBar). */
export const TabBarMinimized = createContext(false);

/** The panel's size as the tab bar sees it, and the way to change it
 *  (MapPanel). Null outside a panel. */
export const PanelSize = createContext<{
  size: PanelState;
  to: (size: PanelState) => void;
  /** A card in the pill (MapPanel's `cardInPill`): a tap on the tab up puts it away. */
  card: boolean;
} | null>(null);

/** Whether the console is out, the app's rather than a page's: the two
 *  pages are drawn anew as a developer's Pilot and Developer in its
 *  title (ConsoleHeader) change one for the other, and the console stays
 *  out across the change, the other page's in its place. Not kept past
 *  a reload. */
/** Whether the minimized tab bar has been tapped open to every tab
 *  (TabBar): while it is, its Back and close are not shown, at the
 *  owner's ask; the tab up tapped again puts a card away. */
export const useTabsShown = create<{ shown: boolean }>(() => ({ shown: false }));

/** The name of the card open over the panel's tabs, as its card has it
 *  (an airplane's callsign or registration, FlightCard), for the bar's
 *  title over it (TabBar). */
export const useCardTitle = create<{ title: string | null }>(() => ({ title: null }));

export const useConsoleOpen = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({
  open: false,
  setOpen: open => set({ open }),
}));

/**
 * What floats over the chart: translucent, the map showing through it
 * blurred, as iOS's materials are -- the panel, the map's buttons. On
 * the popover's grey in the dark theme, so it stands off a dark chart.
 */
export const MATERIAL = "bg-background/85 backdrop-blur-xl backdrop-saturate-150 dark:bg-popover/90";

/**
 * iOS 26's Liquid Glass, for what floats over the chart at rest: the
 * panel's capsule and the map's buttons. Clearer than MATERIAL -- the
 * chart is there under it, blurred and brightened -- with a lit rim and
 * a soft shadow of its own (index.css, `liquid-glass`). It cannot bend
 * the chart at its edge as iOS's does: Safari will not run an SVG
 * filter behind an element.
 */
export const GLASS = "liquid-glass";

/** The same glass for a sheet at half height, frostier -- more of the
 *  material, less of the chart -- as what is on it is read: the map's
 *  panel and the console. */
export const GLASS_SHEET = "bg-[var(--sheet)] shadow-[0_-1px_12px_rgb(0_0_0/0.12)] dark:shadow-[0_-1px_12px_rgb(0_0_0/0.5)]";

/** And all the way up, on the screen's edges as Maps' sheet is, nearly
 *  whole: its rim lit and its far corners round, as at half -- the opaque
 *  slab it was read heavy, the pilot found -- but the chart only faintly
 *  under a screenful of nav log. */
export const GLASS_SHEET_FULL = GLASS_SHEET;

/** The glass's fill at each shape (GLASS, GLASS_SHEET, GLASS_SHEET_FULL),
 *  for a sheet being dragged to follow from one to the next. A dragged
 *  sheet was an opaque fill with no blur behind it, for the frames a blur
 *  re-drawn every frame was measured to cost; the pilot found the glass
 *  giving way under the finger, which Maps' never does. */
export const GLASS_FILL = { capsule: 80, half: 100, full: 100 };

/** How long the sheet takes from the pill to half (SETTLE_POINTS), in
 *  seconds, at the owner's ask ("make the 8443 a bit fast to match Apple
 *  Maps"): Maps' sheet, measured frame by frame from the owner's screen
 *  recording, is 98% of the way in 0.17 to 0.23 s whatever the distance,
 *  and this curve is 98% of the way at 89% of its time -- 0.27 s here.
 *  It was 0.45 s. The map's own move to a route as the sheet settles
 *  (MapShell) takes it too, so the two arrive together. */
export const SHEET_SECONDS = 0.3;
/** A sheet's height, and its way in from the screen's edges as it changes
 *  shape: iOS's ease-out, at the owner's pick ("Do b"). The curve before
 *  (0.32 0.72 0 1 over half a second) covered three quarters of a move to
 *  all the way up in its first 170 ms, and read as a snap; a spring that
 *  went a point or two past, as Maps' does, the owner turned down ("I
 *  don't want the spring"). */
const SHEET_CURVE = `${SHEET_SECONDS}s cubic-bezier(0, 0, 0.58, 1)`;
export const SHEET_RESHAPE = ["left", "right", "top", "bottom", "border-radius"].map(p => `${p} ${SHEET_CURVE}`).join(", ");
/** The sheet's settle over `seconds`: its height, its shape and its
 *  progress up (MapPanel's --sheet-progress, index.css's @property), which
 *  eases with the height so what grows with it -- FPL's figures, the side
 *  view folding away -- moves with the sheet, not at once. */
export const sheetSettle = (seconds: number) => {
  const curve = `${seconds}s cubic-bezier(0, 0, 0.58, 1)`;
  return {
    height: ["height", "left", "right", "top", "bottom", "border-radius"].map(p => `${p} ${curve}`).join(", "),
    progress: `--sheet-progress ${curve}`,
    curve,
  };
};
/** How far the sheet goes in SHEET_SECONDS: the pill to half on an iPhone
 *  16 Pro, the move the owner likes ("Pill to half card and back eases
 *  nicely but to/from full card snaps very quickly"). A longer move takes
 *  longer at that speed, between SETTLE_LEAST and SETTLE_MOST seconds --
 *  no longer than 0.35 s, as Maps' takes no longer for a longer move
 *  (half to all the way up, 546 points, took 0.75 s before). */
export const SETTLE_POINTS = 273;
export const SETTLE_LEAST = 0.22;
export const SETTLE_MOST = 0.35;

/** Maps' medium sheet: in from the sides and its edge, every corner
 *  round, as the screen's own are -- the map's panel and the console's
 *  sheet up to half way, and their far corners all the way up. */
export const SHEET_INSET = 8;
export const SHEET_INSET_RADIUS = 36;
/** The panel at rest, its tabs and the route's figures: a rectangle with
 *  round corners, at the pilot's ask ("more of a rectangle"), where it was
 *  a capsule, its ends half its height round. */
export const PILL_RADIUS = 24;

/** The margin a card keeps from the screen's edges, and a phone's sheet
 *  from the far one. */
export const SHEET_MARGIN = 8;

/** A pane of clear glass, as the tab up is (TabGlass): bright at its top
 *  and clearing toward its foot, lit along its rim in white, standing off
 *  the sheet on a soft shadow -- raised, never a dark line inside the rim,
 *  which read as etched. The tab up's capsule in the pill (TabBar). */
export const GLASS_CLEAR =
  "border-0 bg-transparent bg-linear-to-b from-[var(--glass-top-fill)] to-[var(--glass-foot-fill)] text-foreground " + GLASS_EDGE;

/** A control's own pane of glass, as iOS 26 draws its buttons over
 *  content, clear as the tab up's is (TabGlass), at the owner's ask ("Can
 *  we try clear instead of tint", 2026-10-23, after the tinted "2"):
 *  nearly the sheet's own tone, so it reads by its light and its edge as
 *  the tab does -- a sheen at its top, bright there and clearing to almost
 *  nothing at its foot, a white rim, a hairline and a soft shade round it.
 *  The first clear glass (GLASS_CLEAR) was whiter all the way down and
 *  read as white chips on the near-white sheet. Lit along its top edge
 *  alone, as iOS's glass is, in the dark (the owner's "Yes", 2026-10-22:
 *  a light ring round every button outlined the screen) and in the light
 *  as in the dark (the owner's "make it light one similar to dark",
 *  2026-10-23: the ring and a harder shadow made raised white chips). The
 *  words and glyph in
 *  the text's colour. Theme utilities rather than one of index.css's own,
 *  so `cn` drops a variant's fill, border and shadow for these (the
 *  Select's outline, a Button's). */
export const GLASS_BUTTON =
  // Since the style audit (2026-10-26): iOS's grey fill, flat, as Apple's
  // Maps on the web draws its secondary buttons -- no sheen, rim or shade.
  // The app's one neutral fill, the text's colour at 8% -- the same grey
  // as its tiles, chips and selected rows (bg-foreground/8), in either theme.
  "border-0 bg-foreground/8 text-foreground shadow-none " +
  "hover:bg-foreground/12 hover:text-foreground aria-expanded:bg-foreground/12";

/** The same glass tinted the blue on a toggle's chip once it is picked
 *  (data-state "on") -- a field's runway (ProceduresRoute) -- as iOS 26's
 *  prominent glass is for the one choice that sets something: the tint
 *  through it, white words, the light at its top and its rim the clear
 *  glass's. Written out per state, as Tailwind finds its classes by their
 *  whole names. */
export const GLASS_PICKED =
  "data-[state=on]:bg-primary data-[state=on]:font-semibold data-[state=on]:text-primary-foreground hover:data-[state=on]:bg-primary hover:data-[state=on]:text-primary-foreground";

/** A button inside a capsule of the glass (CAPSULE): no glass of its own,
 *  the capsule's round it, a tint of the text's colour when pressed. */
export const IN_CAPSULE = "bg-transparent bg-none shadow-none hover:bg-[var(--glass-pressed)]";

/** A row of buttons in one capsule of the glass, as iOS 26 groups a
 *  toolbar's, at the owner's ask ("Let's try it and if not then go back
 *  to round"): the buttons inside it IN_CAPSULE, their centres 44 apart
 *  as the round ones' were, so each keeps its 44-point tap area. */
export const CAPSULE = `rounded-full ${GLASS_BUTTON}`;

/** A hairline before a button in a capsule but the first, at the owner's
 *  ask ("No separater in the capsule?"): in the middle of the 12 between
 *  the two, so their centres stay 44 apart. */
export const CAPSULE_SEPARATOR = "before:pointer-events-none before:absolute before:top-1/2 before:-left-[6.5px] before:h-4 before:w-px before:-translate-y-1/2 before:bg-foreground/15 before:content-['']";

/** A chip's words on the panel's row (the airplane, the cruising altitude,
 *  the time): a note's 13 to a finger, as Maps' route options are, growing
 *  with the reader's text size only to 14, so the row stays one line at
 *  the pilot's, a step up from iOS's default. */
export const CHIP_TEXT = "text-xs pointer-coarse:text-[min(0.8125rem,14px)]";

/** A tinted capsule that adds a field to the route -- Fly-in Food's Add
 *  Stop and Direct To (FoodCard) -- one height, padding and hit area (the
 *  consistency audit, 2026-10-23): 32 points with a 44-point area round
 *  it as a pseudo-element, so the capsule is not grown to make it. */
export const ADD_CAPSULE =
  "relative h-8 shrink-0 rounded-full bg-tint/12 px-3.5 font-semibold text-tint outline-none " +
  `after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring ${TEXT.detail}`;

/** A round button on the panel -- the console's, the route's close -- as
 *  Maps' are on iOS 26: a circle of that glass, its glyph bold in the
 *  text's colour (the pilot's pick, after a grey disc). */
export const ROUND_BUTTON = `rounded-full ${GLASS_BUTTON}`;

/** Whether the map panel is between sizes (MapPanel): dragged, or easing
 *  down to the pill after a tap. A card shown at the pill's size as its
 *  summary is drawn in full in the panel's body while a finger takes it
 *  up, so the sheet grows with the card in it, not an empty band over the
 *  summary that changed into the card at the release; and easing down, the
 *  body stays as it was until the sheet is the pill. */
export const usePanelDragging = create<{ dragging: boolean }>(() => ({ dragging: false }));
