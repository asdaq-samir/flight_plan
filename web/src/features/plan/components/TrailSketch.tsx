import { memo } from "react";
import { colourRuns } from "../../../lib/map/traffic";

/** A field the flight left or is bound for, drawn on the sketch. */
export interface SketchField {
  ident: string;
  lat: number;
  lon: number;
}

/**
 * Where an airplane has flown, drawn small in the airport card's diagram's
 * place, at the owner's pick of the redesign: its trail (its trace, the
 * planner's flight answer) north up, fitted to the box, and an arrowhead
 * where it is now along its track. Plain SVG, no map under it: a shape to
 * recognise, the map behind the card the place. In its heights' colours
 * over a white casing, as the map draws the same trace (TrafficLayer's
 * TrackedPath, heightColour), and with the field it left and the one it
 * is bound for where they are known, each a dot and its ident, at the
 * owner's ask ("Can the aircraft trace in the thumbnail have the
 * origin/destination airport? And the trace color green just like on the
 * map?").
 */
export default memo(function TrailSketch({ points, now, trackDeg, from = null, to = null }: {
  points: { lat: number; lon: number; altFt: number | null }[];
  /** Where it is now, the trail's end where none is heard. */
  now: { lat: number; lon: number; altFt: number | null } | null;
  trackDeg: number | null;
  from?: SketchField | null;
  to?: SketchField | null;
}) {
  const flown = now ? [...points, now] : points;
  if (flown.length < 2) return null;
  // Each field once: a flight back to where it left has the one.
  const fields = [from, to].filter((f): f is SketchField => !!f)
    .filter((f, i, all) => all.findIndex(g => g.ident === f.ident) === i);
  const all = [...flown, ...fields];
  // North up, east right, a degree of longitude shortened by the latitude.
  const midLat = all.reduce((sum, p) => sum + p.lat, 0) / all.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = all.map(p => p.lon * k), ys = all.map(p => -p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-4);
  const W = 100, H = 100, PAD = 12;
  const x = (v: number) => PAD + ((v - minX) / span) * (W - 2 * PAD) + ((W - 2 * PAD) - ((maxX - minX) / span) * (W - 2 * PAD)) / 2;
  const y = (v: number) => PAD + ((v - minY) / span) * (H - 2 * PAD) + ((H - 2 * PAD) - ((maxY - minY) / span) * (H - 2 * PAD)) / 2;
  const line = (ps: [number, number][]) => ps.map(([lat, lon], i) => `${i ? "L" : "M"}${x(lon * k).toFixed(1)} ${y(-lat).toFixed(1)}`).join(" ");
  const runs = colourRuns(flown);
  const end = flown[flown.length - 1]!;
  const ex = x(end.lon * k), ey = y(-end.lat);
  const stroke = { fill: "none", strokeLinejoin: "round", strokeLinecap: "round", vectorEffect: "non-scaling-stroke" } as const;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden="true" data-testid="trail-sketch">
      <path d={line(flown.map(p => [p.lat, p.lon]))} stroke="white" strokeOpacity={0.85} strokeWidth={4.5} {...stroke} />
      {runs.map((run, i) => <path key={i} d={line(run.points)} stroke={run.colour} strokeWidth={2.5} {...stroke} data-sketch-run="" />)}
      {fields.map(field => {
        const fx = x(field.lon * k), fy = y(-field.lat);
        // Its ident on the side with room, away from the box's edge.
        const right = fx < W * 0.6;
        return (
          <g key={field.ident} data-sketch-field={field.ident}>
            <circle cx={fx} cy={fy} r={3.5} fill="var(--background)" stroke="var(--foreground)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <text
              x={fx + (right ? 6 : -6)} y={fy + 4} textAnchor={right ? "start" : "end"} fontSize={11} fontWeight={600}
              fill="var(--foreground)" stroke="var(--background)" strokeWidth={3} paintOrder="stroke"
            >
              {field.ident}
            </text>
          </g>
        );
      })}
      <path
        d="M0 -6 L4.5 5 L0 2.5 L-4.5 5 Z" fill="var(--primary)" stroke="white" strokeWidth={1}
        transform={`translate(${ex.toFixed(1)} ${ey.toFixed(1)}) rotate(${trackDeg ?? 0})`}
      />
    </svg>
  );
});
