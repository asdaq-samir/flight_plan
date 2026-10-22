import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * The tab up drawn out of one line of glass, at the owner's pick of the
 * tab bar's looks (2e, 2026-10-22: "Let's try 2e first"): a stroke of
 * clear glass's lit rim along under the tabs, rising over the tab up --
 * its sides, round shoulders at the top, feet that flare down onto the
 * line -- the tab filled with clear glass, its light at the top. No grey
 * line under the bar: this is it. The tab slides with the tab up, the
 * line opening under it, at the bar's own pace (`transition`).
 *
 * Its own height past the bar's top (the parent's -top-[3px]) leaves six
 * points of glass over the icon and four clear of the grabber; the feet
 * meet the line at the tab's own edges, so the line runs from the panel's
 * side to the tab and on from it to the other.
 */
export default function TabGlass({ at, count, transition }: {
  /** The tab up, from the left. */
  at: number;
  count: number;
  /** The bar's own easing, so the tab and the line move as the bubble did. */
  transition: string;
}) {
  const cell = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = cell.current;
    if (!el) return;
    const measure = () => setSize(s => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const id = useId().replace(/:/g, "");
  const { w, h } = size;
  // The body in from the cell's sides by its feet's width; round shoulders.
  const foot = Math.min(11, w * 0.12), shoulder = 12, top = 1, base = h - 0.75;
  const rim = w > 0 ? [
    `M0 ${base}`, `C${foot - 3} ${base} ${foot} ${base - 3} ${foot} ${base - foot}`,
    `L${foot} ${top + shoulder}`, `C${foot} ${top + shoulder * 0.45} ${foot + shoulder * 0.45} ${top} ${foot + shoulder} ${top}`,
    `L${w - foot - shoulder} ${top}`, `C${w - foot - shoulder * 0.45} ${top} ${w - foot} ${top + shoulder * 0.45} ${w - foot} ${top + shoulder}`,
    `L${w - foot} ${base - foot}`, `C${w - foot} ${base - 3} ${w - foot + 3} ${base} ${w} ${base}`,
  ].join(" ") : "";
  const moves: CSSProperties = { transition };
  return (
    <div aria-hidden="true" data-testid="tab-bubble" className="pointer-events-none absolute inset-x-0 -top-[3px] bottom-0">
      {/* The line either side of the tab up, out to the panel's sides. */}
      <span
        className="absolute bottom-0 -left-2 h-[1.5px] bg-white/95 shadow-[0_1px_0_rgb(60_60_67/0.16)] dark:bg-white/40 dark:shadow-[0_1px_0_rgb(0_0_0/0.55)]"
        style={{ ...moves, width: `calc(${at} * 100% / ${count} + 0.5rem)` }}
      />
      <span
        className="absolute bottom-0 -right-2 h-[1.5px] bg-white/95 shadow-[0_1px_0_rgb(60_60_67/0.16)] dark:bg-white/40 dark:shadow-[0_1px_0_rgb(0_0_0/0.55)]"
        style={{ ...moves, left: `calc(${at + 1} * 100% / ${count})` }}
      />
      <div ref={cell} className="absolute inset-y-0" style={{ ...moves, left: `calc(${at} * 100% / ${count})`, width: `calc(100% / ${count})` }}>
        {w > 0 && (
          <svg
            width={w} height={h} viewBox={`0 0 ${w} ${h}`}
            className="absolute inset-0 overflow-visible drop-shadow-[0_-1px_6px_rgb(0_0_0/0.10)] dark:drop-shadow-[0_-1px_8px_rgb(0_0_0/0.45)]"
          >
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="[stop-color:white] [stop-opacity:0.6] dark:[stop-opacity:0.22]" />
                <stop offset="0.7" className="[stop-color:white] [stop-opacity:0.08] dark:[stop-opacity:0.03]" />
              </linearGradient>
            </defs>
            <path d={`${rim} Z`} fill={`url(#${id}-fill)`} />
            {/* A shade a point under the rim, so it reads on the light card. */}
            <path d={rim} fill="none" strokeWidth={1} transform="translate(0 1)" className="stroke-[rgb(60_60_67/0.16)] dark:stroke-black/55" />
            <path d={rim} fill="none" strokeWidth={1.5} className="stroke-white/95 dark:stroke-white/40" />
          </svg>
        )}
      </div>
    </div>
  );
}
