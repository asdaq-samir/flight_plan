import { memo, useMemo } from "react";
import { Area, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "../../../components/ui/chart";
import type { PastFlightPoint } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { grouped } from "../../../lib/units";
import { when } from "./pastFlightFormat";
import { TRACES } from "./flightTraces";

// Green height and amber speed (flightTraces): the theme's chart greys
// read as one line.
const chartConfig = {
  alt: { label: TRACES.alt.label, theme: { light: TRACES.alt.light, dark: TRACES.alt.dark } },
  kt: { label: TRACES.kt.label, theme: { light: TRACES.kt.light, dark: TRACES.kt.dark } },
} satisfies ChartConfig;

/** An x tick of the dry run's: the time over the distance flown by then. */
function TimeAndDistance({ x: xAt, y: yAt, payload, nmAt }: { x?: number | string; y?: number | string; payload?: { value: number }; nmAt: (t: number) => number | null }) {
  const x = Number(xAt), y = Number(yAt);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !payload) return null;
  const nm = nmAt(payload.value);
  return (
    <text x={x} y={y} textAnchor="middle" className="fill-muted-foreground text-xs">
      <tspan x={x} dy="0.71em">{clockTime(when(payload.value))}</tspan>
      {nm != null && <tspan x={x} dy="1.2em">{Math.round(nm)} nm</tspan>}
    </text>
  );
}

/** A past flight's height and ground speed (PastFlightCard), in a chunk
 *  of its own, loaded once a flight is opened: drawn again with each
 *  second of a replay, for its mark. The plan's dry run (DryRunControls)
 *  gives the distance flown by each point (`alongNm`), and is drawn as the
 *  owner asked of it: no axes up the sides, its labels coloured as their
 *  traces said over it instead; room over the traces at the top; and the
 *  time and the distance flown under each tick. */
const FlightChart = memo(function FlightChart({ points, at, alongNm }: { points: PastFlightPoint[]; at: number | null; alongNm?: number[] }) {
  const data = useMemo(() => points.map(p => ({ t: p.t, alt: p.alt_ft ?? 0, kt: p.gs_kt ?? null })), [points]);
  const nmAt = useMemo(() => {
    if (!alongNm) return null;
    const byT = new Map(points.map((p, i) => [p.t, alongNm[i] ?? null]));
    // A tick between two points: the distance flown by the nearer earlier one.
    return (t: number) => byT.get(t) ?? (() => {
      let best: number | null = null;
      for (let i = 0; i < points.length && points[i]!.t <= t; i++) best = alongNm[i] ?? best;
      return best;
    })();
  }, [points, alongNm]);
  const plain = !!nmAt;
  // A quarter again over the highest of each, the white space on top.
  const headroom = (max: number) => Math.ceil(max * 1.25);
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
      <ComposedChart data={data} margin={{ left: plain ? 12 : 0, right: plain ? 12 : 0, top: 4, bottom: 0 }}>
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={false} minTickGap={plain ? 40 : 32}
          tickFormatter={(t: number) => clockTime(when(t))} height={plain ? 34 : undefined}
          tick={nmAt ? props => <TimeAndDistance {...props} nmAt={nmAt} /> : undefined} />
        <YAxis yAxisId="alt" hide={plain} domain={plain ? [0, headroom] : undefined} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${grouped(v)}`} />
        <YAxis yAxisId="kt" hide={plain} domain={plain ? [0, headroom] : undefined} orientation="right" tickLine={false} axisLine={false} width={32} />
        <Area yAxisId="alt" dataKey="alt" type="monotone" stroke="var(--color-alt)" fill="var(--color-alt)" fillOpacity={0.15}
          strokeWidth={2} isAnimationActive={false} dot={false} />
        <Line yAxisId="kt" dataKey="kt" type="monotone" stroke="var(--color-kt)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        {at !== null && <ReferenceLine yAxisId="alt" x={at} stroke="var(--tint)" strokeWidth={2} />}
      </ComposedChart>
    </ChartContainer>
  );
});

export default FlightChart;
