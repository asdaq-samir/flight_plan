import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "cn";

/**
 * Text that keeps to the box it is given, as iOS's
 * adjustsFontSizeToFitWidth keeps a label to its frame: its size brought
 * down from its own (its class's) half a point at a time, to `min` at the
 * least, until it fits the box's height and width. The box stays the
 * size it is whatever the text -- at the pilot's ask, an airport's card
 * keeps its layout and only the name's size changes. Fitted again at
 * each draw (the text may have changed) and as the box changes size (a
 * rotation, a larger text size).
 */
export function FitText({ min = 13, className, ...props }: ComponentProps<"span"> & {
  /** The smallest size it is brought down to, in points; below it the
   *  text is cut at the box's edge. */
  min?: number;
}) {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (size > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        size = Math.max(min, size - 0.5);
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  });
  return <span ref={box} className={cn("block overflow-hidden", className)} {...props} />;
}
