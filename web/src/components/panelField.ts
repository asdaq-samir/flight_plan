/** The fill of a panel's field -- Airport's and Aircraft's search bars,
 *  FPL's route box and the altitude beside the airplane -- one for all of
 *  them, at the owner's notice ("Why do the input boxes of aircraft and
 *  airport look different than fpl?"): glass, at the owner's pick of the
 *  input styles (2026-10-20, "maybe glass for the two inputs"), a pane
 *  lighter than the sheet with a lit rim and a shadow a field's size, on
 *  the sheet and the pill alike; 41 points tall at least, as Maps' field
 *  is. */
export const PANEL_FIELD_FILL =
  "bg-white/60 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.9),0_1px_3px_rgb(0_0_0/0.08)] " +
  "dark:bg-white/10 dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12),0_1px_3px_rgb(0_0_0/0.3)]";
export const PANEL_FIELD = `min-h-[2.5625rem] ${PANEL_FIELD_FILL}`;
