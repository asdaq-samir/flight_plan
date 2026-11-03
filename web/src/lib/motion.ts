/** Whether the pilot asked for less motion (iOS's Reduce Motion, the
 *  system setting a browser reports as prefers-reduced-motion). The CSS
 *  rule in index.css stills transitions and animations, but Leaflet moves
 *  the map in script, so each of its flights and pans asks here and goes
 *  straight to where it was going instead. Read at the move, not kept:
 *  the setting can change while the app is open. The query itself is
 *  made once and its `matches` read each time: made afresh at each ask,
 *  the marks' and labels' canvases asked for every mark at every frame
 *  of a zoom, 42 ms of a zoom's 4 s at CPU 4x on the phone viewport
 *  (2026-11-03). */
let query: MediaQueryList | null | undefined;
export function prefersReducedMotion(): boolean {
  if (query === undefined) query = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null : null;
  return !!query?.matches;
}
