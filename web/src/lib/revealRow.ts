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
 * The wait is for an accordion section still opening: its content
 * clips and grows for 200 ms, and a scrollIntoView in that time
 * scrolls the clipping element too, which then keeps its top rows
 * clipped for good.
 */
export function revealRow(row: HTMLElement | null): () => void {
  if (!row) return () => {};
  const timer = window.setTimeout(() => {
    const box = row.getBoundingClientRect();
    const view = visibleBand(row);
    if (box.top >= view.top && box.bottom <= view.bottom) return;
    row.scrollIntoView({ block: "center" });
  }, 250);
  return () => window.clearTimeout(timer);
}

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
