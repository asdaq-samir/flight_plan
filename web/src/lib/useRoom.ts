import { useCallback, useState } from "react";

/** An element's room: its content box's width and the CSS font it is set
 *  in ("600 17px Inter Variable"), for words to be measured against it
 *  (lib/textWidth) and cut or rounded to fit -- again whenever its width
 *  changes, and once the page's font has loaded. Null until it is in the
 *  page. The ref is a callback, so the first frame drawn is already
 *  measured. */
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
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    void document.fonts?.ready.then(measure);
    return () => { live = false; observer.disconnect(); };
  }, []);
  return [watch, room];
}
