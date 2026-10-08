/**
 * Scrolls a list's selected row into the middle of whatever scrolls it,
 * if it is not already in view -- and leaves it alone if it is. Returns
 * a function that calls it off, for an effect's cleanup.
 *
 * `scrollIntoView({ block: "nearest" })` did the first half: a row off
 * the bottom came to rest at the bottom edge, which for a point picked
 * on the map and then looked for in the drawer meant the last visible
 * line, easy to miss. `block: "center"` alone would do the second
 * half wrong: a row clicked in the list itself, already in view, would
 * slide away from under the pointer to the middle.
 *
 * "In view" is judged against every ancestor that clips (overflow
 * other than visible) and the viewport together: the drawer's
 * scroller, but also the table's own container, which scrolls
 * sideways only and is as tall as the table -- judged against that
 * one alone, a row far below the drawer's bottom edge read as in view.
 *
 * The wait is for whatever around the row is still moving: an
 * accordion section opening, whose content clips and grows for 200 ms,
 * or the drawer sliding in or widening. A scrollIntoView while a
 * section grows scrolls its clipping content too, and as it finishes
 * growing that scroll snaps back to zero, taking the row down to where
 * it had been: the drawer had not moved, and the row was still off
 * screen. A fixed 250 ms was the wait once, 50 ms more than the
 * section's animation, and on a busy phone the animation, started late
 * behind the rendering of its rows, outlasted it. So the row is looked
 * at once two frames in a row have had nothing around it moving, which
 * also catches an animation that starts a frame after the reveal was
 * asked for -- and at the latest after 90 frames, whatever is moving.
 */
export function revealRow(row: HTMLElement | null): () => void {
  if (!row) return () => {};
  let frame = 0;
  let still = 0;
  let frames = 0;
  const look = () => {
    still = moving(row) ? 0 : still + 1;
    // In view already with nothing round it moving, at the first look --
    // a row tapped in the list itself -- it stays: watched for two frames
    // more as the map followed it, each look made the browser work the
    // page's styles out afresh mid-frame, 0.2 s of a phone's (CPU 4x
    // slower) at every row picked (measured 2026-10-08).
    if (frames === 0 && still === 1 && row.isConnected && inView(row)) return;
    if (still < 2 && ++frames < 90) {
      frame = requestAnimationFrame(look);
      return;
    }
    if (!row.isConnected || inView(row)) return;
    row.scrollIntoView({ block: "center" });
  };
  frame = requestAnimationFrame(look);
  return () => cancelAnimationFrame(frame);
}

/** Whether all of `row` is where it can be seen. */
function inView(row: HTMLElement): boolean {
  const box = row.getBoundingClientRect();
  const view = visibleBand(row);
  return box.top >= view.top && box.bottom <= view.bottom;
}

/** Whether an animation or transition that can move it is running on
 *  `el` or an ancestor of it -- one that will end: a spinner's never
 *  would. Asked of each of them, not of the document: the document's are
 *  the map's tiles' fades and pans too, a hundred and more as the map
 *  follows a row picked, and going through them every frame took 0.3 s of
 *  a phone's (measured 2026-10-07). And not a change of colour -- the row's
 *  own, as it is picked -- which moves nothing and kept this looking for
 *  ten frames more. */
function moving(el: HTMLElement): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const running = node.getAnimations().some(animation =>
      animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity
      && !(animation instanceof CSSTransition && COLOURS.has(animation.transitionProperty)));
    if (running) return true;
  }
  return false;
}

/** What a transition of moves nothing. */
const COLOURS = new Set([
  "color", "background-color", "border-color", "border-top-color", "border-right-color", "border-bottom-color",
  "border-left-color", "outline-color", "fill", "stroke", "opacity", "box-shadow", "text-decoration-color",
]);

/** The vertical band of the page not clipped away from `el` by any of
 *  its ancestors: where a box has to be to be seen. */
function visibleBand(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowY === "visible") continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}
