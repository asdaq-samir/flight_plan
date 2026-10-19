import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "cn";
import { usePanelDragging } from "./mapChrome";
import { useRoom } from "../lib/useRoom";

/** As small as a figure is set to fit before it is cut short: three
 *  quarters, 15 points at the default size, the body's. */
const SMALLEST = 0.75;

interface Fitted {
  value: string;
  unit?: string;
}

/** Each figure on its own: the one that does not fit its column rounded,
 *  the rest as they are. */
export function fitFigures<F>(exact: F[], rounded: F[], fits: (f: F, i: number) => boolean): F[] {
  return exact.map((f, i) => (fits(f, i) ? f : rounded[i] ?? f));
}

/**
 * A strip of figures fitted to their columns, the flight's (FlightLine) and
 * a dry run's (FigureStrip) alike: each figure as it is while it fits its
 * column; where one does not (a long trip's "2636.8 nm" at a large text
 * size, an iPhone SE's narrow columns), that one rounded (`rounded`, the
 * caller's: up, so none is ever said short of what it is). Where a rounded
 * one still does not fit, the strip's figures are set smaller together,
 * figures and units, as iOS shrinks a label to fit its width (UILabel's
 * adjustsFontSizeToFitWidth), down to three quarters, and only past that
 * cut short. A dry run's "1052.4 nm" left was cut to "1052.…" all the way
 * up, where it had no fit of its own (the owner's recording, 2026-10-19).
 *
 * Measured as the page sets it, in hidden words of the figures' own type
 * (`probes`), against the first figure's room (`room`), as wide as each
 * column: measured on a canvas, in the font as it was named, the iPhone's
 * figures came out narrower than they are (2026-10-10). Not while a finger
 * takes the sheet: the figures grow with it past half, and fitted again at
 * every frame a drag above half went at half the frame rate. Fitted once
 * at rest, and again only as the figures or the room change.
 */
export function useFigureFit<F extends Fitted>(exact: F[], rounded: F[], valueType: string, unitType: string): {
  room: (el: HTMLElement | null) => void;
  shown: F[];
  sized: (part: "value" | "unit") => CSSProperties | undefined;
  /** Marked where set smaller to fit, for the iOS audit's type scale. */
  fitted: "" | undefined;
  probes: ReactNode;
} {
  const [room, space] = useRoom<HTMLElement>();
  const probe = useRef<HTMLSpanElement>(null);
  const unitProbe = useRef<HTMLSpanElement>(null);
  const key = exact.map(f => `${f.value}${f.unit ?? ""}`).join("|");
  const moving = usePanelDragging(d => d.dragging);
  const [verdict, setVerdict] = useState<{ key: string; room: typeof space; fits: boolean[]; scale: number; px: { value: number; unit: number } } | null>(null);
  // The room itself is kept, not its width: useRoom hands out a new one
  // when the width or the font changes, and once the web font is in (same
  // width, same font name), and each of those moves the figures' widths.
  useLayoutEffect(() => {
    const value = probe.current, unit = unitProbe.current;
    if (moving || !space || !value || !unit || (verdict?.key === key && verdict.room === space)) return;
    value.style.fontSize = unit.style.fontSize = "";
    const px = { value: parseFloat(getComputedStyle(value).fontSize), unit: parseFloat(getComputedStyle(unit).fontSize) };
    const width = (f: F, scale: number) => {
      value.style.fontSize = scale < 1 ? `${px.value * scale}px` : "";
      unit.style.fontSize = scale < 1 ? `${px.unit * scale}px` : "";
      value.textContent = f.value;
      unit.textContent = f.unit ? ` ${f.unit}` : "";
      return value.getBoundingClientRect().width + unit.getBoundingClientRect().width;
    };
    const fitsAt = (f: F, scale: number) => width(f, scale) <= space.width + 0.5;
    const fits = exact.map(f => fitsAt(f, 1));
    // The size the widest of the figures shown fits at, each figure and
    // its unit alike, measured at that size: Inter's optical sizes set a
    // smaller size a little wider than its share, so the straight
    // proportion is only where the search starts.
    let scale = 1;
    for (const f of fitFigures(exact, rounded, (_, i) => fits[i]!)) {
      if (fitsAt(f, scale)) continue;
      scale = Math.max(SMALLEST, Math.floor((scale * space.width) / width(f, scale) * 100) / 100);
      while (scale > SMALLEST && !fitsAt(f, scale)) scale = Math.max(SMALLEST, Math.round((scale - 0.01) * 100) / 100);
    }
    value.style.fontSize = unit.style.fontSize = "";
    setVerdict({ key, room: space, fits, scale, px });
  }, [space, key, exact, rounded, verdict, moving]);
  const fitting = verdict?.key === key && verdict.room === space ? verdict : null;
  const shown = fitFigures(exact, rounded, (_, i) => fitting?.fits[i] ?? true);
  const sized = (part: "value" | "unit") =>
    fitting && fitting.scale < 1 ? { fontSize: `${(fitting.px[part] * fitting.scale).toFixed(2)}px` } : undefined;
  return {
    room, shown, sized, fitted: fitting && fitting.scale < 1 ? "" : undefined,
    probes: (
      <span aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap">
        <span ref={probe} className={cn(valueType, "font-semibold tabular-nums")} />
        <span ref={unitProbe} className={cn(unitType, "font-normal")} />
      </span>
    ),
  };
}
