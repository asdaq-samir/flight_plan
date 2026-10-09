import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** How far a finger moves before a press is a drag rather than a tap on
 *  what it pressed: iOS's own ten points. At six, a tap on a button in the
 *  head -- the route box's plus -- that rolled a little under the finger
 *  dragged the sheet instead, and its click was swallowed. */
const DRAG_SLOP = 10;

interface Latest<S extends string> {
  detents: Record<S, number>;
  shown: number;
  onRelease: (detent: S) => void;
  fromBottom: boolean;
  floor?: number;
  setDragged: (height: number | null) => void;
}

/** The height a drag that started at `from` puts the sheet at, the finger
 *  `dy` down the screen from where it went down: no higher than the
 *  highest detent, and no lower than the floor or where it started, under
 *  the lowest detent -- the map's capsule is shorter than the sheet it
 *  becomes the moment a drag starts, and held to the sheet's lowest, it
 *  jumped up under the finger. */
function heightAt<S extends string>(latest: Latest<S>, from: number, dy: number) {
  const heights = Object.values<number>(latest.detents);
  const lowest = Math.min(...heights, from, latest.floor ?? Infinity);
  return Math.min(Math.max(...heights), Math.max(lowest, from + (latest.fromBottom ? -dy : dy)));
}

/** Where a drag let go at `to`, at `speed` points a millisecond toward
 *  opening, comes to rest: the detent nearest where it would be a fifth of
 *  a second on -- where it was thrown, not only where it stopped. */
function letGo<S extends string>(latest: Latest<S>, to: number, speed: number) {
  const { detents, onRelease, setDragged } = latest;
  const aim = to + speed * 200;
  const names = Object.keys(detents) as S[];
  const nearest = names.reduce((best, s) => (Math.abs(detents[s] - aim) < Math.abs(detents[best] - aim) ? s : best));
  setDragged(null);
  onRelease(nearest);
}

/**
 * A sheet's drag, as iOS's: it follows the finger between its lowest and
 * highest detent, and lets go to the detent it was heading for. A press
 * that does not move is the tap it was, and the click a drag's release
 * makes is swallowed (`swallow`, on the sheet's click capture). Followed
 * on the window, not by capturing the pointer: a mouse leaves the head as
 * soon as it drags it, and a captured pointer would take the click from a
 * button in the head that was only tapped.
 *
 * The body drags too, under a finger (`body`, its element): see below.
 *
 * The map's panel (MapPanel) uses it -- the console too, a layer of the
 * panel on a phone -- from either edge. The
 * sheet keeps the height being dragged to (`setDragged`, null at rest);
 * `shown` is the height it is at now.
 */
export function useDetentDrag<S extends string>({ detents, shown, fromBottom, onRelease, setDragged, floor }: {
  detents: Record<S, number>;
  shown: number;
  /** As low as it can be dragged, where that is under the lowest detent:
   *  the map's capsule, shorter than the sheet it opens into. */
  floor?: number;
  /** A sheet from the bottom opens upward; one from the top, downward. */
  fromBottom: boolean;
  onRelease: (detent: S) => void;
  setDragged: (height: number | null) => void;
}) {
  const swallowClick = useRef(false);
  const latest = useRef<Latest<S>>({ detents, shown, onRelease, fromBottom, floor, setDragged });
  useEffect(() => { latest.current = { detents, shown, onRelease, fromBottom, floor, setDragged }; });

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
      to = heightAt(latest.current, from, event.clientY - start.clientY);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; latest.current.setDragged(to); });
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
      letGo(latest.current, to, speed);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // The body under a finger drags the sheet from anywhere on it, as an iOS
  // sheet's scrolling content hands its drag to the sheet, at the pilot's
  // ask: toward opening, the sheet comes out until it is all the way out,
  // and only then does the content scroll; toward closing, the content
  // scrolls back to its start (its end, on a sheet from the top) and from
  // there the sheet goes -- where a drag at the top of the nav log pulled
  // the page's rubber band and the sheet stayed where it was. Decided at
  // the finger's first move, the one a page can still take from the
  // browser's scrolling: the Touch Events spec has a touchmove's
  // preventDefault stop a scroll on the first touchmove only, and Chrome
  // on Android keeps to that (a pointer event has no say at all). A drag
  // sideways, a control with gestures of its own (touch-action none: a
  // map, Favorites' handles), a text area and a slider keep theirs; a
  // mouse drags the head and the grabber alone, as a drag across the body
  // selects its words.
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!body) return;
    // Whether the sheet takes a drag on `target` that went `dy` down the
    // screen.
    const sheetTakes = (target: Element, dy: number) => {
      const { detents: d, shown: now, fromBottom: bottom } = latest.current;
      for (let el: Element | null = target; el && el !== body; el = el.parentElement) {
        if (el.matches("textarea, input[type=range], [contenteditable=true]") || getComputedStyle(el).touchAction === "none") return false;
      }
      if (bottom ? dy < 0 : dy > 0) return now < Math.max(...Object.values<number>(d)) - 1;
      for (let el: Element | null = target; el && el !== body.parentElement; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)
          && (bottom ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return false;
      }
      return true;
    };
    let gesture: {
      x: number; y: number; from: number; target: Element;
      sheet: boolean | null; moved: boolean; to: number; last: number; at: number; speed: number;
    } | null = null;
    let frame = 0;
    const start = (event: TouchEvent) => {
      // A finger landing on a drag that has begun is a pinch: let the sheet
      // go to its detent now, as no touchmove of one finger is left to.
      if (gesture?.moved) letGo(latest.current, gesture.to, 0);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const touch = event.touches[0];
      gesture = touch && event.touches.length === 1 && event.target instanceof Element ? {
        x: touch.clientX, y: touch.clientY, from: latest.current.shown, target: event.target,
        sheet: null, moved: false, to: latest.current.shown, last: touch.clientY, at: event.timeStamp, speed: 0,
      } : null;
    };
    const move = (event: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      // A second finger: a pinch, not the sheet's.
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) {
        gesture = null;
        if (g.moved) letGo(latest.current, g.to, 0);
        return;
      }
      const dx = touch.clientX - g.x, dy = touch.clientY - g.y;
      // A first move that went nowhere says nothing of the direction.
      if (g.sheet === null && dx === 0 && dy === 0) return;
      if (g.sheet === null) {
        g.sheet =Math.abs(dy) > Math.abs(dx) && sheetTakes(g.target, dy);
        if (!g.sheet) {
          gesture = null;
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      if (!g.moved && Math.abs(dy) < DRAG_SLOP) return;
      g.moved = true;
      g.speed = (latest.current.fromBottom ? -1 : 1) * (touch.clientY - g.last) / Math.max(event.timeStamp - g.at, 1);
      g.last = touch.clientY;
      g.at = event.timeStamp;
      g.to = heightAt(latest.current, g.from, dy);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (gesture) latest.current.setDragged(gesture.to); });
    };
    const end = (event: TouchEvent) => {
      const g = gesture;
      gesture = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!g?.moved) return;
      // No click from the release: the drag was the sheet's.
      if (event.cancelable) event.preventDefault();
      letGo(latest.current, g.to, event.type === "touchend" ? g.speed : 0);
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
