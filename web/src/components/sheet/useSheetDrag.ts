import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { clampHeight, DRAG_SLOP, follow, SCROLL_SLOP_PX, sheetTakes, speedAt, type Box, type Detents, type Track } from "./engine";

/** What the sheet is now, read afresh at each move. */
export interface DragOf {
  detents: Detents;
  fromBottom: boolean;
  /** Where the sheet is as the finger goes down, px. */
  height: () => number;
  /** The finger has moved its ten points: the drag is on. */
  began: () => void;
  /** Put the sheet at `h`, this frame. */
  place: (h: number) => void;
  /** The finger let go at `h`, at `speed` points a millisecond toward opening. */
  release: (h: number, speed: number) => void;
}

/**
 * A sheet's drag, as iOS's: it follows the finger between its lowest and
 * highest detent (`place`, once a frame however many moves a frame
 * brings: a touch screen sends them at twice the display's rate on a
 * ProMotion iPhone), and lets go to the detent it was heading for
 * (`release`, engine's restingAt). A press that does not move ten
 * points is the tap it was, and the click a drag's release makes is
 * swallowed (`swallow`, on the sheet's click capture). Followed on the
 * window, not by capturing the pointer: a mouse leaves the head as soon
 * as it drags it, and a captured pointer would take the click from a
 * button in the head that was only tapped.
 *
 * `startDrag` is for the handle -- the grabber, the tab bar, the head,
 * the pill's row -- by pointer; the body (`body`, its element) drags by
 * touch, where its content is not scrolling (engine's sheetTakes).
 * Decided at the finger's first move, the one a page can still take from
 * the browser's scrolling: the Touch Events spec has a touchmove's
 * preventDefault stop a scroll on the first touchmove only. A drag
 * sideways, a control with gestures of its own, a text area and a slider
 * keep theirs; a mouse drags the handle alone, as a drag across the body
 * selects its words.
 */
export function useSheetDrag(of: DragOf) {
  const swallowClick = useRef(false);
  const latest = useRef(of);
  useEffect(() => { latest.current = of; });

  const startDrag = (start: ReactPointerEvent) => {
    if (start.button !== 0) return;
    const d = latest.current;
    const from = d.height();
    const sign = d.fromBottom ? -1 : 1;
    let moved = false, to = from;
    const track: Track = [{ y: start.clientY, t: start.timeStamp }];
    let frame = 0;
    const move = (event: PointerEvent) => {
      // A move a control in the head has taken for its own (the route
      // box's sortable pills) is not the sheet's.
      if (event.defaultPrevented) return;
      if (!moved && Math.abs(event.clientY - start.clientY) < DRAG_SLOP) return;
      if (!moved) latest.current.began();
      moved = true;
      follow(track, event.clientY, event.timeStamp);
      to = clampHeight(latest.current.detents, from + sign * (event.clientY - start.clientY));
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; latest.current.place(to); });
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
      latest.current.release(to, sign * speedAt(track, event.timeStamp));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!body) return;
    const scrolls = (el: Element) => el.scrollHeight - el.clientHeight > SCROLL_SLOP_PX;
    // The boxes from the finger's target up to the body, as the rule reads them.
    const pathOf = (target: Element): Box[] => {
      const path: Box[] = [];
      for (let el: Element | null = target; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        path.push({
          isBody: el === body,
          keeps: el.matches("textarea, input[type=range], [contenteditable=true]") || style.touchAction === "none",
          scrollFirst: el instanceof HTMLElement && el.dataset.scrollFirst !== undefined,
          scroller: /auto|scroll/.test(style.overflowY),
          scrolls: scrolls(el),
          atStart: el.scrollTop <= 0,
          atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
        });
        if (el === body) break;
      }
      return path;
    };
    let gesture: { x: number; y: number; from: number; target: Element; sheet: boolean | null; moved: boolean; to: number; track: Track } | null = null;
    let frame = 0;
    const letGo = (g: { to: number }, speed: number) => latest.current.release(g.to, speed);
    const start = (event: TouchEvent) => {
      // A finger landing on a drag that has begun is a pinch: let the sheet
      // go to its detent now, as no touchmove of one finger is left to.
      if (gesture?.moved) letGo(gesture, 0);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const touch = event.touches[0];
      gesture = touch && event.touches.length === 1 && event.target instanceof Element ? {
        x: touch.clientX, y: touch.clientY, from: latest.current.height(), target: event.target,
        sheet: null, moved: false, to: latest.current.height(), track: [{ y: touch.clientY, t: event.timeStamp }],
      } : null;
    };
    const move = (event: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) {
        gesture = null;
        if (g.moved) letGo(g, 0);
        return;
      }
      const dx = touch.clientX - g.x, dy = touch.clientY - g.y;
      // A first move that went nowhere says nothing of the direction.
      if (g.sheet === null && dx === 0 && dy === 0) return;
      if (g.sheet === null) {
        const { detents, fromBottom, height } = latest.current;
        g.sheet = Math.abs(dy) > Math.abs(dx) && sheetTakes(pathOf(g.target), dy, fromBottom, height() < Math.max(...Object.values(detents)) - 1);
        if (!g.sheet) {
          gesture = null;
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      if (!g.moved && Math.abs(dy) < DRAG_SLOP) return;
      if (!g.moved) latest.current.began();
      g.moved = true;
      follow(g.track, touch.clientY, event.timeStamp);
      const { detents, fromBottom } = latest.current;
      g.to = clampHeight(detents, g.from + (fromBottom ? -dy : dy));
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (gesture) latest.current.place(gesture.to); });
    };
    const end = (event: TouchEvent) => {
      const g = gesture;
      gesture = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!g?.moved) return;
      // No click from the release: the drag was the sheet's.
      if (event.cancelable) event.preventDefault();
      const speed = (latest.current.fromBottom ? -1 : 1) * speedAt(g.track, event.timeStamp);
      letGo(g, event.type === "touchend" ? speed : 0);
    };
    body.addEventListener("touchstart", start, { passive: true });
    body.addEventListener("touchmove", move, { passive: false });
    body.addEventListener("touchend", end, { passive: false });
    body.addEventListener("touchcancel", end);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      body.removeEventListener("touchstart", start);
      body.removeEventListener("touchmove", move);
      body.removeEventListener("touchend", end);
      body.removeEventListener("touchcancel", end);
    };
  }, [body]);

  // The release of a drag is not a tap on whatever it started on.
  const swallow = (event: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return { startDrag, swallow, body: setBody };
}
