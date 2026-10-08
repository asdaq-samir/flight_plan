import { useCallback, useState } from "react";
import { flushSync } from "react-dom";

/** An element's room: its content box's width and the CSS font it is set
 *  in ("600 17px Inter Variable"), for words to be measured against it
 *  (lib/textWidth) and cut or rounded to fit -- again whenever its width
 *  changes, and once the page's font has loaded. Null until it is in the
 *  page.
 *
 *  First measured as the frame is laid out: a ResizeObserver reports an
 *  element's first size after the page's layout and before its paint,
 *  and the words are drawn again then and there (flushSync), so the first
 *  frame drawn is already measured. It was measured in the ref, in the
 *  middle of React's commit, which laid out the whole page there and
 *  again for the frame -- a third of a second of a phone's, at 4x, as a
 *  route came in from Fly Here (measured 2026-10-08). */
export function useRoom<T extends HTMLElement>(): [(el: T | null) => void, { width: number; font: string } | null] {
  const [room, setRoom] = useState<{ width: number; font: string } | null>(null);
  const watch = useCallback((el: T | null) => {
    if (!el) return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const s = getComputedStyle(el);
      const next = {
        width: el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
        font: `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`,
      };
      setRoom(was => (was && was.width === next.width && was.font === next.font ? was : next));
    };
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(el);
    // And once the page's font is in, where it was still coming: the same
    // room, but the words measured again in the font itself. Only then --
    // the fonts long in, this ran just after the commit all the same and
    // laid the page out there.
    if (document.fonts?.status === "loading") {
      void document.fonts.ready.then(() => { if (live) setRoom(was => was && { ...was }); });
    }
    return () => { live = false; observer.disconnect(); };
  }, []);
  return [watch, room];
}
