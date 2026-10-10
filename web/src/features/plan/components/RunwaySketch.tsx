import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Runway } from "../../../lib/api/types";
import { FT_PER_NM, stripsOf } from "../../../lib/runwaySketch";

/** Round the runways, in the box's own points: the strips' half width and
 *  a little air. */
const MARGIN = 8;

/** Turf, green as the grass it is, at the pilot's ask: a shade that
 *  reads beside the paved strips' ink on the card's glass in either
 *  scheme. */
const TURF = "#3f8f3a";

type Hole = { x: number; y: number; w: number; h: number };

/** Half a runway number's width in its bold digits, about 0.62 of its
 *  size a character, and a point of air. */
function numberHalfWidth(characters: number, size: number): number {
  return (characters * 0.62 * size) / 2 + 1;
}

/**
 * Where each end's number is written: just past its end along the
 * runway, or a little further out where a number already written is
 * there -- a field of close parallels (O'Hare's 09C and 09R) set its
 * numbers on one another -- the longest runways' first. A number with no
 * clear place near its end is left off, rather than written over another
 * or out where it reads as no runway's.
 */
function numbersOf(
  strips: { ends: [string, string]; closed: boolean; ax: number; ay: number; bx: number; by: number; ux: number; uy: number }[],
  size: number, gap: number, w: number, h: number,
) {
  const taken: { x: number; y: number; hw: number; hh: number }[] = [];
  const written: { end: string; key: string; x: number; y: number; closed: boolean }[] = [];
  const byLength = [...strips].sort((p, q) => Math.hypot(q.bx - q.ax, q.by - q.ay) - Math.hypot(p.bx - p.ax, p.by - p.ay));
  for (const s of byLength) {
    s.ends.forEach((end, i) => {
      // Outward from this end: back along the runway from its first end,
      // on from its second.
      const [ex, ey, dx, dy] = i === 0 ? [s.ax, s.ay, -s.ux, -s.uy] : [s.bx, s.by, s.ux, s.uy];
      const hw = numberHalfWidth(end.length, size), hh = size / 2;
      for (const out of [gap, gap + size * 1.2]) {
        const x = ex + dx * out, y = ey + dy * out;
        const inBox = x - hw >= 0 && x + hw <= w && y - hh >= 0 && y + hh <= h;
        if (!inBox || taken.some(t => Math.abs(t.x - x) < t.hw + hw && Math.abs(t.y - y) < t.hh + hh)) continue;
        taken.push({ x, y, hw, hh });
        written.push({ end, key: `${s.ends.join("/")}-${end}`, x, y, closed: s.closed });
        return;
      }
    });
  }
  return written;
}

/** What of a runway is not its turf, as fractions of it from end to end. */
function pavedOf(turf: [number, number][]): [number, number][] {
  const paved: [number, number][] = [];
  let at = 0;
  for (const [from, to] of [...turf].sort((a, b) => a[0] - b[0])) {
    if (from > at) paved.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < 1) paved.push([at, 1]);
  return paved;
}

/**
 * A sketch of the field's runways, north up and to scale, as a diagram
 * draws them -- dark strips with a dashed centre line, green where they
 * are turf -- and each end's number just past it, upright, at the
 * pilot's ask: they were left off once for the room they took in the
 * card's box, and the box gives that room now, the runways a little
 * shorter for it. Drawn in the box's own points, whatever its shape, so
 * the field fills it. Nothing where no runway can be drawn.
 */
