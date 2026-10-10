/**
 * The app's text sizes, by what the words are: as iOS sets them on a
 * touch screen -- a row's name 17 points, the line under it 15, a note
 * 13 (the Body, Subheadline and Footnote text styles), a drawer's title
 * 17 and semibold, as a navigation bar's is -- and as the app always
 * has with a mouse, 16, 14 and 12. One place says them, so every list,
 * section and sheet reads alike: on a phone they were 12 and 14
 * everywhere but the waypoint list. (A title of 20 put "Flight
 * Planning" on two lines beside its three toolbar buttons.)
 *
 * A touch screen, not a narrow one, decides: a phone on its side and
 * an iPad are as wide as a small desktop and are still read at arm's
 * length and worked with a finger, which is the test the 44-point hit
 * areas in index.css go by too. All in rem, so all of it grows with
 * the text size. Class strings rather than theme utilities, so `cn`
 * knows each for a font size and keeps it beside a colour.
 */
export const TEXT = {
  /** A card's name -- an airport's, the airspace's, Nearest's, a console
   *  page's -- with font-bold: 22 on 28 (iOS Title 2), the same with a
   *  mouse. */
  card: "text-[1.375rem] leading-7",
  /** A drawer's or a sheet's own title, with font-semibold: 17, and 16 with a mouse. */
  title: "text-base pointer-coarse:text-[1.0625rem]",
  /** A section's title in the planning panel's tabs, with font-semibold:
   *  20 on its 25 leading (iOS Title 3), and 18 with a mouse -- above a
   *  row's 17, where the same size in a heavier weight read as one more
   *  row (the tabs' content audit, 2026-10-07). */
  heading: "text-lg pointer-coarse:text-[1.25rem] pointer-coarse:leading-[1.5625rem]",
  /** A row's name and its value, a section's title: 17, 14. */
  row: "text-sm pointer-coarse:text-[1.0625rem]",
  /** The line under a row's name: 15, 12. */
  detail: "text-xs pointer-coarse:text-[0.9375rem]",
  /** What is read rather than scanned -- a section's summary, a
   *  paragraph, the message where rows will be: 15, 14. */
  prose: "text-sm pointer-coarse:text-[0.9375rem]",
  /** A section's line of help, a group's heading and its note, a key: 13, 12. */
  note: "text-xs pointer-coarse:text-[0.8125rem]",
  /** A chip's category inside a column the width of the star, with
   *  font-bold: iOS's Caption 2, 11 on 13, the same with a mouse. */
  caption: "text-[0.6875rem] leading-[0.8125rem]",
} as const;

/** A group's heading, as iOS's grouped lists set one: a note's size,
 *  semibold, in capitals, spaced out and grey. Over a list's box
 *  (ListGroup), the nav log's columns, a popover's parts -- one look,
 *  where the nav log's were a row's size in black, at the pilot's ask. */
export const GROUP_HEADING = `font-semibold uppercase tracking-wide text-muted-foreground ${TEXT.note}`;

/** The sizes of text drawn in points rather than by class (the runway
 *  sketch's numbers in an SVG): TEXT.caption's 11 and TEXT.row's 17 as
 *  a touch screen sets them. */
export const TEXT_POINTS = { caption: 11, row: 17 } as const;

/** iOS's text styles from Title 2 down to Footnote, each size on its own
 *  leading, in rem (points at the default text size): 22 on 28, 20 on
 *  25, 17 on 22, 16 on 21, 15 on 20, 13 on 18 -- the steps a card's name
 *  is brought down by to fit its box (FitText), from its own style (an
 *  airport's from Title 1's 28 on 34). */
export const TITLE_DOWN_TO_FOOTNOTE: [number, number][] = [
  [1.375, 1.75], [1.25, 1.5625], [1.0625, 1.375], [1, 1.3125], [0.9375, 1.25], [0.8125, 1.125],
];
