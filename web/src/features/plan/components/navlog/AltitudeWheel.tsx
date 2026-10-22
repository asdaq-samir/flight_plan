import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "cn";
import { prefersReducedMotion } from "../../../../lib/motion";
import { TEXT } from "../../../../lib/text";
import { flightLevel } from "../../../../lib/units";

/** A tick's spacing, px: close enough for the ruler to read as one, a
 *  finger scrolling it rather than tapping a row (each tick's 44-point
 *  target would be a picker's row, the wheel this was). */
const TICK = 28;

/** How long the ruler holds still before its tick is taken, ms: a scroll
 *  sends no end of its own on every browser (Safari's scrollend is new). */
const REST_MS = 120;

const feet = (ft: number) => ft.toLocaleString("en-US");

/**
 * The cruise altitudes the route may fly as a ruler down the side view's
 * left side, at the owner's ask ("make the wheel to be a ruler on the left
 * side? Narrow and elegant", 2026-10-21; a glass wheel in the corner
 * before): only the legal ones, highest at the top as the graph has them,
 * a tick each -- long on the thousands -- and the one under the pointer at
 * the middle picked, a dot where a plan cruises. A finger scrolls it and
 * it comes to rest on a tick (CSS scroll snap); a tap on a tick brings it
 * to the pointer. To VoiceOver and the keyboard a slider: up and down step
 * one altitude, as an adjustable control does.
 */
export default function AltitudeWheel({ altitudes, value, onChange, names = {}, spoken = names }: {
  /** Highest first. */
  altitudes: number[];
  value: number;
  onChange: (altitude: number) => void;
  /** A plan's name for an altitude it flies ("Fastest"). */
  names?: Record<number, string>;
  /** Its names as VoiceOver says them ("Fastest · Lowest"). */
  spoken?: Record<number, string>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const index = Math.max(0, altitudes.indexOf(value));
  // Where it was last put by a scroll, so a value that came from the
  // ruler itself is not scrolled to again under the finger.
  const fromScroll = useRef<number | null>(null);
  const smooth = () => (prefersReducedMotion() ? "auto" : "smooth");

  // At once on opening, the picked altitude at the pointer.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = index * TICK;
    // Only as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A value set from outside (a plan picked, a figure typed): taken there.
  useEffect(() => {
    if (fromScroll.current === value || !scroller.current) return;
    scroller.current.scrollTo({ top: index * TICK, behavior: smooth() });
  }, [value, index]);

  const toTick = (i: number) => {
    const at = Math.max(0, Math.min(altitudes.length - 1, i));
    scroller.current?.scrollTo({ top: at * TICK, behavior: smooth() });
  };
  // The tick under the pointer while the ruler rolls, shown at once and
  // handed on only once it comes to rest, at the owner's notice ("profile
  // altitude selections is not smooth"): each tick passed drew the whole
  // profile again, its graph's line at that altitude, under the finger.
  // Taken as the value is (`against`): once the value moves, it is that.
  const [rolling, setRolling] = useState<{ i: number; against: number } | null>(null);
  const shown = rolling && rolling.against === value ? rolling.i : index;
  const rest = useRef<number | null>(null);
  useEffect(() => () => { if (rest.current !== null) window.clearTimeout(rest.current); }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const i = Math.max(0, Math.min(altitudes.length - 1, Math.round(el.scrollTop / TICK)));
    if (i !== shown) setRolling({ i, against: value });
    if (rest.current !== null) window.clearTimeout(rest.current);
    rest.current = window.setTimeout(() => {
      rest.current = null;
      const altitude = altitudes[i]!;
      if (altitude !== value) {
        fromScroll.current = altitude;
        onChange(altitude);
      }
    }, REST_MS);
  };
  // A tap on a tick brings it to the pointer; on the tick at the pointer it
  // picks it again, as nothing scrolls to say so: a plan's tick at the
  // altitude the pilot typed did nothing (CI, plans.spec, Fastest at 3,500).
  const tap = (event: MouseEvent<HTMLDivElement>) => {
    const tick = (event.target as Element).closest<HTMLElement>("[data-altitude]");
    if (!tick) return;
    const i = altitudes.indexOf(Number(tick.dataset.altitude));
    if (i < 0) return;
    if (i === shown) onChange(altitudes[i]!);
    else toTick(i);
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!by) return;
    event.preventDefault();
    toTick(index + by);
  };
  // The ends scroll to the pointer: half the ruler less half a tick of room
  // before the first and after the last.
  const room = `calc(50% - ${TICK / 2}px)`;
  return (
    <div
      role="slider" tabIndex={0} aria-label="Cruise altitude" aria-orientation="vertical"
      aria-valuemin={altitudes.at(-1)} aria-valuemax={altitudes[0]} aria-valuenow={value}
      aria-valuetext={`${feet(value)} feet${spoken[value] ? `, ${spoken[value]}` : ""}`}
      onKeyDown={step} onClick={tap}
      // Narrow over the graph's left edge, at the owner's ask ("put the
      // ruler over the graph but just make it narrow so it's not taking
      // much space"): a strip of clear glass, the graph showing through,
      // its outer corners the graph's own round ones (rounded-xl), where
      // they stood square over them (the owner's screenshot).
      className="relative h-full w-11 shrink-0 rounded-l-xl rounded-r-lg bg-background/40 outline-none backdrop-blur-[2px] focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="altitude-wheel"
    >
      {/* The pointer: a hairline across at the middle in the tint, a notch
          at the ruler's edge, the graph's cruise line beside it. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px -translate-y-1/2 bg-tint/60" />
      <div aria-hidden="true" className="pointer-events-none absolute top-1/2 right-0 z-10 size-0 -translate-y-1/2 border-y-[5px] border-r-[6px] border-y-transparent border-r-tint" />
      <div
        ref={scroller} onScroll={onScroll} aria-hidden="true"
        // Faded to nothing at its ends, as a picker's rows are.
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [mask-image:linear-gradient(transparent,black_22%,black_78%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div style={{ height: room }} />
        {altitudes.map((altitude, i) => {
          const on = i === shown;
          const thousand = altitude % 1000 === 0;
          return (
            <div
              // Not a button of its own: the ruler is the one control, a
              // tap on a tick taken by it (`tap`), whose 28 points are a
              // ruler's spacing, not a target's.
              key={altitude}
              className="relative flex w-full cursor-pointer snap-center items-center justify-end gap-1 pr-1"
              style={{ height: TICK }}
              data-testid="altitude-wheel-row" data-altitude={altitude}
            >
              {/* A plan's altitude: a dot, its name said, and the picked
                  one's under the graph (altitude-picked). */}
              {names[altitude] && <span className={cn("absolute left-1 size-1 rounded-full", on ? "bg-tint" : "bg-foreground/50")} />}
              <span className="sr-only">{names[altitude]}</span>
              {/* As a flight level, at the owner's pick (AltitudeGroup);
                  said in feet. */}
              <span className={cn("tabular-nums", on ? cn("font-semibold text-tint", TEXT.note) : cn("text-foreground/70", TEXT.note))}>
                {flightLevel(altitude).slice(2)}
              </span>
              <span className={cn("h-px shrink-0 bg-foreground/40", thousand ? "w-2.5" : "w-1.5")} />
            </div>
          );
        })}
        <div style={{ height: room }} />
      </div>
    </div>
  );
}
