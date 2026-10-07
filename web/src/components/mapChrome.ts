import { createContext, type ReactNode } from "react";
import { create } from "zustand";

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
}
export const NO_INSETS: MapInsets = { top: 0, bottom: 0, left: 0, out: false };
export const MapInsetsContext = createContext<MapInsets>(NO_INSETS);

/** The console's button (MapPage), for the panel's capsule to put at its
 *  end, as Maps puts the account's beside its search bar: the planner's
 *  search bar (SearchField) and the training page's route capsule
 *  (RouteCapsule) read it. Null where the page wants none -- the
 *  planner's route. */
export const ConsoleButtonContext = createContext<ReactNode>(null);

/** The settings, as the console's last tab (ConsoleTabs): the page's
 *  own (MapPage), the same in either console. */
export const ConsoleSettingsContext = createContext<ReactNode>(null);

/** What the map panel's body must show whole at the half height, in
 *  pixels from the body's top -- a place card's name and its actions,
 *  as Maps' medium detent always shows them -- or null: the half detent
 *  grows to fit it, as far as the whole height (MapPanel). `exact`: the
 *  half is that and no more, even under half the screen -- the route's
 *  panel, its tabs and the nav log's line, at the pilot's ask. */
export const PanelHalfContext = createContext<((px: number | null, exact?: boolean) => void) | null>(null);

/** Whether the console is out, the app's rather than a page's: the two
 *  pages are drawn anew as a developer's Pilot and Developer in its
 *  title (ConsoleHeader) change one for the other, and the console stays
 *  out across the change, the other page's in its place. Not kept past
 *  a reload. */
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
export const GLASS_SHEET = "liquid-glass [--glass-fill:62%]";

/** And all the way up, on the screen's edges as Maps' sheet is, nearly
 *  whole: its rim lit and its far corners round, as at half -- the opaque
 *  slab it was read heavy, the pilot found -- but the chart only faintly
 *  under a screenful of nav log. */
export const GLASS_SHEET_FULL = "liquid-glass [--glass-fill:88%]";

/** The glass's fill at each shape (GLASS, GLASS_SHEET, GLASS_SHEET_FULL),
 *  for a sheet being dragged to follow from one to the next. A dragged
 *  sheet was an opaque fill with no blur behind it, for the frames a blur
 *  re-drawn every frame was measured to cost; the pilot found the glass
 *  giving way under the finger, which Maps' never does. */
export const GLASS_FILL = { capsule: 40, half: 62, full: 88 };

/** iOS's sheet curve, the one vaul uses too: a sheet's height, and its
 *  way in from the screen's edges as it changes shape. */
const SHEET_CURVE = "0.5s cubic-bezier(0.32, 0.72, 0, 1)";
/** The map's own move to a route as the sheet settles (MapShell), in
 *  seconds: the sheet's time, so the two arrive together. */
export const SHEET_SECONDS = 0.5;
export const SHEET_RESHAPE = ["left", "right", "top", "bottom", "border-radius"].map(p => `${p} ${SHEET_CURVE}`).join(", ");
export const SHEET_SETTLE = `height ${SHEET_CURVE}, ${SHEET_RESHAPE}`;

/** Maps' medium sheet: in from the sides and its edge, every corner
 *  round, as the screen's own are -- the map's panel and the console's
 *  sheet up to half way, and their far corners all the way up. */
export const SHEET_INSET = 8;
export const SHEET_INSET_RADIUS = 36;

/** The margin a card keeps from the screen's edges, and a phone's sheet
 *  from the far one. */
export const SHEET_MARGIN = 8;

/** A control's own pane of the glass, as iOS 26 draws its buttons and
 *  chips over content (Maps' close, its filter chips): whiter than the
 *  sheet under it, a lit rim and a shadow a button's size, the words and
 *  glyph in the text's colour. Theme utilities rather than one of
 *  index.css's own, so `cn` drops a variant's fill, border and shadow for
 *  these (the Select's outline, a Button's). */
export const GLASS_BUTTON =
  "border-0 bg-background/75 text-foreground shadow-[inset_0_1px_1px_rgb(255_255_255/0.95),inset_0_0_0_0.5px_rgb(255_255_255/0.7),0_0_0_0.5px_rgb(0_0_0/0.08),0_2px_8px_rgb(0_0_0/0.12)] hover:bg-background hover:text-foreground aria-expanded:bg-background " +
  "dark:bg-foreground/12 dark:shadow-[inset_0_1px_1px_rgb(255_255_255/0.18),inset_0_0_0_0.5px_rgb(255_255_255/0.1),0_0_0_0.5px_rgb(0_0_0/0.5),0_2px_8px_rgb(0_0_0/0.35)] dark:hover:bg-foreground/18 dark:aria-expanded:bg-foreground/18";

/** A chip's words on the panel's row (the aeroplane, the cruising altitude,
 *  the time): a note's 13 to a finger, as Maps' route options are, growing
 *  with the reader's text size only to 14, so the row stays one line at
 *  the pilot's, a step up from iOS's default. */
export const CHIP_TEXT = "text-xs pointer-coarse:text-[min(0.8125rem,14px)]";

/** A round button on the panel -- the console's, the route's close -- as
 *  Maps' are on iOS 26: a circle of that glass, its glyph bold in the
 *  text's colour (the pilot's pick, after a grey disc). */
export const ROUND_BUTTON = `rounded-full ${GLASS_BUTTON}`;
