/** The fill of a panel's field -- Airport's and Aircraft's search bars,
 *  FPL's route box -- one for all of them, at the owner's notice ("Why do
 *  the input boxes of aircraft and airport look different than fpl?"): on
 *  the sheet the grey of iOS's search field, on the glass pill a lighter
 *  pane of the glass, no line round it; 41 points tall at least, as Maps'
 *  field is. */
export const PANEL_FIELD_FILL = "bg-foreground/8 dark:bg-foreground/8 in-data-capsule:bg-white/50 dark:in-data-capsule:bg-white/10";
export const PANEL_FIELD = `min-h-[2.5625rem] ${PANEL_FIELD_FILL}`;
