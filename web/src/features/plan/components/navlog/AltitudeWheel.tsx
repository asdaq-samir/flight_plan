import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "cn";
import { TEXT } from "../../../../lib/text";

/** A row's height, px: iOS's 44-point touch target, a picker's row. */
const ROW = 44;
/** Rows in sight: the one picked in the middle, two either side. */
const SHOWN = 5;

const feet = (ft: number) => ft.toLocaleString("en-US");

/**
 * The cruise altitudes the route may fly as a wheel, at the owner's pick
 * (2026-10-20): only the legal ones, highest first as iOS's picker reads,
 * the one in the middle band picked, each plan's name under its altitude.
 * A finger scrolls it and it comes to rest on a row (CSS scroll snap); a
 * tap on a row brings it to the middle. To VoiceOver and the keyboard a
 * slider: up and down step one altitude, as an adjustable control does.
 */
export default function AltitudeWheel({ altitudes, value, onChange, names = {} }: {
  /** Highest first. */
  altitudes: number[];
  value: number;
  onChange: (altitude: number) => void;
  /** A plan's name for an altitude it flies ("Fastest"). */
  names?: Record<number, string>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const index = Math.max(0, altitudes.indexOf(value));
  // Where it was last put by a scroll, so a value that came from the
  // wheel itself is not scrolled to again under the finger.
  const fromScroll = useRef<number | null>(null);
  const smooth = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

  // At once on opening, the picked altitude in the middle.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = index * ROW;
    // Only as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A value set from outside (a plan picked, a figure typed): taken there.
  useEffect(() => {
    if (fromScroll.current === value || !scroller.current) return;
    scroller.current.scrollTo({ top: index * ROW, behavior: smooth() });
  }, [value, index]);

  const toRow = (i: number) => {
    const at = Math.max(0, Math.min(altitudes.length - 1, i));
    scroller.current?.scrollTo({ top: at * ROW, behavior: smooth() });
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const i = Math.max(0, Math.min(altitudes.length - 1, Math.round(el.scrollTop / ROW)));
    const altitude = altitudes[i]!;
    if (altitude !== value) {
      fromScroll.current = altitude;
      onChange(altitude);
    }
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!by) return;
    event.preventDefault();
    toRow(index + by);
  };
  return (
    <div
      role="slider" tabIndex={0} aria-label="Cruise altitude" aria-orientation="vertical"
      aria-valuemin={altitudes.at(-1)} aria-valuemax={altitudes[0]} aria-valuenow={value}
      aria-valuetext={`${feet(value)} feet${names[value] ? `, ${names[value]}` : ""}`}
      onKeyDown={step}
      className="relative w-28 shrink-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ height: ROW * SHOWN }}
      data-testid="altitude-wheel"
    >
      {/* The middle band, as iOS's picker marks the row picked. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 rounded-lg bg-foreground/8" style={{ top: ROW * 2, height: ROW }} />
      <div
        ref={scroller} onScroll={onScroll} aria-hidden="true"
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ paddingBlock: ROW * 2 }}
      >
        {altitudes.map((altitude, i) => {
          const on = altitude === value;
          return (
            <button
              key={altitude} type="button" tabIndex={-1} onClick={() => toRow(i)}
              className="flex w-full snap-center flex-col items-center justify-center leading-tight"
              style={{ height: ROW }}
              data-testid="altitude-wheel-row" data-altitude={altitude}
            >
              <span className={cn("tabular-nums", on ? cn("font-semibold text-foreground", TEXT.row) : cn("text-muted-foreground", TEXT.detail))}>
                {feet(altitude)}
              </span>
              {names[altitude] && (
                <span className={cn("font-semibold", TEXT.note, on ? "text-tint" : "text-muted-foreground")}>{names[altitude]}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
