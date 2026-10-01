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
  /** A drawer's or a sheet's own title, with font-semibold: 17, and 16 with a mouse. */
  title: "text-base pointer-coarse:text-[1.0625rem]",
  /** A row's name and its value, a section's title: 17, 14. */
  row: "text-sm pointer-coarse:text-[1.0625rem]",
  /** The line under a row's name: 15, 12. */
  detail: "text-xs pointer-coarse:text-[0.9375rem]",
  /** What is read rather than scanned -- a section's summary, a
   *  paragraph, the message where rows will be: 15, 14. */
  prose: "text-sm pointer-coarse:text-[0.9375rem]",
  /** A section's line of help, a group's heading and its note, a key: 13, 12. */
  note: "text-xs pointer-coarse:text-[0.8125rem]",
} as const;
