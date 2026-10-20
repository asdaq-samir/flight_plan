/** Whether the pilot asked for less motion (iOS's Reduce Motion, the
 *  system setting a browser reports as prefers-reduced-motion). The CSS
 *  rule in index.css stills transitions and animations, but Leaflet moves
 *  the map in script, so each of its flights and pans asks here and goes
 *  straight to where it was going instead. Read at the move, not kept:
 *  the setting can change while the app is open. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
