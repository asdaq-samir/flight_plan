/** The fill of a panel's field -- Airport's and Aircraft's search bars,
 *  FPL's route box and the altitude beside the airplane -- one for all of
 *  them, at the owner's notice ("Why do the input boxes of aircraft and
 *  airport look different than fpl?"): glass, at the owner's pick of the
 *  input styles (2026-10-20, "maybe glass for the two inputs"), a pane
 *  lighter than the sheet with a lit rim and a shadow a field's size, on
 *  the sheet and the pill alike; 41 points tall at least, as Maps' field
 *  is. */
export const PANEL_FIELD_FILL =
  // A white card on the sheet's grey, as Apple's Maps on the web sets its
  // search field and its directions' stops (the style audit, 2026-10-26).
  "bg-card shadow-none";
export const PANEL_FIELD = `min-h-[2.5625rem] ${PANEL_FIELD_FILL}`;
