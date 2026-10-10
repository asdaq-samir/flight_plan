import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "cn";
import { TITLE_DOWN_TO_FOOTNOTE } from "../lib/text";

/**
 * Text that keeps to the box it is given, as iOS's
 * adjustsFontSizeToFitWidth keeps a label to its frame: set a text style
 * smaller at a time, each on its own leading as iOS sets it (`steps`),
 * until it fits the box's height and width -- the smallest where nothing
 * does, the text cut at the box's edge. A word is kept whole while a
 * smaller size fits it: one too long for the box's width counts as not
 * fitting, where a box that breaks words (break-words) broke it instead,
 * "Internation / al" at the size above; broken only at the smallest. The box stays the size it is
 * whatever the text: at the pilot's ask, an airport's card keeps its
 * layout and only the name's size changes. Its own class's style first;
 * fitted again at each draw (the text may have changed) and as the box
 * changes size (a rotation, a larger text size).
 */
export function FitText({ steps = TITLE_DOWN_TO_FOOTNOTE, className, ...props }: ComponentProps<"span"> & {
  /** The styles it may be set in, largest first, as [size, leading] in rem. */
  steps?: [number, number][];
}) {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      el.style.lineHeight = "";
      el.style.overflowWrap = "normal";
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const own = parseFloat(getComputedStyle(el).fontSize) / root;
      const over = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      for (const [size, leading] of steps) {
        if (!over()) return;
        if (size >= own - 0.001) continue;
        el.style.fontSize = `${size}rem`;
        el.style.lineHeight = `${leading}rem`;
      }
      // Nothing fits it whole: broken, as the box would break it.
      if (over()) el.style.overflowWrap = "";
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  });
  return <span ref={box} className={cn("block overflow-hidden", className)} {...props} />;
}
