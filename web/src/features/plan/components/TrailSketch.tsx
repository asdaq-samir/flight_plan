import { memo } from "react";

/**
 * Where an airplane has flown, drawn small in the airport card's diagram's
 * place, at the owner's pick of the redesign: its trail (its trace, the
 * planner's flight answer) north up, fitted to the box, and an arrowhead
 * where it is now along its track. Plain SVG, no map under it: a shape to
 * recognise, the map behind the card the place.
 */
export default memo(function TrailSketch({ points, now, trackDeg }: {
  points: { lat: number; lon: number }[];
  /** Where it is now, the trail's end where none is heard. */
  now: { lat: number; lon: number } | null;
  trackDeg: number | null;
}) {
  const all = now ? [...points, now] : points;
  if (all.length < 2) return null;
  // North up, east right, a degree of longitude shortened by the latitude.
  const midLat = all.reduce((sum, p) => sum + p.lat, 0) / all.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = all.map(p => p.lon * k), ys = all.map(p => -p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-4);
  const W = 100, H = 100, PAD = 12;
  const x = (v: number) => PAD + ((v - minX) / span) * (W - 2 * PAD) + ((W - 2 * PAD) - ((maxX - minX) / span) * (W - 2 * PAD)) / 2;
  const y = (v: number) => PAD + ((v - minY) / span) * (H - 2 * PAD) + ((H - 2 * PAD) - ((maxY - minY) / span) * (H - 2 * PAD)) / 2;
  const d = all.map((p, i) => `${i ? "L" : "M"}${x(p.lon * k).toFixed(1)} ${y(-p.lat).toFixed(1)}`).join(" ");
  const end = all[all.length - 1]!;
  const ex = x(end.lon * k), ey = y(-end.lat);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden="true" data-testid="trail-sketch">
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path
        d="M0 -6 L4.5 5 L0 2.5 L-4.5 5 Z" fill="var(--primary)" stroke="white" strokeWidth={1}
        transform={`translate(${ex.toFixed(1)} ${ey.toFixed(1)}) rotate(${trackDeg ?? 0})`}
      />
    </svg>
  );
});
