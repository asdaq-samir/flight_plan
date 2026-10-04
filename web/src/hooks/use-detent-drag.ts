import { useEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** How far a finger moves before a press is a drag rather than a tap on
 *  what it pressed: iOS's own ten points. At six, a tap on a button in the
 *  head -- the route box's plus -- that rolled a little under the finger
 *  dragged the sheet instead, and its click was swallowed. */
const DRAG_SLOP = 10;

/**
 * A sheet's drag, as iOS's: it follows the finger between its lowest and
 * highest detent, and lets go to the detent it was heading for -- where
 * it was thrown, not only where it stopped. A press that does not move is
 * the tap it was, and the click a drag's release makes is swallowed
 * (`swallow`, on the sheet's click capture). Followed on the window, not
 * by capturing the pointer: a mouse leaves the head as soon as it drags
 * it, and a captured pointer would take the click from a button in the
 * head that was only tapped.
 *
 * The map's panel (MapPanel) and the console's sheet on a phone
 * (ConsoleSheet) share it, so the two move alike from either edge. The
 * sheet keeps the height being dragged to (`setDragged`, null at rest);
 * `shown` is the height it is at now.
 */
export function useDetentDrag<S extends string>({ detents, shown, fromBottom, onRelease, setDragged }: {
  detents: Record<S, number>;
  shown: number;
  /** A sheet from the bottom opens upward; one from the top, downward. */
  fromBottom: boolean;
  onRelease: (detent: S) => void;
  setDragged: (height: number | null) => void;
}) {
  const swallowClick = useRef(false);
  const latest = useRef({ detents, shown, onRelease, fromBottom });
  useEffect(() => { latest.current = { detents, shown, onRelease, fromBottom }; });

  const startDrag = (start: ReactPointerEvent) => {
    if (start.button !== 0) return;
    const from = latest.current.shown;
    const sign = latest.current.fromBottom ? -1 : 1;
    let moved = false, last = start.clientY, at = start.timeStamp, speed = 0, to = from;
    // One height a frame, however many moves a frame brings: a touch
    // screen sends them at twice the display's rate on a ProMotion
    // iPhone, each a render of the sheet.
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (!moved && Math.abs(event.clientY - start.clientY) < DRAG_SLOP) return;
      moved = true;
      speed = sign * (event.clientY - last) / Math.max(event.timeStamp - at, 1);
      last = event.clientY;
      at = event.timeStamp;
      const heights = Object.values<number>(latest.current.detents);
      to = Math.min(Math.max(...heights), Math.max(Math.min(...heights), from + sign * (event.clientY - start.clientY)));
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setDragged(to); });
    };
    const end = (event: PointerEvent) => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!moved) return;
      // A click from this release, if one comes, comes before any timer.
      swallowClick.current = event.type === "pointerup";
      window.setTimeout(() => { swallowClick.current = false; }, 0);
      // Where it would come to rest a fifth of a second on at the speed
      // it was let go, to the nearest detent.
      const { detents: d, onRelease: release } = latest.current;
      const aim = to + speed * 200;
      const names = Object.keys(d) as S[];
      const nearest = names.reduce((best, s) => (Math.abs(d[s] - aim) < Math.abs(d[best] - aim) ? s : best));
      setDragged(null);
      release(nearest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // The release of a drag is not a tap on whatever it started on.
  const swallow = (event: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return { startDrag, swallow };
}
