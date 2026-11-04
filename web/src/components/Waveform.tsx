import { useEffect, useRef } from "react";
import { cn } from "cn";
import { inputLevel } from "../lib/atcRadio";

/** Each bar's share of the level, the middle one tallest, as Siri's. */
const SHAPE = [0.55, 0.8, 1, 0.8, 0.55];
/** The resting height, as the `wave` keyframes start. */
const REST = "scaleY(0.4)";

/**
 * The five bars that rise and fall while the microphone listens, in the
 * tint, as Siri's do (index.css's `wave` keyframes): in the mic's own
 * circle while it listens (RadioButton), where the glyph was.
 *
 * `live`, and while lib/audioInput meters an input (lib/atcRadio's
 * inputLevel), the bars are the sound itself, so a pilot can tell no
 * radio reaching the phone from the recognizer missing it (the owner's
 * Bluetooth ask, 2026-11-04). Written through refs, ten times a second,
 * re-rendering nothing; with no input metered, the bars' own loop.
 */
export default function Waveform({ live = false, className }: { live?: boolean; className?: string }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    if (!live) return;
    const els = bars.current;
    const rest = () => els.forEach(el => {
      if (!el) return;
      el.style.animation = "";
      el.style.transform = REST;
    });
    const off = inputLevel.listen(level => {
      if (level === null) {
        rest();
        return;
      }
      els.forEach((el, i) => {
        if (!el) return;
        el.style.animation = "none";
        el.style.transform = `scaleY(${(0.15 + 0.85 * level * SHAPE[i]!).toFixed(3)})`;
      });
    });
    return () => {
      off();
      rest();
    };
  }, [live]);
  return (
    <span className={cn("flex h-5 items-center gap-0.5", className)} aria-hidden="true" data-testid="waveform">
      {SHAPE.map((_, i) => (
        <span
          key={i} ref={el => { bars.current[i] = el; }}
          className="h-full w-1 origin-center rounded-full bg-tint motion-safe:animate-[wave_0.9s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.12}s`, transform: REST }}
        />
      ))}
    </span>
  );
}
