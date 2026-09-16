import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

// How far one arrow-key press moves it -- the keyboard equivalent of
// the drag, for a handle that's pointer-only otherwise.
const KEY_STEP = 24;

interface Options {
  /** Which screen axis the pointer moves along while dragging. */
  axis: "x" | "y";
  /** +1 if increasing the raw pointer delta should grow the size (the
   *  toolbar's drawer: dragging down opens it further); -1 if
   *  inverted (the error drawer, anchored to the bottom: dragging up
   *  is what opens it further). */
  sign: 1 | -1;
  /** The most this can be dragged open -- the caller measures this
   *  however fits it (a ResizeObserver on the real content, a share
   *  of the viewport), since that varies by what's being resized. */
  maxSize: number;
}

/**
 * The drag-to-resize physics every pull-tab handle in this app shares
 * -- pointer capture, the keyboard equivalent, and the clamp -- so a
 * toolbar's drawer, the sidebar, and the error drawer all resize the
 * same way instead of three independent copies that can quietly drift
 * apart (one keyed a `useEffect` differently, another's grab target
 * ended up a different size) the way they once did. Only the *meaning*
 * of size (height vs. width) and which direction opens it differ
 * between callers, which is what `axis`/`sign` are for -- everything
 * else here is identical regardless of which one is asking.
 */
export function useDragHandle({ axis, sign, maxSize }: Options) {
  const [size, setSize] = useState(0);
  const dragStart = useRef<{ pos: number; size: number } | null>(null);

  const clamp = useCallback((v: number) => Math.min(maxSize, Math.max(0, v)), [maxSize]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragStart.current) return;
    const pos = axis === "y" ? e.clientY : e.clientX;
    setSize(clamp(dragStart.current.size + (pos - dragStart.current.pos) * sign));
  }, [axis, sign, clamp]);

  const endDrag = useCallback(() => {
    dragStart.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    document.body.style.removeProperty("user-select");
  }, [onPointerMove]);

  const startDrag = useCallback((e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { pos: axis === "y" ? e.clientY : e.clientX, size };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    // A touch drag the OS decides to interrupt (an incoming call, a
    // system gesture taking over) fires this instead of pointerup --
    // without also cleaning up here, the stale listeners and drag
    // state would survive and corrupt the next attempt.
    window.addEventListener("pointercancel", endDrag);
  }, [axis, size, onPointerMove, endDrag]);

  useEffect(() => () => endDrag(), [endDrag]);

  // Right/Up open it further and Left/Down close it, matching the
  // direction convention every ARIA slider uses regardless of which
  // axis this is actually dragging along; Home/End jump to fully
  // closed/open.
  const onKeyDown = useCallback((e: ReactKeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setSize(s => clamp(s + KEY_STEP));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setSize(s => clamp(s - KEY_STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSize(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSize(maxSize);
    }
  }, [clamp, maxSize]);

  return { size, setSize, startDrag, onKeyDown };
}
