import { useEffect, useRef, useState } from "react";
import PullTab from "./PullTab";
import { useDragHandle } from "../lib/useDragHandle";

/**
 * A failure, full-width across the bottom of the page -- drag the
 * handle down to reveal less, up to reveal more, continuously, the
 * same physics (`useDragHandle`) the route toolbar's own drawer uses
 * at the top, just mirrored (this one grows upward from the bottom
 * edge rather than downward from the top). One height value, not an
 * open/closed boolean with its own snap threshold, for the same
 * reason the toolbar isn't one either -- a discrete swap partway
 * through a drag reads as the drawer jumping, not following the
 * finger.
 *
 * Unlike the toolbar, this doesn't always start collapsed: a pilot
 * still needs to actually notice a new failure, so it opens itself
 * the moment one arrives and only then behaves exactly like the
 * toolbar's drawer -- free to drag closed, and to drag open again.
 * This component stays mounted for the page's life (the callers don't
 * unmount it between errors), so "a new failure arrives" is detected
 * by watching `message` go from null to not, the same as a fresh
 * mount would.
 */
interface Props {
  message: string | null;
  /** Fired whenever the dragged height changes -- purely a report, not
   *  control: height stays this component's own state. The map (or
   *  the nav log table) behind this needs to know how much of the
   *  bottom it's lost, so it can actually shrink to fit above the
   *  drawer instead of just being covered by it. */
  onHeightChange?: (height: number) => void;
}

export default function ErrorTab({ message, onHeightChange }: Props) {
  const content = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(0);
  const wasVisible = useRef(false);

  // Keyed on `!!message`, not `[]`: this component renders nothing at
  // all (the early return below) until the first error exists, so the
  // ref never has a real element to observe on the initial mount --
  // only once `message` actually flips to non-null does the div with
  // `ref={content}` exist for this effect to find.
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => setMaxHeight(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!message]);

  // Anchored to the bottom, growing upward -- dragging up is what
  // should increase height, the opposite sign from the toolbar's own
  // top-anchored drawer.
  const { size: height, setSize: setHeight, startDrag, onKeyDown } = useDragHandle({
    axis: "y", sign: -1, maxSize: maxHeight,
  });

  // A fresh failure pops the drawer open on its own; a change to the
  // same ongoing failure's text (only the request id ticking over, an
  // updated stack) doesn't re-open something the pilot already closed.
  // Split into two effects on purpose: the transition itself (message
  // arriving) can happen before `maxHeight` has ever been measured
  // (still 0 on the very first render), so the actual "open to
  // maxHeight" has to wait for a real measurement instead of firing
  // once with whatever maxHeight happened to be at that same instant.
  const pendingOpen = useRef(false);

  useEffect(() => {
    if (message && !wasVisible.current) pendingOpen.current = true;
    wasVisible.current = !!message;
  }, [!!message]);

  useEffect(() => {
    if (pendingOpen.current && maxHeight > 0) {
      setHeight(maxHeight);
      pendingOpen.current = false;
    }
  }, [maxHeight, setHeight]);

  // `message ? height : 0`, not just `height`: once the error clears,
  // this returns null below and stops rendering entirely, but `height`
  // itself is still whatever it last was -- without the `message`
  // check here, the map stays shrunk by a drawer that's no longer
  // even on screen.
  useEffect(() => { onHeightChange?.(message ? height : 0); }, [height, message, onHeightChange]);

  if (!message) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-[1000] flex flex-col">
      <div className="flex flex-shrink-0 items-center justify-center py-1">
        {/* w-fit, not the full-width row the toolbar's own handle uses
            -- that row is otherwise empty on either side of the tab, so
            an edge-to-edge grab strip there is free real estate. This
            one spans the whole page, and everything on it at that
            height (the map underneath, anything else docked nearby)
            would end up under the same invisible strip too -- so only
            the tab itself is draggable here, inset-0 against this
            wrapper's own bounds rather than past them: no slack beyond
            the pill, since any of that space beside the pill reads as
            unrelated, ordinary space until a drag on it turns out to
            resize the drawer anyway. */}
        <div className="group relative w-fit">
          <div className="pointer-events-none transition-opacity group-hover:opacity-90 group-active:opacity-75">
            <PullTab orientation="horizontal" tone="red" />
          </div>
          <div
            onPointerDown={startDrag}
            onKeyDown={onKeyDown}
            role="slider"
            tabIndex={0}
            aria-label="Resize the error drawer"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={maxHeight}
            aria-valuenow={height}
            title="Drag or use arrow keys to resize"
            data-testid="error-handle"
            className="absolute inset-0 z-10 cursor-row-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-300"
          />
        </div>
      </div>
      <div
        style={{ height }}
        data-testid="error-content"
        className={`overflow-x-hidden overflow-y-auto bg-red-800 ${height > 0 ? "shadow-[0_-2px_10px_rgba(0,0,0,.25)]" : ""}`}
      >
        <div ref={content} className="px-4 py-2 text-sm text-white">
          {message}
        </div>
      </div>
    </div>
  );
}