export function RunwaySketch({ runways, lat, lon, avoid, numberSize = 11 }: {
  runways: Runway[]; lat: number; lon: number;
  /** A pane laid over the box (the elevation): nothing is drawn under it. */
  avoid?: HTMLElement | null;
  /** The ends' numbers' size, points: TEXT.caption's 11 (iOS's Caption 2)
   *  in the card's box, a row's 17 full screen (SketchViewer). */
  numberSize?: number;
}) {
  const box = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; hole: Hole | null } | null>(null);
  useLayoutEffect(() => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    const measure = () => setSize({
      w: parent.clientWidth, h: parent.clientHeight,
      hole: avoid ? { x: avoid.offsetLeft, y: avoid.offsetTop, w: avoid.offsetWidth, h: avoid.offsetHeight } : null,
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    if (avoid) observer.observe(avoid);
    return () => observer.disconnect();
  }, [avoid]);
  const drawn = useMemo(() => {
    const strips = stripsOf(runways, lat, lon);
    if (!strips.length || !size || size.w < 2 * MARGIN || size.h < 2 * MARGIN) return null;
    const { w, h } = size;
    const xs = strips.flatMap(s => [s.a[0], s.b[0]]), ys = strips.flatMap(s => [s.a[1], s.b[1]]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Each end's number, its middle this far past the end along the
    // runway: clear of the strip whichever way it runs.
    const gap = numberSize * 0.9 + 2;
    // Nautical miles to points, the same both ways (to scale), the whole
    // field inside the margin and the numbers past its ends inside the
    // box, and off its edge: the widest number's half past the gap, and
    // half the margin's air.
    const widest = Math.max(...strips.flatMap(s => s.ends.map(e => e.length)));
    const margin = gap + numberHalfWidth(widest, numberSize) + MARGIN / 2;
    const fit = Math.min((w - 2 * margin) / Math.max(maxX - minX, 1e-3), (h - 2 * margin) / Math.max(maxY - minY, 1e-3));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const atScale = (k: number) => ([x, y]: [number, number]): [number, number] => [w / 2 + (x - cx) * k, h / 2 - (y - cy) * k];
    const place = (k: number) => strips.map(s => {
      const to = atScale(k);
      const [ax, ay] = to(s.a), [bx, by] = to(s.b);
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const [ux, uy] = [(bx - ax) / length, (by - ay) / length];
      const na: [number, number] = [ax - ux * gap, ay - uy * gap], nb: [number, number] = [bx + ux * gap, by + uy * gap];
      return { ax, ay, bx, by, ux, uy, na, nb };
    });
    // A runway or a number that reaches the pane's corner is drawn smaller
    // about the box's centre until it clears it, so the pane never hides
    // a runway end or its number.
    let scale = fit;
    if (size.hole) {
      const hole = size.hole;
      const pad = MARGIN / 2;
      const inHole = (x: number, y: number, rx = 0, ry = 0) =>
        x + rx > hole.x - pad && x - rx < hole.x + hole.w + pad && y + ry > hole.y - pad && y - ry < hole.y + hole.h + pad;
      const under = (k: number) => place(k).some(s => {
        for (let t = 0; t <= 1; t += 1 / 24) {
          if (inHole(s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t)) return true;
        }
        return [s.na, s.nb].some(([x, y]) => inHole(x, y, numberSize * 0.9, numberSize * 0.6));
      });
      while (under(scale) && scale > fit / 4) scale *= 0.95;
    }
    const placed = place(scale).map((p, i) => {
      const s = strips[i]!;
      // Wide enough to read at this size, whatever the field's scale.
      const width = Math.max(4, Math.min(10, (s.width_ft / FT_PER_NM) * scale * 3));
      return { ...s, ...p, width };
    });
    return { w, h, strips: placed, numbers: numbersOf(placed, numberSize, gap, w, h) };
  }, [runways, lat, lon, size, numberSize]);
  return (
    <svg
      // Out of the flow, the box's size its own: an SVG's own default
      // size (150 tall) made the box that tall.
      ref={box} viewBox={drawn ? `0 0 ${drawn.w} ${drawn.h}` : undefined} className="absolute inset-0 size-full"
      aria-hidden="true"
      data-testid="runway-sketch"
    >
      {drawn?.strips.map(s => (
        <g key={s.ends.join("/")} opacity={s.closed ? 0.35 : 1}>
          <line x1={s.ax} y1={s.ay} x2={s.bx} y2={s.by} stroke="currentColor" strokeWidth={s.width} />
          {/* Its turf over the paving, the part the remarks say (C81's
              south-west 1,000 ft), or all of a turf runway. */}
          {s.turf.map(([from, to]) => (
            <line
              key={`${from}-${to}`} data-turf=""
              x1={s.ax + (s.bx - s.ax) * from} y1={s.ay + (s.by - s.ay) * from}
              x2={s.ax + (s.bx - s.ax) * to} y2={s.ay + (s.by - s.ay) * to}
              stroke={TURF} strokeWidth={s.width}
            />
          ))}
          {/* A dotted line of light down the turf, so it is told from
              paving by its texture and not by its green alone. */}
          {s.turf.map(([from, to]) => (
            <line
              key={`dots-${from}-${to}`}
              x1={s.ax + (s.bx - s.ax) * from} y1={s.ay + (s.by - s.ay) * from}
              x2={s.ax + (s.bx - s.ax) * to} y2={s.ay + (s.by - s.ay) * to}
              stroke="white" strokeOpacity={0.7} strokeWidth={Math.max(1, s.width / 4)} strokeDasharray="1 3" strokeLinecap="round"
            />
          ))}
          {/* The centre line on the paving alone: grass has none painted. */}
          {pavedOf(s.turf).map(([from, to]) => (
            <line
              key={`${from}-${to}`}
              x1={s.ax + (s.bx - s.ax) * from + s.ux * 3} y1={s.ay + (s.by - s.ay) * from + s.uy * 3}
              x2={s.ax + (s.bx - s.ax) * to - s.ux * 3} y2={s.ay + (s.by - s.ay) * to - s.uy * 3}
              className="stroke-background" strokeWidth={0.9} strokeDasharray="3.5 3"
            />
          ))}
        </g>
      ))}
      {/* Each end's number past it, upright, over every strip, in the
          strips' ink with a casing of the box's ground so a crossing
          runway does not cut through it. */}
      {drawn?.numbers.map(n => (
        <text
          key={n.key} x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" data-runway-end={n.end}
          fontSize={numberSize} fontWeight={700} fill="currentColor" opacity={n.closed ? 0.35 : 1}
          className="stroke-background" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round"
        >
          {n.end}
        </text>
      ))}
    </svg>
  );
}
