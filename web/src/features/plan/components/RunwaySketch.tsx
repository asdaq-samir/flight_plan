import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Runway } from "../../../lib/api/types";
import { FT_PER_NM, stripsOf } from "../../../lib/runwaySketch";

/** Round the runways, in the box's own points: the strips' half width and
 *  a little air. */
const MARGIN = 8;

/**
 * A sketch of the field's runways, north up and to scale, as a diagram
 * draws them -- dark strips with a dashed centre line, and nothing else,
 * the runways alone at the pilot's ask: the FAA's diagram cropped to the
 * card's box was a scatter of its lettering, and the ends' numbers, tried
 * beside them, took the room the runways needed in a box that size (the
 * Runways tab and the diagram have them). Drawn in the box's own points,
 * whatever its shape, so the field fills it. Nothing where no runway can
 * be drawn.
 */
export function RunwaySketch({ runways, lat, lon }: { runways: Runway[]; lat: number; lon: number }) {
  const box = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const parent = box.current?.parentElement;
    if (!parent) return;
    const measure = () => setSize({ w: parent.clientWidth, h: parent.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const drawn = useMemo(() => {
    const strips = stripsOf(runways, lat, lon);
    if (!strips.length || !size || size.w < 2 * MARGIN || size.h < 2 * MARGIN) return null;
    const { w, h } = size;
    const xs = strips.flatMap(s => [s.a[0], s.b[0]]), ys = strips.flatMap(s => [s.a[1], s.b[1]]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Nautical miles to points, the same both ways (to scale), the whole
    // field inside the margin.
    const scale = Math.min((w - 2 * MARGIN) / Math.max(maxX - minX, 1e-3), (h - 2 * MARGIN) / Math.max(maxY - minY, 1e-3));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const at = ([x, y]: [number, number]): [number, number] => [w / 2 + (x - cx) * scale, h / 2 - (y - cy) * scale];
    const placed = strips.map(s => {
      const [ax, ay] = at(s.a), [bx, by] = at(s.b);
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const [ux, uy] = [(bx - ax) / length, (by - ay) / length];
      // Wide enough to read at this size, whatever the field's scale.
      const width = Math.max(4, Math.min(10, (s.width_ft / FT_PER_NM) * scale * 3));
      return { ...s, ax, ay, bx, by, ux, uy, width };
    });
    return { w, h, strips: placed };
  }, [runways, lat, lon, size]);
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
          <line
            x1={s.ax + s.ux * 3} y1={s.ay + s.uy * 3} x2={s.bx - s.ux * 3} y2={s.by - s.uy * 3}
            className="stroke-background" strokeWidth={0.9} strokeDasharray="3.5 3"
          />
        </g>
      ))}
    </svg>
  );
}
